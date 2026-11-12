// Tests for setup.mjs's plan: what it writes over Plasma's own settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KEYS } from "../src/keys.js";
import { batchLines, formatEntry, lockWallpaper, parseEntry, plan, shortcutEntries } from "./setup.mjs";

// Plasma 6.7's own bindings, as its kglobalshortcutsrc has them.
const PLASMA = {
  "kglobalshortcutsrc kwin Walk Through Windows": "Alt+Tab\tMeta+Tab,Alt+Tab\tMeta+Tab,Walk Through Windows",
  "kglobalshortcutsrc kwin Walk Through Windows of Current Application":
    "Alt+`\tMeta+`,Alt+`\tMeta+`,Walk Through Windows of Current Application",
  "kglobalshortcutsrc kwin Window Quick Tile Left": "Meta+Left,Meta+Left,Quick Tile Window to the Left",
  "kglobalshortcutsrc plasmashell activate task manager entry 1": "Meta+1,Meta+1,Activate Task Manager Entry 1",
  "kglobalshortcutsrc kwin tide-zoom": "none,Alt+Tab,tide: Make the window the master",
  "kglobalshortcutsrc kwin tide-go-1": "Meta+F1,Meta+1,tide: Go to workspace 1",
  "kwinrc Plugins tideEnabled": "true",
};

function writes(config = PLASMA) {
  const out = new Map();
  for (const w of plan((file, group, key) => config[`${file} ${group} ${key}`] ?? null)) {
    out.set(`${w.file} ${w.group} ${w.key}`, w.value);
  }
  return out;
}

test("an entry's value splits into keys, and back", () => {
  const e = parseEntry("Alt+Tab\tMeta+Tab,none,Walk\\, Through");
  assert.deepEqual(e, { active: ["Alt+Tab", "Meta+Tab"], default: [], name: "Walk, Through" });
  assert.equal(formatEntry(e), "Alt+Tab\tMeta+Tab,none,Walk\\, Through");
  assert.equal(parseEntry(null), null);
});

test("a key with a comma or backslash keeps KConfig's escaping", () => {
  const e = parseEntry("Meta+Left\tCtrl+\\,\tCtrl+\\\\,Meta+Left,Quick Tile Window to the Left");
  assert.deepEqual(e.active, ["Meta+Left", "Ctrl+,", "Ctrl+\\"]);
  const w = plan((file, group, key) =>
    key === "Window Quick Tile Left" ? "Meta+Left\tCtrl+\\,,Meta+Left,Quick Tile Window to the Left" : null,
  ).find((x) => x.key === "Window Quick Tile Left");
  assert.equal(w.value, "Ctrl+\\,,Meta+Left,Quick Tile Window to the Left");
});

test("Plasma gives up only the keys tide takes", () => {
  const w = writes();
  assert.equal(w.get("kglobalshortcutsrc kwin Walk Through Windows"), "none,Alt+Tab\tMeta+Tab,Walk Through Windows");
  assert.equal(
    w.get("kglobalshortcutsrc kwin Walk Through Windows of Current Application"),
    "Alt+`,Alt+`\tMeta+`,Walk Through Windows of Current Application",
  );
  assert.equal(w.get("kglobalshortcutsrc plasmashell activate task manager entry 1"), "none,Meta+1,Activate Task Manager Entry 1");
  assert.ok(!w.has("kglobalshortcutsrc kwin Window Quick Tile Right"), "an entry not there is left alone");
});

test("tide's keys are bound, but one you bound yourself stays", () => {
  const w = writes();
  assert.equal(w.get("kglobalshortcutsrc kwin tide-zoom"), "Alt+Tab,Alt+Tab,tide: Make the window the master");
  assert.ok(!w.has("kglobalshortcutsrc kwin tide-go-1"));
  assert.equal(w.get("kglobalshortcutsrc kwin tide-send-1"), "Meta+!,Meta+!,tide: Send the window to workspace 1");
  const bound = [...w.keys()].filter((k) => k.startsWith("kglobalshortcutsrc kwin tide-"));
  assert.equal(bound.length, KEYS.filter((k) => k.key).length - 1);
});

test("the dim and focus settings are written, but not what's set already", () => {
  const w = writes();
  assert.equal(w.get("kwinrc Effect-diminactive DimByGroup"), "false");
  assert.equal(w.get("kwinrc Windows FocusStealingPreventionLevel"), "2");
  assert.ok(!w.has("kwinrc Plugins tideEnabled"));
});

test("run again, it writes nothing more", () => {
  const config = { ...PLASMA };
  for (const [k, v] of writes(config)) config[k] = v;
  assert.deepEqual([...writes(config).keys()], []);
});

test("the lock screen gets the desktop's image, and nothing without one", () => {
  assert.deepEqual(lockWallpaper("file:///pictures/sea.jpg"), [
    { file: "kscreenlockerrc", groups: ["Greeter"], key: "WallpaperPlugin", value: "org.kde.image" },
    { file: "kscreenlockerrc", groups: ["Greeter", "Wallpaper", "org.kde.image", "General"], key: "Image", value: "file:///pictures/sea.jpg" },
  ]);
  assert.deepEqual(lockWallpaper(""), []);
});

test("the shortcuts it writes go to kdeshortcut.py as batch lines, the rest don't", () => {
  const lines = batchLines([
    { file: "kglobalshortcutsrc", group: "kwin", key: "Walk Through Windows", value: "none,Alt+Tab\tMeta+Tab,Walk Through Windows" },
    { file: "kglobalshortcutsrc", group: "kwin", key: "tide-previous-layout", value: "Meta+\\,,Meta+\\,,tide: Previous layout" },
    { file: "kglobalshortcutsrc", group: "kwin", key: "Walk Through Windows of Current Application", value: "Alt+`,Alt+`\tMeta+`,Walk Through Windows of Current Application" },
    { file: "kwinrc", group: "Windows", key: "FocusStealingPreventionLevel", value: "2" },
  ]);
  assert.equal(lines, [
    "kwin\tWalk Through Windows\tnone\tWalk Through Windows\n",
    "kwin\ttide-previous-layout\tMeta+,\ttide: Previous layout\n",
    "kwin\tWalk Through Windows of Current Application\tAlt+`\tWalk Through Windows of Current Application\n",
  ].join(""));
});

test("the batch has the shortcuts set by an earlier run too", () => {
  const config = {};
  for (const w of plan((file, group, key) => PLASMA[`${file} ${group} ${key}`] ?? null)) {
    config[`${w.file} ${w.group} ${w.key}`] = w.value;
  }
  const read = (file, group, key) => config[`${file} ${group} ${key}`] ?? PLASMA[`${file} ${group} ${key}`] ?? null;
  const lines = batchLines(shortcutEntries(read));
  assert.equal(plan(read).filter((w) => w.file === "kglobalshortcutsrc").length, 0);
  assert.match(lines, /^kwin\tWalk Through Windows\tnone\tWalk Through Windows$/m);
  assert.match(lines, /^kwin\ttide-zoom\tAlt\+Tab\ttide: /m);
  assert.match(lines, /^kwin\ttide-go-1\tMeta\+F1\ttide: Go to workspace 1$/m);
});

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// What `node <script> --dry-run` prints, with stubs for KDE's tools: a
// kreadconfig6 that finds nothing set, and a qdbus6 with no Plasma to ask.
function dryRun(script) {
  const bin = mkdtempSync(join(tmpdir(), "tide-kde-setup-bin-"));
  try {
    for (const [tool, status] of [["kreadconfig6", 0], ["qdbus6", 1]]) {
      writeFileSync(join(bin, tool), `#!/bin/sh\nexit ${status}\n`);
      chmodSync(join(bin, tool), 0o755);
    }
    return execFileSync(process.execPath, [script, "--dry-run"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

test("setup runs from a checkout whose path has a space", () => {
  const dir = mkdtempSync(join(tmpdir(), "tide kde setup-"));
  try {
    for (const part of ["scripts", "src"]) cpSync(join(ROOT, part), join(dir, part), { recursive: true });
    assert.match(dryRun(join(dir, "scripts", "setup.mjs")), /^kwinrc \[Plugins\] tideEnabled=true$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("setup runs from a checkout reached through a link", () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-kde-setup-"));
  try {
    symlinkSync(ROOT, join(dir, "link"));
    assert.match(dryRun(join(dir, "link", "scripts", "setup.mjs")), /^kwinrc \[Plugins\] tideEnabled=true$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
