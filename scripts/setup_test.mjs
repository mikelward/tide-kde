// Tests for setup.mjs's plan: what it writes over Plasma's own settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KEYS } from "../src/keys.js";
import { formatEntry, lockWallpaper, parseEntry, plan } from "./setup.mjs";

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
