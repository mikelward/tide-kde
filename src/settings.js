// tide-kde's settings, from KWin's config for the script (kwinrc's
// [Script-tide-kde] group, which the script's settings dialog writes), in
// tide's names where tide has them (tide SPEC.md §16). Free of KWin's API:
// `read(key)` gives a setting's value as KWin's readConfig does, or
// undefined when it isn't set.
//
// A bad setting is an error naming it, and that setting keeps its default,
// so one typo never stops the rest loading.
import * as layout from "./layout.js";
import * as workspaces from "./workspaces.js";

const MODES = ["tile", "threecol", "twocol", "monocle"];
const NEW_WINDOW = ["end", "top", "next", "master"];

// Every setting, with its default as the settings dialog shows it.
export const KEYS = {
  standing: workspaces.DEFAULT_STANDING.join(", "),
  ultrawideAspect: String(layout.DEFAULTS.ultrawideAspect),
  normalMode: layout.DEFAULTS.defaultMode.normal,
  ultrawideMode: layout.DEFAULTS.defaultMode.ultrawide,
  tileMfact: String(layout.DEFAULTS.modes.tile.mfact),
  tileNmaster: String(layout.DEFAULTS.modes.tile.nmaster),
  threecolMfact: String(layout.DEFAULTS.modes.threecol.mfact),
  threecolNmaster: String(layout.DEFAULTS.modes.threecol.nmaster),
  twocolMfact: String(layout.DEFAULTS.modes.twocol.mfact),
  twocolNmaster: String(layout.DEFAULTS.modes.twocol.nmaster),
  single: layout.DEFAULTS.single.map((r) => `${r.minAspect}:${r.width}`).join(", "),
  newWindow: layout.DEFAULTS.newWindow,
};

function number(key, text, lo, hi, whole) {
  const s = String(text).trim();
  const v = Number(s);
  if (s === "" || !Number.isFinite(v) || v < lo || v > hi || (whole && !Number.isInteger(v))) {
    return { error: `${key} must be ${whole ? "a whole number" : "a number"} from ${lo} to ${hi}, not ${JSON.stringify(s)}` };
  }
  return { value: v };
}

function oneOf(key, text, list) {
  const s = String(text).trim();
  return list.includes(s) ? { value: s } : { error: `${key} must be one of ${list.join(", ")}, not ${JSON.stringify(s)}` };
}

// The single-window rule's text, "aspect:width" pairs split by commas, as
// [{minAspect, width}]. An empty one is no rule: lone windows fill.
function singleRules(key, text) {
  const rules = [];
  for (const item of String(text).split(",").map((s) => s.trim()).filter((s) => s !== "")) {
    const m = /^([^:]+):([^:]+)$/.exec(item);
    if (!m) return { error: `${key} must be aspect:width pairs split by commas, as 2.1:0.8, not ${JSON.stringify(item)}` };
    const aspect = number(`${key}'s aspect`, m[1], 0, 100);
    if (aspect.error) return aspect;
    const width = number(`${key}'s width`, m[2], 0.1, 1);
    if (width.error) return width;
    rules.push({ minAspect: aspect.value, width: width.value });
  }
  return { value: rules };
}

// {config, standing, errors}: the layout config for layout.js, the standing
// names, and an error for each setting that couldn't be used.
export function load(read) {
  const config = layout.copy(layout.DEFAULTS);
  const errors = [];
  let standing = [...workspaces.DEFAULT_STANDING];
  const get = (key) => {
    const v = read(key);
    return v === undefined || v === null ? KEYS[key] : v;
  };
  const take = (result, set) => {
    if (result.error) errors.push(result.error);
    else set(result.value);
  };

  const s = workspaces.parseStanding(get("standing"));
  if (s.error) errors.push(s.error);
  else standing = s.names;
  take(number("ultrawideAspect", get("ultrawideAspect"), 0.1, 100), (v) => (config.ultrawideAspect = v));
  take(oneOf("normalMode", get("normalMode"), MODES), (v) => (config.defaultMode.normal = v));
  take(oneOf("ultrawideMode", get("ultrawideMode"), MODES), (v) => (config.defaultMode.ultrawide = v));
  for (const mode of ["tile", "threecol", "twocol"]) {
    take(number(`${mode}Mfact`, get(`${mode}Mfact`), 0.1, 0.9), (v) => (config.modes[mode].mfact = v));
    take(number(`${mode}Nmaster`, get(`${mode}Nmaster`), layout.MIN_MASTERS[mode], 100, true), (v) => (config.modes[mode].nmaster = v));
  }
  take(singleRules("single", get("single")), (v) => (config.single = v));
  take(oneOf("newWindow", get("newWindow"), NEW_WINDOW), (v) => (config.newWindow = v));
  return { config, standing, errors };
}
