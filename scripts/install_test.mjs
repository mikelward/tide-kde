// Tests for `make install` and `make uninstall`: they run where KWin isn't,
// as when setup runs from a console or another desktop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// As a path, not a URL's: that has a space as %20, which make can't find.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Stubs for KDE's tools that log their arguments. qdbus6 answers as KWin
// would, running or not.
function stubs(kwinRunning) {
  const dir = mkdtempSync(join(tmpdir(), "tide-kde-install-"));
  const log = join(dir, "calls");
  for (const tool of ["kpackagetool6", "kwriteconfig6"]) {
    writeFileSync(join(dir, tool), `#!/bin/sh\necho "${tool} $*" >>"${log}"\n`);
    chmodSync(join(dir, tool), 0o755);
  }
  const qdbus = kwinRunning
    ? `#!/bin/sh\necho "qdbus6 $*" >>"${log}"\n`
    : `#!/bin/sh\necho "qdbus6 $*" >>"${log}"\necho "Service 'org.kde.KWin' does not exist." >&2\nexit 2\n`;
  writeFileSync(join(dir, "qdbus6"), qdbus);
  chmodSync(join(dir, "qdbus6"), 0o755);
  return { dir, log };
}

function make(target, kwinRunning) {
  const { dir, log } = stubs(kwinRunning);
  try {
    const out = execFileSync("make", ["-s", "-C", ROOT, target], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
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
