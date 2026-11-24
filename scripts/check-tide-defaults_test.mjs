// Tests for check-tide-defaults.mjs's own part: the decoration's shadow
// colors, read from zones.h, compared with tide's SHADOW_COLORS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkShadowColors, compareShadowColors, zonesShadowColors } from "./check-tide-defaults.mjs";

const ZONES_H = readFileSync(new URL("../decoration/zones.h", import.meta.url), "utf8");

test("zones.h's shadow colors read as tide writes them: black by day, a glow by night", () => {
  assert.deepEqual(zonesShadowColors(ZONES_H), { light: "00000044", dark: "ededf155" });
});

test("a zones.h without them is an error naming the constant", () => {
  assert.throws(() => zonesShadowColors("constexpr Rgba ShadowLight{0, 0, 0, 0x44};"), /ShadowDark/);
  assert.throws(() => zonesShadowColors("constexpr Rgba ShadowLight{0, 0, 0};\nconstexpr Rgba ShadowDark{1, 2, 3, 4};"), /ShadowLight/);
});

test("matching colors pass, and a drifted one is named with both values", () => {
  const ours = { light: "00000044", dark: "ededf155" };
  assert.deepEqual(compareShadowColors(ours, { light: "00000044", dark: "ededf155" }), []);
  assert.deepEqual(compareShadowColors(ours, { light: "00000044", dark: "ffffff66" }), [
    'shadow colors.dark: tide on KDE "ededf155" (decoration/zones.h), tide for Linux "ffffff66"',
  ]);
  assert.match(compareShadowColors(ours, undefined)[0], /no SHADOW_COLORS/);
});

// A tide checkout with `appearance` as its shell/lib/appearance.mjs
async function withTide(appearance, f) {
  const dir = mkdtempSync(join(tmpdir(), "tide-"));
  try {
    mkdirSync(join(dir, "shell/lib"), { recursive: true });
    writeFileSync(join(dir, "shell/lib/appearance.mjs"), appearance);
    return await f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the check against a checkout passes when tide agrees and fails when it doesn't", async () => {
  for (const [appearance, code, said] of [
    ['export const SHADOW_COLORS = Object.freeze({ light: "00000044", dark: "ededf155" });\n', 0, []],
    ['export const SHADOW_COLORS = Object.freeze({ light: "00000033", dark: "ededf155" });\n', 1, [/colors\.light/]],
    ["export const SHADOW_SIZE = 16;\n", 1, [/no SHADOW_COLORS/]],
  ]) {
    const errors = [];
    const got = await withTide(appearance, (dir) => checkShadowColors(dir, (s) => errors.push(s)));
    assert.equal(got, code, appearance);
    assert.equal(errors.length, said.length, errors.join(""));
    said.forEach((re, i) => assert.match(errors[i], re));
  }
});
