// Each workspace part's layout (SPEC.md §4.1): its window order, its mode
// and each mode's main share (mfact) and master count. Free of KWin's API,
// so it tests in plain Node. A port of tidemo's hammerspoon/tide/layout.lua,
// itself after tide's hypr/tide/layout.lua; the geometry is tide's,
// unchanged (geometry.js).
import * as geometry from "./geometry.js";

// tide's defaults, so a workspace looks the same on every desktop.
export const DEFAULTS = {
  ultrawideAspect: 2.1,
  defaultMode: { normal: "tile", ultrawide: "threecol" },
  single: [
    { minAspect: 2.1, width: 0.8 },
    { minAspect: 3.2, width: 0.6 },
  ],
  modes: {
    tile: { mfact: 0.55, nmaster: 1 },
    threecol: { mfact: 0.5, nmaster: 1 },
    twocol: { mfact: 0.72, nmaster: 2 },
    monocle: {},
  },
  cycle: ["tile", "threecol", "twocol"],
  // Where a new window goes: the "end" of the stack, the "top" of it, "next"
  // after the focused window, or in as the "master".
  newWindow: "end",
  mfactStep: 0.025,
};

export const SYMBOLS = { tile: "[]=", threecol: "|M|", twocol: "||=", monocle: "[M]" };

// What tide's bar shows for `mode` with `tiled` tiled windows: monocle
// shows how many windows it hides, `[n]`, and `[M]` while it hides none, as
// tide's shell/lib/layouts.mjs's layoutSymbol does.
export function symbol(mode, tiled) {
  if (mode === "monocle" && tiled > 1) return `[${tiled - 1}]`;
  return SYMBOLS[mode] ?? "";
}

export function copy(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

// A new part, in the default mode for its area's shape.
export function create(area, config = DEFAULTS) {
  const aspect = area && area.h > 0 ? area.w / area.h : 0;
  const mode = aspect >= config.ultrawideAspect ? config.defaultMode.ultrawide : config.defaultMode.normal;
  return { mode, opts: copy(config.modes), order: [] };
}

// Puts `id` into the order where config.newWindow says. `focused` is the
// window that had focus, for "next".
export function insert(part, id, focused, config = DEFAULTS) {
  if (part.order.includes(id)) return;
  const nmaster = part.opts[part.mode]?.nmaster ?? 1;
  let at = part.order.length;
  if (config.newWindow === "master") at = 0;
  else if (config.newWindow === "top") at = Math.min(nmaster, part.order.length);
  else if (config.newWindow === "next") {
    const i = part.order.indexOf(focused);
    if (i >= 0) at = i + 1;
  }
  part.order.splice(at, 0, id);
}

export function remove(part, id) {
  const i = part.order.indexOf(id);
  if (i >= 0) part.order.splice(i, 1);
}

// The window `delta` places from `id` in `ids`, wrapping round. `ids` is
// the order filtered to the windows that are tiled now.
export function neighbor(ids, id, delta) {
  if (ids.length === 0) return null;
  const i = ids.indexOf(id);
  if (i < 0) return ids[0];
  return ids[(((i + delta) % ids.length) + ids.length) % ids.length];
}

function swap(list, a, b) {
  const i = list.indexOf(a);
  const j = list.indexOf(b);
  if (i >= 0 && j >= 0) [list[i], list[j]] = [list[j], list[i]];
}

// Swaps `id` with its neighbor `delta` places along `ids`.
export function move(part, ids, id, delta) {
  const other = neighbor(ids, id, delta);
  if (other !== null && other !== id) swap(part.order, id, other);
}

// Swaps two windows, as a drag of one onto the other does.
export function swapWindows(part, a, b) {
  swap(part.order, a, b);
}

// Alt+Tab (tide SPEC.md §6.6): any other window swaps with the master,
// which the part remembers; the master swaps with the window that was
// master before it, or with the next window, as dwm's zoom, if that one's
// gone.
export function swapMaster(part, ids, id) {
  if (ids.length < 2 || !ids.includes(id)) return;
  let other;
  let displaced;
  if (ids[0] === id) {
    const prev = part.prevMaster;
    other = prev !== id && ids.includes(prev) ? prev : ids[1];
    displaced = id;
  } else {
    other = ids[0];
    displaced = other;
  }
  part.prevMaster = displaced;
  swap(part.order, id, other);
}

export function mfact(part, delta) {
  const o = part.opts[part.mode];
  if (o?.mfact !== undefined) o.mfact = Math.round(geometry.clamp(o.mfact + delta, 0.1, 0.9) * 1000) / 1000;
}

export function setMfact(part, value) {
  const o = part.opts[part.mode];
  if (o?.mfact !== undefined) o.mfact = geometry.clamp(value, 0.1, 0.9);
}

// The fewest masters each mode with a master takes, as tide's
// shell/lib/layouts.mjs checks them: tile's 0 is all rows.
export const MIN_MASTERS = { tile: 0, threecol: 1, twocol: 1 };

export function nmaster(part, delta) {
  const o = part.opts[part.mode];
  if (o?.nmaster !== undefined) o.nmaster = Math.max(MIN_MASTERS[part.mode] ?? 1, o.nmaster + delta);
}

// The mode changes to `mode`, keeping the one before as lastMode, for the
// layout used last (dwm's Super+Space).
export function setMode(part, mode) {
  if (mode !== part.mode) part.lastMode = part.mode;
  part.mode = mode;
}

// The mode used before this one, so two presses come back; with none yet,
// nothing. Monocle's toggle still goes back to the mode before it.
export function last(part) {
  const to = part.lastMode;
  if (!to) return;
  if (to === "monocle") part.prevMode = part.mode;
  else if (part.mode === "monocle") part.prevMode = undefined;
  setMode(part, to);
}

// Steps through config.cycle; from monocle, steps from the mode before it.
export function cycle(part, delta, config = DEFAULTS) {
  const list = config.cycle;
  const from = part.mode === "monocle" ? (part.prevMode ?? list[0]) : part.mode;
  const i = Math.max(0, list.indexOf(from));
  part.prevMode = undefined;
  setMode(part, list[(((i + delta) % list.length) + list.length) % list.length]);
}

export function toggleMonocle(part, config = DEFAULTS) {
  if (part.mode === "monocle") {
    const back = part.prevMode ?? config.defaultMode.normal;
    part.prevMode = undefined;
    setMode(part, back);
  } else {
    part.prevMode = part.mode;
    setMode(part, "monocle");
  }
}

// The single-window rule in force: a width a lone window was dragged to on
// this part beats the configured one.
export function singleRules(part, config = DEFAULTS) {
  return part.singleWidth ? [{ minAspect: 0, width: part.singleWidth }] : config.single;
}

// Boxes for `ids` (the tiled windows, in order) in `area`, as a Map from id.
export function arrange(part, area, ids, config = DEFAULTS) {
  const boxes = geometry.arrange(part.mode, area, ids.length, part.opts[part.mode], singleRules(part, config));
  return new Map(ids.map((id, i) => [id, boxes[i]]));
}

// What the settings change on a part already made, as tide's reload does
// (tide SPEC.md §16): it keeps its mode, and takes the new mfact and master
// count, losing any it was given with the keys.
export function reconfigure(part, config) {
  part.opts = copy(config.modes);
}
