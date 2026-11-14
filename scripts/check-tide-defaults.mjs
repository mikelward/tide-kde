// make check-tide-defaults: tide on KDE's defaults, which restate tide for
// Linux's, are still tide for Linux's, read from a tide checkout (the path
// given, ../tide by default). Usage: node scripts/check-tide-defaults.mjs DIR
import { pathToFileURL } from "node:url";
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(NAME, SOURCES, process.argv[2] ?? "../tide", EXCEPTIONS);
}
