"""The layout widget (plasmoid/) in a real plasmashell on the headless
KWin, fed by tide's script. plasmashell needs Plasma's desktop shell
(Ubuntu's plasma-desktop); without it these skip, unless TIDE_PLASMA=1,
as CI's plasma job sets, makes that a failure."""

import os
import shutil
import subprocess
import unittest

from harness import KPACKAGETOOL, ROOT, KWinTest, Log

PLASMASHELL = os.environ.get("PLASMASHELL", "plasmashell")
REQUIRED = os.environ.get("TIDE_PLASMA") == "1"


class PlasmaTest(KWinTest):
    """plasmashell on the headless KWin, with a panel holding the widget.
    Helpers, with no tests of its own."""

    def setUp(self):
        super().setUp()
        r = subprocess.run([KPACKAGETOOL, "--type", "Plasma/Applet", "--install", os.path.join(ROOT, "plasmoid")],
                           env=self.env, capture_output=True, text=True)
        if r.returncode != 0:
            raise AssertionError(f"kpackagetool6 couldn't install the widget: {r.stdout}{r.stderr}")
        log = os.path.join(self.home, "plasmashell.log")
        env = dict(self.env, QT_QPA_PLATFORM="wayland")
        # What D-Bus starts for plasmashell, kactivitymanagerd above all,
        # starts in this KWin, as a Plasma session's would
        subprocess.run(["dbus-update-activation-environment", "WAYLAND_DISPLAY", "QT_QPA_PLATFORM", "HOME",
                        "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME"], env=env, check=True)
        with open(log, "wb") as out:
            self.shell = subprocess.Popen([PLASMASHELL, "--no-respawn"], env=env, stdout=out, stderr=subprocess.STDOUT)
        self.addCleanup(self.stop_shell)
        self.plasma = Log(log)
        self.addCleanup(self.plasma.close)
        self.wait_for_name("org.kde.plasmashell")
        # A panel holding the widget, as a user adds one
        self.qdbus("org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell.evaluateScript",
                   'const p = new Panel; p.location = "top"; p.addWidget("org.tide.layout");')

    def stop_shell(self):
        self.shell.terminate()
        try:
            self.shell.wait(10)
        except subprocess.TimeoutExpired:
            self.shell.kill()
            self.shell.wait()

    def shows(self, text):
        self.plasma.wait(lambda l: f"tide-layout: Virtual-0 {text}" in l, f"the widget showing {text}")


@unittest.skipUnless(REQUIRED or shutil.which(PLASMASHELL), "no plasmashell")
class WidgetTest(PlasmaTest):
    def test_the_widget_shows_the_layout_as_it_changes(self):
        # Just added, it asks for the layouts
        self.shows("[]=")
        self.key("tide-next-layout")
        self.shows("|M|")
        self.open("one")
        self.open("two")
        self.key("tide-monocle")
        self.shows("[1]")


@unittest.skipUnless(REQUIRED or shutil.which(PLASMASHELL), "no plasmashell")
class SetupTest(PlasmaTest):
    def test_setup_gives_the_lock_screen_the_desktops_wallpaper_and_adds_the_widget_once(self):
        self.shows("[]=")
        self.qdbus("org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell.evaluateScript",
                   'const d = desktops()[0]; d.wallpaperPlugin = "org.kde.image";'
                   ' d.currentConfigGroup = ["Wallpaper", "org.kde.image", "General"];'
                   ' d.writeConfig("Image", "file:///pictures/sea.jpg");')
        r = subprocess.run(["node", os.path.join(ROOT, "scripts", "setup.mjs")], env=self.env,
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        image = subprocess.run(["kreadconfig6", "--file", "kscreenlockerrc", "--group", "Greeter", "--group", "Wallpaper",
                                "--group", "org.kde.image", "--group", "General", "--key", "Image"],
                               env=self.env, capture_output=True, text=True).stdout.strip()
        self.assertEqual(image, "file:///pictures/sea.jpg")
        count = self.qdbus("org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell.evaluateScript",
                           'print(panels().reduce((n, p) => n + p.widgets("org.tide.layout").length, 0))')
        self.assertEqual(count, "1", "the panel had one already")
