// Tests for layout.js, the per-part state: tidemo's layout_test.lua's cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as layout from "./layout.js";

const HD = { x: 0, y: 0, w: 1920, h: 1080 };
const UW = { x: 0, y: 0, w: 3440, h: 1440 };

function part(ids, area = HD, config) {
  const p = layout.create(area, config);
  for (const id of ids) layout.insert(p, id, null, config);
  return p;
}

test("a part starts in tile, or three columns on an ultrawide", () => {
  assert.equal(layout.create(HD).mode, "tile");
  assert.equal(layout.create(UW).mode, "threecol");
});

test("new windows go where newWindow says", () => {
  const at = (newWindow, focused) => {
    const config = Object.assign(layout.copy(layout.DEFAULTS), { newWindow });
    const p = part(["a", "b", "c"]);
    layout.insert(p, "n", focused, config);
    return p.order.join("");
  };
  assert.equal(at("end"), "abcn");
  assert.equal(at("top"), "anbc");
  assert.equal(at("next", "b"), "abnc");
  assert.equal(at("master"), "nabc");
});

test("the top of the stack is counted in the windows tiled now", () => {
  const config = Object.assign(layout.copy(layout.DEFAULTS), { newWindow: "top" });
  const at = (order, tiled) => {
    const p = part(order);
    layout.insert(p, "n", null, config, tiled);
    return p.order.join("");
  };
  // a is minimized, so b is the master and n goes after it
  assert.equal(at(["a", "b", "c"], ["b", "c"]), "abnc");
  // x floats between the master and the stack
  assert.equal(at(["a", "x", "b"], ["a", "b"]), "anxb");
  // Fewer tiled than masters: after the last of them
  assert.equal(at(["a", "x"], ["a"]), "anx");
  assert.equal(at(["x", "y"], []), "xyn");
});

test("a window is in the order once", () => {
  const p = part(["a", "a"]);
  assert.deepEqual(p.order, ["a"]);
});

test("neighbors wrap round, and a window not there gets the first", () => {
  assert.equal(layout.neighbor(["a", "b", "c"], "c", 1), "a");
  assert.equal(layout.neighbor(["a", "b", "c"], "a", -1), "c");
  assert.equal(layout.neighbor(["a", "b"], "x", 1), "a");
  assert.equal(layout.neighbor([], "a", 1), null);
});

test("moving swaps with the neighbor, wrapping", () => {
  const p = part(["a", "b", "c"]);
  layout.move(p, p.order.slice(), "c", 1);
  assert.deepEqual(p.order, ["c", "b", "a"]);
});

test("zoom swaps with the master, and on the master with the one before", () => {
  const p = part(["a", "b", "c"]);
  layout.swapMaster(p, p.order.slice(), "c");
  assert.deepEqual(p.order, ["c", "b", "a"]);
  layout.swapMaster(p, p.order.slice(), "c");
  assert.deepEqual(p.order, ["a", "b", "c"]);
  // With the master before gone, the next window
  layout.remove(p, "c");
  layout.swapMaster(p, p.order.slice(), "a");
  assert.deepEqual(p.order, ["b", "a"]);
});

test("the main share steps and stops at 0.1 and 0.9", () => {
  const p = part(["a"]);
  layout.mfact(p, 0.025);
  assert.equal(p.opts.tile.mfact, 0.575);
  for (let i = 0; i < 40; i++) layout.mfact(p, 0.025);
  assert.equal(p.opts.tile.mfact, 0.9);
  for (let i = 0; i < 80; i++) layout.mfact(p, -0.025);
  assert.equal(p.opts.tile.mfact, 0.1);
});

test("the master count goes down to tile's none, or the others' one", () => {
  const p = part(["a"]);
  layout.nmaster(p, -1);
  layout.nmaster(p, -1);
  assert.equal(p.opts.tile.nmaster, 0, "tile's 0 is all rows");
  layout.nmaster(p, 2);
  assert.equal(p.opts.tile.nmaster, 2);
  layout.cycle(p, 1);
  layout.nmaster(p, -1);
  assert.equal(p.opts.threecol.nmaster, 1);
});

test("each mode keeps its own share", () => {
  const p = part(["a"]);
  layout.mfact(p, 0.05);
  layout.cycle(p, 1);
  assert.equal(p.opts.threecol.mfact, 0.5);
  layout.cycle(p, -1);
  assert.equal(p.opts.tile.mfact, 0.6);
});

test("the cycle wraps, and from monocle starts at the mode before it", () => {
  const p = part(["a"]);
  layout.cycle(p, -1);
  assert.equal(p.mode, "twocol");
  layout.toggleMonocle(p);
  layout.cycle(p, 1);
  assert.equal(p.mode, "tile");
});

test("monocle toggles back to the mode before it", () => {
  const p = part(["a"], UW);
  layout.toggleMonocle(p);
  assert.equal(p.mode, "monocle");
  layout.toggleMonocle(p);
  assert.equal(p.mode, "threecol");
});

test("a part that starts in monocle toggles out of it, to the cycle's first", () => {
  const config = layout.copy(layout.DEFAULTS);
  config.defaultMode.normal = "monocle";
  const p = part(["a", "b"], HD, config);
  assert.equal(p.mode, "monocle");
  layout.toggleMonocle(p, config);
  assert.equal(p.mode, "tile");
  layout.toggleMonocle(p, config);
  assert.equal(p.mode, "monocle");
});

test("the layout used last flips between two", () => {
  const p = part(["a"]);
  layout.last(p);
  assert.equal(p.mode, "tile", "none yet");
  layout.cycle(p, 1);
  layout.last(p);
  assert.equal(p.mode, "tile");
  layout.last(p);
  assert.equal(p.mode, "threecol");
});

test("a dragged lone width beats the single-window rule", () => {
  const p = part(["a"], UW);
  assert.deepEqual(layout.arrange(p, UW, ["a"]).get("a"), { x: 344, y: 0, w: 2752, h: 1440 });
  p.singleWidth = 0.5;
  assert.deepEqual(layout.arrange(p, UW, ["a"]).get("a"), { x: 860, y: 0, w: 1720, h: 1440 });
});

test("new settings reset the shares but keep the mode", () => {
  const p = part(["a"]);
  layout.mfact(p, 0.1);
  layout.cycle(p, 1);
  const config = layout.copy(layout.DEFAULTS);
  config.modes.tile.mfact = 0.7;
  layout.reconfigure(p, config);
  assert.equal(p.mode, "threecol");
  assert.equal(p.opts.tile.mfact, 0.7);
});
