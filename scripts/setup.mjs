// Sets Plasma up for tide (README.md's Setup): frees the Plasma shortcuts
// tide's keys take and binds tide's, sets the dim and focus stealing
// prevention, turns the script on, and puts the layout widget on the first
// panel. `make setup` runs it; scripts' setup-kde can.
//
//   node scripts/setup.mjs [--dry-run]
//
// Only kreadconfig6, kwriteconfig6 and qdbus6 are run, so `plan` tests
// with no Plasma. Plasma reads its shortcuts as the session starts, so
// they take effect at the next login.
import { execFileSync } from "node:child_process";
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

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function main() {
  const dry = process.argv.includes("--dry-run");
  const read = (file, group, key) => {
    const v = run("kreadconfig6", ["--file", file, "--group", group, "--key", key]).replace(/\n$/, "");
    return v === "" ? null : v;
  };
  const writes = plan(read);
  for (const w of writes) {
    console.log(`${w.file} [${w.group}] ${w.key}=${w.value.replace(/\t/g, "\\t")}`);
    if (!dry) run("kwriteconfig6", ["--file", w.file, "--group", w.group, "--key", w.key, w.value]);
  }
  if (dry) return;
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
  console.log("tide's keys take over from Plasma's at the next login.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
