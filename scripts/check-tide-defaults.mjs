// make check-tide-defaults: tide on KDE's defaults, which restate tide for
// Linux's, are still tide for Linux's, read from a tide checkout (the path
// given, ../tide by default), and so are the decoration's shadow colors
// (decoration/zones.h). Usage: node scripts/check-tide-defaults.mjs DIR
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as geometry from "../src/geometry.js";
import * as layout from "../src/layout.js";
import * as workspaces from "../src/workspaces.js";
import { main } from "./tidedefaults.mjs";

export const NAME = "tide on KDE";

// Deliberate differences, by setting, each saying why: they pass while both
// sides keep these values, and fail once either moves. None today.
export const EXCEPTIONS = {};

// Where tide on KDE keeps each default that is tide for Linux's. Its
// settings' defaults (settings.js) are layout.js's and workspaces.js's.
export const SOURCES = [
  { from: "src/layout.js", values: layout.DEFAULTS },
  { from: "src/geometry.js", values: { mfactMin: geometry.MFACT_MIN, mfactMax: geometry.MFACT_MAX } },
  { from: "src/workspaces.js", values: { standing: workspaces.DEFAULT_STANDING } },
];

export const ZONES = "decoration/zones.h";

// The decoration's shadow colors in zones.h's `text`, ShadowLight and
// ShadowDark, as tide's SHADOW_COLORS writes them: { light, dark }, each
// "rrggbbaa".
export function zonesShadowColors(text) {
  const color = (name) => {
    const m = new RegExp(`constexpr Rgba ${name}\\{([^}]*)\\};`).exec(text);
    const parts = m ? m[1].split(",").map((p) => Number(p.trim())) : [];
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      throw new Error(`${ZONES}: no "constexpr Rgba ${name}{r, g, b, a};" found`);
    }
    return parts.map((p) => p.toString(16).padStart(2, "0")).join("");
  };
  return { light: color("ShadowLight"), dark: color("ShadowDark") };
}

// Where `ours`, the decoration's shadow colors, differ from tide's
// SHADOW_COLORS, `tide`, as messages.
export function compareShadowColors(ours, tide) {
  if (!tide || typeof tide !== "object") return ["shadow colors: tide for Linux's shell/lib/appearance.mjs has no SHADOW_COLORS"];
  return ["light", "dark"]
    .filter((k) => ours[k] !== tide[k])
    .map((k) => `shadow colors.${k}: ${NAME} ${JSON.stringify(ours[k])} (${ZONES}), tide for Linux ${JSON.stringify(tide[k])}`);
}

// The shadow colors compared with the tide checkout at `dir`, printed: 0
// if they match, 1 otherwise.
export async function checkShadowColors(dir, err = (s) => process.stderr.write(s)) {
  let problems;
  try {
    const ours = zonesShadowColors(readFileSync(fileURLToPath(new URL(`../${ZONES}`, import.meta.url)), "utf8"));
    const tide = (await import(pathToFileURL(join(dir, "shell/lib/appearance.mjs")).href)).SHADOW_COLORS;
    problems = compareShadowColors(ours, tide);
  } catch (e) {
    err(`check-tide-defaults: ${e.message}\n`);
    return 1;
  }
  for (const p of problems) err(`check-tide-defaults: ${p}\n`);
  return problems.length > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? "../tide";
  const defaults = await main(NAME, SOURCES, dir, EXCEPTIONS);
  const shadows = await checkShadowColors(dir);
  process.exitCode = defaults || shadows;
}
