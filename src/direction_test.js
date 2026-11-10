// Tests for direction.js: tide's hypr/tide/direction_test.lua's cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as direction from "./direction.js";

const box = (x, y, w, h) => ({ x, y, w, h });
const tile = (address, x, y, w, h) => ({ address, box: box(x, y, w, h) });

// Two 1920x1080 monitors side by side, each in tile: a master and two in
// the stack on the left one, a master and one on the right.
function pair() {
  return [
    { name: "A", box: box(0, 0, 1920, 1080), tiles: [tile("a1", 0, 0, 1056, 1080), tile("a2", 1056, 0, 864, 540), tile("a3", 1056, 540, 864, 540)] },
    { name: "B", box: box(1920, 0, 1920, 1080), tiles: [tile("b1", 1920, 0, 1056, 1080), tile("b2", 2976, 0, 864, 1080)] },
  ];
}

test("left and right pick the window that way on the same monitor", () => {
  const m = pair();
  let r = direction.find(m[0].tiles[0].box, "A", m, 1);
  assert.equal(r.tile.address, "a2", "the master's right: the first of two sharing its height");
  assert.equal(r.monitor.name, "A");
  r = direction.find(m[0].tiles[2].box, "A", m, -1);
  assert.equal(r.tile.address, "a1", "the stack's left is the master");
});

test("at a monitor's edge they go on to the nearest window on the next one", () => {
  const m = pair();
  let r = direction.find(m[0].tiles[2].box, "A", m, 1);
  assert.equal(r.monitor.name, "B");
  assert.equal(r.tile.address, "b1", "its leftmost window, sharing the most height");
  r = direction.find(m[1].tiles[0].box, "B", m, -1);
  assert.equal(r.monitor.name, "A");
  assert.equal(r.tile.address, "a2", "a window at A's right edge, not the taller master behind them");
});

test("past the last monitor, nothing", () => {
  const m = pair();
  assert.equal(direction.find(m[1].tiles[1].box, "B", m, 1), null);
  assert.equal(direction.find(m[0].tiles[0].box, "A", m, -1), null);
});

test("a monitor that way with no windows is picked with no window", () => {
  const m = pair();
  m[1].tiles = [];
  const r = direction.find(m[0].tiles[1].box, "A", m, 1);
  assert.equal(r.tile, null);
  assert.equal(r.monitor.name, "B");
});

test("the next monitor is the one sharing the most height, then the nearest", () => {
  const m = [
    { name: "L", box: box(0, 600, 1920, 1200), tiles: [tile("l1", 0, 600, 1920, 1200)] },
    { name: "U", box: box(1920, 0, 1920, 1080), tiles: [tile("u1", 1920, 0, 1920, 1080)] },
    { name: "D", box: box(1920, 1080, 1920, 1080), tiles: [tile("d1", 1920, 1080, 1920, 1080)] },
  ];
  const r = direction.find(m[0].tiles[0].box, "L", m, 1);
  assert.equal(r.monitor.name, "D", "720 px shared beats 480");
  assert.equal(r.tile.address, "d1");
});

test("a window there whose center is back past yours still counts", () => {
  const m = [
    { name: "A", box: box(0, 0, 1000, 1000), tiles: [tile("a1", 900, 0, 100, 1000)] },
    { name: "B", box: box(1000, 0, 100, 1000), tiles: [tile("b1", 1000, 0, 100, 1000)] },
  ];
  assert.equal(direction.find(m[0].tiles[0].box, "A", m, 1).tile.address, "b1");
});

test("an unknown monitor finds nothing", () => {
  assert.equal(direction.find(box(0, 0, 1, 1), "Z", pair(), 1), null);
});

test("a window lands at the edge it came in by, sharing the most height", () => {
  const slots = [box(1920, 0, 1056, 1080), box(2976, 0, 864, 540), box(2976, 540, 864, 540)];
  assert.equal(direction.landing(slots, 1, box(1056, 540, 864, 540)), 0, "moving right lands as the master");
  assert.equal(direction.landing(slots, -1, box(4000, 600, 500, 400)), 2, "moving left lands in the stack, at its height");
  assert.equal(direction.landing(slots, -1, box(4000, 0, 500, 400)), 1, "or higher up");
});

test("in monocle every place ties, so the first", () => {
  const slots = [box(0, 0, 10, 10), box(0, 0, 10, 10)];
  assert.equal(direction.landing(slots, 1, box(0, 0, 10, 10)), 0);
  assert.equal(direction.landing([], 1, box(0, 0, 10, 10)), null);
});

test("the next monitor is the one that way, by the same rule", () => {
  const m = pair();
  assert.equal(direction.nextMonitor(m[0], m, 1).name, "B");
  assert.equal(direction.nextMonitor(m[1], m, -1).name, "A");
  assert.equal(direction.nextMonitor(m[1], m, 1), null);
});

// A float moving from a 1920x1046 work area to one half its size, below
// the same 34 px bar.
const FROM = box(0, 34, 1920, 1046);
const TO = box(1920, 34, 960, 523);

test("a float in the top left lands in the top left", () => {
  assert.deepEqual(direction.place(box(96, 86, 400, 300), FROM, TO), box(1968, 60, 400, 300));
});

test("a float in the bottom right lands in the bottom right", () => {
  const b = direction.place(box(1420, 680, 500, 400), FROM, TO);
  assert.equal(b.x + b.w, TO.x + TO.w);
  assert.equal(b.y + b.h, TO.y + TO.h);
  assert.deepEqual([b.w, b.h], [500, 400]);
  const same = direction.place(box(1420, 680, 500, 400), FROM, box(1920, 34, 1920, 1046));
  assert.deepEqual([same.x, same.y], [3340, 680]);
});

test("a float too big for the next monitor shrinks to fit inside it", () => {
  assert.deepEqual(direction.place(box(100, 100, 1200, 600), FROM, TO), box(1920, 34, 960, 523));
  const wide = direction.place(box(800, 100, 1200, 300), FROM, TO);
  assert.deepEqual([wide.w, wide.h, wide.y], [960, 300, 34 + Math.floor((66 / 1046) * 523 + 0.5)]);
});
