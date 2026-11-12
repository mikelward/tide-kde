// Sets Plasma up for tide (README.md's Setup): frees the Plasma shortcuts
// tide's keys take and binds tide's, sets the dim and focus stealing
// prevention, turns the script on, puts the layout widget on the first
// panel, and gives the lock screen the desktop's wallpaper. `make setup` runs it; scripts' setup-kde can.
//
//   node scripts/setup.mjs [--dry-run] [--batch FILE]
//
// --batch FILE adds each shortcut it sets, written now or before, to FILE,
// a line apiece in the batch form of scripts' kdeshortcut.py (component,
// action, keys split by spaces or "none", label; tab-separated), which
// pushes them into the running session, as scripts' setup-kde does with its
// own.
//
// Only kreadconfig6, kwriteconfig6 and qdbus6 are run, so `plan` tests
// with no Plasma. Plasma reads its shortcuts as the session starts, so
// they take effect at the next login.
import { execFileSync } from "node:child_process";
import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KEYS } from "../src/keys.js";

// The Plasma shortcuts that hold tide's keys, as Plasma 6.7 binds them:
// [file group, entry, the keys of its to give up].
export const TAKEN = [
  ["kwin", "Walk Through Windows", ["Alt+Tab", "Meta+Tab"]],
  ["kwin", "Walk Through Windows of Current Application", ["Meta+`"]],
  ["kwin", "Window Maximize", ["Meta+PgUp"]],
  ["kwin", "Window Minimize", ["Meta+PgDown"]],
  ["kwin", "Window Quick Tile Left", ["Meta+Left"]],
  ["kwin", "Window Quick Tile Right", ["Meta+Right"]],
  ["kwin", "Window Quick Tile Top", ["Meta+Up"]],
  ["kwin", "Window Quick Tile Bottom", ["Meta+Down"]],
  ["kwin", "Window Restore", ["Meta+Backspace"]],
  ["kwin", "Window to Next Screen", ["Meta+Shift+Right"]],
  ["kwin", "Window to Previous Screen", ["Meta+Shift+Left"]],
  ["kwin", "view_actual_size", ["Meta+0"]],
  ["kwin", "view_zoom_in", ["Meta+="]],
  ["kwin", "view_zoom_out", ["Meta+-"]],
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ["plasmashell", `activate task manager entry ${n}`, [`Meta+${n}`]]),
  ["org.kde.plasma.emojier.desktop", "_launch", ["Meta+."]],
];

// kwinrc's settings for tide: Dim Inactive at the strength tide's KDE
// setup had, on every inactive app window and nothing else (tide SPEC.md
// §6.2), and KWin's focus stealing prevention at Medium (tide SPEC.md
// §14.1).
export const KWINRC = [
  ["Plugins", "tideEnabled", "true"],
  ["Plugins", "diminactiveEnabled", "true"],
  ["Effect-diminactive", "Strength", "15"],
  ["Effect-diminactive", "DimByGroup", "false"],
  ["Effect-diminactive", "DimPanels", "false"],
  ["Effect-diminactive", "DimDesktop", "false"],
  ["Effect-diminactive", "DimKeepAbove", "false"],
  ["Effect-diminactive", "DimFullScreen", "false"],
  ["Windows", "FocusStealingPreventionLevel", "2"],
];

// Prints the first desktop's wallpaper, as Plasma's image wallpaper keeps
// it, or nothing for another kind.
export const WALLPAPER_SCRIPT =
  'const d = desktops()[0]; if (d && d.wallpaperPlugin === "org.kde.image") {' +
  ' d.currentConfigGroup = ["Wallpaper", "org.kde.image", "General"]; print(d.readConfig("Image")); }';

// The lock screen's wallpaper, as its settings keep it: the desktop's image.
export function lockWallpaper(image) {
  if (!image) return [];
  const groups = ["Greeter", "Wallpaper", "org.kde.image", "General"];
  return [
    { file: "kscreenlockerrc", groups: ["Greeter"], key: "WallpaperPlugin", value: "org.kde.image" },
    { file: "kscreenlockerrc", groups, key: "Image", value: image },
  ];
}

// Puts the layout widget on the first panel, unless one has it.
export const WIDGET_SCRIPT =
  'if (!panels().some((p) => p.widgets("org.tide.layout").length > 0) && panels().length > 0)' +
  ' panels()[0].addWidget("org.tide.layout");';

// A KConfig list's items, as KConfig writes one: split on commas, with a
// comma or backslash in an item escaped by a backslash.
export function splitList(text) {
  const items = [""];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) items[items.length - 1] += text[++i];
    else if (c === ",") items.push("");
    else items[items.length - 1] += c;
  }
  return items;
}

export function joinList(items) {
  return items.map((s) => s.replace(/\\/g, "\\\\").replace(/,/g, "\\,")).join(",");
}

// A shortcut entry's value, the list "active,default,friendly name" (as
// KGlobalAccel keeps it), with its key lists split on tabs. Null for one
// not set.
export function parseEntry(value) {
  if (value === null || value === undefined || value === "") return null;
  const [active, def, ...name] = splitList(value);
  const keys = (s) => (s === undefined || s === "" || s === "none" ? [] : s.split("\t"));
  return { active: keys(active), default: keys(def), name: name.join(",") };
}

export function formatEntry({ active, default: def, name }) {
  const keys = (l) => (l.length === 0 ? "none" : l.join("\t"));
  return joinList([keys(active), keys(def), name]);
}

// The writes that set Plasma up, each {file, group, key, value}, given
// read(file, group, key), which gives a value or null.
export function plan(read) {
  const writes = [];
  for (const [group, entry, keys] of TAKEN) {
    const e = parseEntry(read("kglobalshortcutsrc", group, entry));
    if (!e) continue;
    const active = e.active.filter((k) => !keys.includes(k));
    if (active.length !== e.active.length) {
      writes.push({ file: "kglobalshortcutsrc", group, key: entry, value: formatEntry({ ...e, active }) });
    }
  }
  for (const k of KEYS) {
    if (!k.key) continue;
    const e = parseEntry(read("kglobalshortcutsrc", "kwin", k.name));
    // One you bound yourself stays as you have it.
    if (e && e.active.length > 0) continue;
    writes.push({
      file: "kglobalshortcutsrc",
      group: "kwin",
      key: k.name,
      value: formatEntry({ active: [k.key], default: [k.key], name: `tide: ${k.title}` }),
    });
  }
  for (const [group, key, value] of KWINRC) {
    if (read("kwinrc", group, key) !== value) writes.push({ file: "kwinrc", group, key, value });
  }
  return writes;
}

// The Plasma shortcuts tide's keys take, and tide's own, as the config has
// them: what the running session should hold once `plan`'s writes are made.
// The live apply gets them all, not only those written, as KGlobalAccel
// keeps the old ones until the next login.
export function shortcutEntries(read) {
  const out = [];
  const add = (group, key) => {
    const value = read("kglobalshortcutsrc", group, key);
    if (value !== null) out.push({ file: "kglobalshortcutsrc", group, key, value });
  };
  for (const [group, entry] of TAKEN) add(group, entry);
  for (const k of KEYS) if (k.key) add("kwin", k.name);
  return out;
}

// The shortcut entries among `writes`, as kdeshortcut.py batch lines.
export function batchLines(writes) {
  return writes
    .filter((w) => w.file === "kglobalshortcutsrc")
    .map((w) => {
      const e = parseEntry(w.value);
      const keys = e.active.length === 0 ? "none" : e.active.join(" ");
      return `${w.group}\t${w.key}\t${keys}\t${e.name}\n`;
    })
    .join("");
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function main() {
  const dry = process.argv.includes("--dry-run");
  const at = process.argv.indexOf("--batch");
  const batch = at >= 0 ? process.argv[at + 1] : null;
  if (at >= 0 && !batch) {
    console.error("--batch needs a file");
    process.exit(2);
  }
  const read = (file, group, key) => {
    const v = run("kreadconfig6", ["--file", file, "--group", group, "--key", key]).replace(/\n$/, "");
    return v === "" ? null : v;
  };
  let image = null;
  try {
    image = run("qdbus6", ["org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell.evaluateScript", WALLPAPER_SCRIPT]).trim();
  } catch (e) {
    console.error(`couldn't ask Plasma for the desktop's wallpaper (${e.stderr || e.message}), so the lock screen keeps its own`);
  }
  const writes = plan(read).map((w) => ({ ...w, groups: [w.group] }));
  writes.push(...lockWallpaper(image));
  for (const w of writes) {
    console.log(`${w.file} [${w.groups.join("][")}] ${w.key}=${w.value.replace(/\t/g, "\\t")}`);
    if (!dry) run("kwriteconfig6", ["--file", w.file, ...w.groups.flatMap((g) => ["--group", g]), "--key", w.key, w.value]);
  }
  if (dry) return;
  if (batch) appendFileSync(batch, batchLines(shortcutEntries(read)));
  try {
    run("qdbus6", ["org.kde.KWin", "/KWin", "reconfigure"]);
  } catch (e) {
    console.error(`couldn't have KWin read its settings again (${e.stderr || e.message}); they apply at the next login`);
  }
  try {
    run("qdbus6", ["org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell.evaluateScript", WIDGET_SCRIPT]);
  } catch (e) {
    console.error(`couldn't put the layout widget on a panel (${e.stderr || e.message}); add "tide Layout" from Add Widgets`);
  }
  if (!batch) console.log("tide's keys take over from Plasma's at the next login.");
}

// Whether node was run on this file, rather than a test importing it. The
// two are compared as real paths: this module's URL escapes a space and has
// its links resolved, where the path node was given has neither.
function isMain() {
  const script = process.argv[1];
  return script !== undefined && realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMain()) main();
