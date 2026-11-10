// Tests for settings.js: KWin's config for the script, checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as settings from "./settings.js";
import * as layout from "./layout.js";

const load = (values) => settings.load((k) => values[k]);

test("with nothing set, tide's defaults", () => {
  const { config, standing, errors } = load({});
  assert.deepEqual(errors, []);
  assert.deepEqual(standing, ["in", "re", "oc", "me"]);
  assert.deepEqual(config, layout.DEFAULTS);
});

test("each setting reaches the config", () => {
  const { config, standing, errors } = load({
    standing: "home, web",
    ultrawideAspect: "2.3",
    normalMode: "twocol",
    ultrawideMode: "monocle",
    tileMfact: 0.6,
    tileNmaster: "0",
    threecolNmaster: "2",
    single: "2.1:0.7, 3:0.5",
    newWindow: "top",
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(standing, ["home", "web"]);
  assert.equal(config.ultrawideAspect, 2.3);
  assert.deepEqual(config.defaultMode, { normal: "twocol", ultrawide: "monocle" });
  assert.deepEqual(config.modes.tile, { mfact: 0.6, nmaster: 0 });
  assert.equal(config.modes.threecol.nmaster, 2);
  assert.deepEqual(config.single, [{ minAspect: 2.1, width: 0.7 }, { minAspect: 3, width: 0.5 }]);
  assert.equal(config.newWindow, "top");
});

test("an empty single-window rule fills the width", () => {
  assert.deepEqual(load({ single: " " }).config.single, []);
});

test("each bad setting is named, and keeps its default", () => {
  const { config, errors } = load({
    tileMfact: "0.95",
    twocolNmaster: "1.5",
    threecolNmaster: "0",
    normalMode: "spiral",
    single: "wide",
    newWindow: "",
    ultrawideAspect: "x",
  });
  assert.deepEqual(errors, [
    'ultrawideAspect must be a number from 0.1 to 100, not "x"',
    'normalMode must be one of tile, threecol, twocol, monocle, not "spiral"',
    'tileMfact must be a number from 0.1 to 0.9, not "0.95"',
    'threecolNmaster must be a whole number from 1 to 100, not "0"',
    'twocolNmaster must be a whole number from 1 to 100, not "1.5"',
    'single must be aspect:width pairs split by commas, as 2.1:0.8, not "wide"',
    'newWindow must be one of end, top, next, master, not ""',
  ]);
  assert.deepEqual(config, layout.DEFAULTS);
});
