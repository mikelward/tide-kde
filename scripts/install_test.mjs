// Tests for `make install` and `make uninstall`: they run where KWin isn't,
// as when setup runs from a console or another desktop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// As a path, not a URL's: that has a space as %20, which make can't find.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Stubs for KDE's tools, systemctl and install that log their arguments. qdbus6
// answers as KWin would, running or not.
function stubs(kwinRunning) {
  const dir = mkdtempSync(join(tmpdir(), "tide-kde-install-"));
  const log = join(dir, "calls");
  for (const tool of ["kpackagetool6", "kwriteconfig6", "systemctl"]) {
    writeFileSync(join(dir, tool), `#!/bin/sh\necho "${tool} $*" >>"${log}"\n`);
    chmodSync(join(dir, tool), 0o755);
  }
  const qdbus = kwinRunning
    ? `#!/bin/sh\necho "qdbus6 $*" >>"${log}"\n`
    : `#!/bin/sh\necho "qdbus6 $*" >>"${log}"\necho "Service 'org.kde.KWin' does not exist." >&2\nexit 2\n`;
  writeFileSync(join(dir, "qdbus6"), qdbus);
  chmodSync(join(dir, "qdbus6"), 0o755);
  // install as macOS's BSD one is: no -D, so the Makefile works on both.
  const real = execFileSync("sh", ["-c", "command -v install"], { encoding: "utf8" }).trim();
  writeFileSync(join(dir, "install"), `#!/bin/sh\nfor a in "$@"; do case "$a" in -D|-*D*) echo "install: illegal option -- D" >&2; exit 64;; esac; done\nexec "${real}" "$@"\n`);
  chmodSync(join(dir, "install"), 0o755);
  return { dir, log };
}

// The environment with `home` as HOME and the stubs in `dir` first.
function homeEnv(home, dir) {
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, HOME: home };
  delete env.XDG_DATA_HOME;
  delete env.XDG_CONFIG_HOME;
  return env;
}

// Runs `make target` with a home of its own, and `look` at that home
// before it goes.
function make(target, kwinRunning, look = () => {}) {
  const { dir, log } = stubs(kwinRunning);
  const home = join(dir, "home");
  try {
    const env = homeEnv(home, dir);
    const out = execFileSync("make", ["-s", "-C", ROOT, target], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    look(home);
    return { out, calls: readFileSync(log, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("install works with KWin not running, and says when tide loads", () => {
  const { out, calls } = make("install", false);
  assert.match(calls, /kwriteconfig6 --file kwinrc --group Plugins --key tideEnabled true/);
  assert.doesNotMatch(calls, /reconfigure/);
  assert.match(out, /KWin isn't running, so tide loads at the next Plasma login/);
});

test("install has a running KWin load tide", () => {
  const { calls } = make("install", true);
  assert.match(calls, /qdbus6 org.kde.KWin \/KWin reconfigure/);
});

test("uninstall works with KWin not running", () => {
  const { calls } = make("uninstall", false);
  assert.match(calls, /tideEnabled false/);
  assert.match(calls, /kpackagetool6 --type KWin\/Script --remove tide/);
});

test("install puts in the unit Meta+Shift+B starts to report a bug, naming its script", () => {
  const { calls } = make("install", false, (home) => {
    const script = join(home, ".local/share/tide-kde/tide-kde-report-bug");
    assert.ok(statSync(script).mode & 0o100, "the script runs");
    const unit = readFileSync(join(home, ".config/systemd/user/tide-kde-report-bug.service"), "utf8");
    assert.match(unit, new RegExp(`^ExecStart="${script}"$`, "m"));
  });
  assert.match(calls, /systemctl --user daemon-reload/);
});

test("uninstall takes the unit and its script out", () => {
  make("install", false, (home) => {
    execFileSync("make", ["-s", "-C", ROOT, "uninstall"], { env: homeEnv(home, join(home, "..")), stdio: "ignore" });
    assert.equal(existsSync(join(home, ".config/systemd/user/tide-kde-report-bug.service")), false);
    assert.equal(existsSync(join(home, ".local/share/tide-kde/tide-kde-report-bug")), false);
  });
});
