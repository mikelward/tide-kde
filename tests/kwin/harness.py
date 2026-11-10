"""tide-kde in a real KWin: a headless kwin_wayland (--virtual) per test,
running the built script, with foot windows and shortcuts invoked over
D-Bus. Run inside a D-Bus session (`dbus-run-session`); `make test-kwin`
does.

A test waits for what it knows is coming: a line the probe script prints
as KWin reports it, read from KWin's log as it's written."""

import json
import os
import select
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.environ.get("TIDE_SCRIPT", os.path.join(ROOT, "package", "contents", "code", "main.js"))
PROBE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe.js")
KWIN = os.environ.get("KWIN", "kwin_wayland")
QDBUS = os.environ.get("QDBUS", "qdbus6")
FOOT = os.environ.get("FOOT", "foot")
KPACKAGETOOL = os.environ.get("KPACKAGETOOL", "kpackagetool6")
TIMEOUT = float(os.environ.get("TIDE_TIMEOUT", "10"))


class Log:
    """KWin's log, read line by line as it grows. Each wait reads on from
    the last line a wait matched, or from a mark taken earlier."""

    def __init__(self, path):
        self.file = open(path, "rb")
        self.partial = b""
        self.lines = []
        self.pos = 0

    def close(self):
        self.file.close()

    def read(self):
        data = self.file.read()
        if data:
            *done, self.partial = (self.partial + data).split(b"\n")
            self.lines += [line.decode("utf-8", "replace") for line in done]
        return bool(data)

    def mark(self):
        """Where the log is now, for a wait to read on from."""
        self.read()
        return len(self.lines)

    def wait(self, test, what, since=None):
        """The first line from `since` (by default, after the last match) for
        which test(line) holds."""
        i = self.pos if since is None else since
        deadline = time.monotonic() + TIMEOUT
        while True:
            while i < len(self.lines):
                line = self.lines[i]
                i += 1
                if test(line):
                    self.pos = max(self.pos, i)
                    return line
            if self.read():
                continue
            if time.monotonic() > deadline:
                raise AssertionError(f"KWin's log never said {what}")
            # KWin writes the log, and a file gives select() nothing to
            # wait on, so this reads it again shortly.
            select.select([], [], [], 0.02)


class KWinTest(unittest.TestCase):
    """A fresh KWin for each test, OUTPUTS outputs of WIDTH by HEIGHT, with
    CONFIG's lines in kwinrc's [Script-tide] group."""

    WIDTH = 1920
    HEIGHT = 1080
    OUTPUTS = 1
    CONFIG = {}
    # How tide gets into KWin: "load" over D-Bus, as a test script; "install"
    # as a user does, with kpackagetool6 and kwinrc's Plugins; or None.
    LOAD = "load"

    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="tide-kde-test.")
        self.addCleanup(shutil.rmtree, self.home, True)
        runtime = os.path.join(self.home, "run")
        os.mkdir(runtime, 0o700)
        os.makedirs(os.path.join(self.home, ".config"))
        self.env = dict(os.environ, HOME=self.home, XDG_RUNTIME_DIR=runtime,
                        XDG_CONFIG_HOME=os.path.join(self.home, ".config"),
                        XDG_DATA_HOME=os.path.join(self.home, ".local", "share"),
                        LANG="C.UTF-8", QT_QPA_PLATFORM="", WAYLAND_DISPLAY="wayland-tide")
        self.env.pop("DISPLAY", None)
        if self.CONFIG:
            self.write_config(self.CONFIG)
        if self.LOAD == "install":
            r = subprocess.run([KPACKAGETOOL, "--type", "KWin/Script", "--install", os.path.join(ROOT, "package")],
                               env=self.env, capture_output=True, text=True)
            if r.returncode != 0:
                raise AssertionError(f"kpackagetool6 couldn't install tide: {r.stdout}{r.stderr}")
            self.write_config({"tideEnabled": "true"}, group="Plugins")
        self.clients = []
        self.kwin = None
        self.log = None
        self.addCleanup(self.stop)
        self.start_kwin()

    def start_kwin(self):
        """Starts KWin with the probe, and tide as LOAD says."""
        log = os.path.join(self.home, "kwin.log")
        # Where this run's lines start, counted before KWin can write any
        before = 0
        if os.path.exists(log):
            with open(log, "rb") as f:
                before = f.read().count(b"\n")
        with open(log, "ab") as out:
            self.kwin = subprocess.Popen(
                [KWIN, "--virtual", "--no-lockscreen", "--socket", "wayland-tide",
                 "--width", str(self.WIDTH), "--height", str(self.HEIGHT),
                 "--output-count", str(self.OUTPUTS)],
                env=self.env, stdout=out, stderr=subprocess.STDOUT)
        self.log = Log(log)
        self.log.pos = before
        self.log.wait(lambda l: "Accepting client connections" in l, "it accepts clients")
        self.wait_for_dbus()
        self.load(PROBE, "probe")
        if self.LOAD == "load":
            self.load(SCRIPT, "tide")
        self.qdbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.start")
        # The scripts start in either order
        waiting = {"probe: ready"} | ({"tide: started"} if self.LOAD else set())
        while waiting:
            line = self.log.wait(lambda l: any(w in l for w in waiting), " and ".join(sorted(waiting)))
            waiting = {w for w in waiting if w not in line}

    def stop(self):
        """Stops the windows and KWin."""
        for c in self.clients:
            c.kill()
            c.wait()
        self.clients = []
        if self.kwin:
            self.kwin.terminate()
            try:
                self.kwin.wait(5)
            except subprocess.TimeoutExpired:
                self.kwin.kill()
                self.kwin.wait()
            self.kwin = None
        if self.log:
            self.log.close()
            self.log = None

    def write_config(self, entries, group="Script-tide"):
        path = os.path.join(self.home, ".config", "kwinrc")
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"[{group}]\n")
            for k, v in entries.items():
                f.write(f"{k}={v}\n")

    def qdbus(self, *args):
        result = subprocess.run([QDBUS, *args], env=self.env, capture_output=True, text=True, timeout=TIMEOUT)
        if result.returncode != 0:
            raise AssertionError(f"{' '.join(args)} failed: {result.stderr.strip()}")
        return result.stdout.strip()

    def wait_for_dbus(self):
        self.wait_for_name("org.kde.KWin")

    def wait_for_name(self, name):
        # A name's arrival is announced on the bus, which qdbus can't wait
        # on, so this asks D-Bus whether it's there yet.
        deadline = time.monotonic() + TIMEOUT * 3
        while True:
            names = subprocess.run([QDBUS], env=self.env, capture_output=True, text=True).stdout
            if name in names.split():
                return
            if time.monotonic() > deadline:
                raise AssertionError(f"nothing took the D-Bus name {name}")
            select.select([], [], [], 0.05)

    def load(self, path, name):
        self.qdbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.loadScript", path, name)

    def key(self, name):
        """Invokes the shortcut `name`, then waits until KWin has run it:
        the probe's echo, invoked after it, comes once it has."""
        self.qdbus("org.kde.kglobalaccel", "/component/kwin", "org.kde.kglobalaccel.Component.invokeShortcut", name)
        return self.state()

    def state(self):
        """What the probe says: {desktops, current, windows: {class: {x, y,
        width, height, desktops, minimized, active}}}."""
        self.qdbus("org.kde.kglobalaccel", "/component/kwin", "org.kde.kglobalaccel.Component.invokeShortcut", "probe-dump")
        line = self.log.wait(lambda l: "probe: dump " in l, "the probe's dump")
        return json.loads(line.split("probe: dump ", 1)[1])

    def open(self, app):
        """Opens a foot window of class `app` and waits until KWin maps it."""
        c = subprocess.Popen([FOOT, "-o", "resize-by-cells=no", "-a", app, "sleep", "600"],
                             env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.clients.append(c)
        self.log.wait(lambda l: f"probe: added {app}" in l, f"{app} opened")
        return c

    def settled(self, expected):
        """Waits until each window named in `expected` is at its box
        (x, y, width, height), as KWin reports its geometry changing, and
        returns the state."""
        deadline = time.monotonic() + TIMEOUT
        while True:
            s = self.state()
            got = {app: self.box(s, app) for app in expected}
            if got == expected:
                return s
            if time.monotonic() > deadline:
                self.assertEqual(got, expected)
            self.log.wait(lambda l: "probe: geometry " in l, "a window moved")

    @staticmethod
    def box(state, app):
        w = state["windows"].get(app)
        return None if w is None else (w["x"], w["y"], w["width"], w["height"])
