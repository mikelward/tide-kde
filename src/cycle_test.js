// cycle.js: Alt+Tab held, with a timer of the test's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as cycle from "./cycle.js";

// A Cycle whose pause the test ends with `pause()`, and the choices made.
function held() {
  const t = { pending: null, chosen: [] };
  t.cycle = new cycle.Cycle(
    (ms, f) => {
      assert.equal(ms, cycle.PAUSE_MS);
      const timer = { f, stopped: false, stop: () => (timer.stopped = true) };
      t.pending = timer;
      return timer;
    },
    (c) => t.chosen.push(c),
  );
  t.pause = () => {
    const p = t.pending;
    t.pending = null;
    if (p && !p.stopped) p.f();
  };
  return t;
}

const here = (active, order = ["a", "b", "c"], key = "d1|out-1") => ({ key, active, order });

test("a step goes on round the order, back with -1, and from outside it to the master", () => {
  assert.equal(cycle.step(["a", "b", "c"], "c", 1), "a");
  assert.equal(cycle.step(["a", "b", "c"], "a", -1), "c");
  assert.equal(cycle.step(["a", "b", "c"], "x", 1), "a");
  assert.equal(cycle.step(["a", "b", "c"], null, -1), "a");
  assert.equal(cycle.step([], "a", 1), null);
});

test("the first press moves nothing, and the pause after it chooses the window it began on", () => {
  const t = held();
  assert.equal(t.cycle.press(1, here("c")), null);
  assert.equal(t.cycle.cycling(), true);
  t.pause();
  assert.equal(t.cycle.cycling(), false);
  assert.deepEqual(t.chosen, [{ key: "d1|out-1", start: "c", last: "c", stepped: false, expect: null }]);
});

test("each further press focuses the next window, and only the last pause chooses", () => {
  const t = held();
  t.cycle.press(1, here("c"));
  const first = t.pending;
  assert.equal(t.cycle.press(1, here("c")), "a");
  assert.equal(first.stopped, true, "a press starts the pause again");
  assert.equal(t.cycle.press(1, here("a")), "b");
  assert.equal(t.cycle.press(-1, here("b")), "a");
  assert.equal(t.chosen.length, 0);
  t.pause();
  assert.deepEqual(t.chosen, [{ key: "d1|out-1", start: "c", last: "a", stepped: true, expect: "a" }]);
});

test("a press after the pause begins afresh", () => {
  const t = held();
  t.cycle.press(1, here("c"));
  t.pause();
  assert.equal(t.cycle.press(1, here("c")), null);
});

test("a press in another part begins afresh there", () => {
  const t = held();
  t.cycle.press(1, here("c"));
  assert.equal(t.cycle.press(1, here("x", ["x", "y"], "d2|out-1")), null);
  t.pause();
  assert.equal(t.chosen[0].key, "d2|out-1");
  assert.equal(t.chosen[0].stepped, false);
});

test("a lone window has nowhere to step", () => {
  const t = held();
  t.cycle.press(1, here("a", ["a"]));
  assert.equal(t.cycle.press(1, here("a", ["a"])), null);
  t.pause();
  assert.equal(t.chosen[0].stepped, false);
});

test("cancel ends it with no choice", () => {
  const t = held();
  t.cycle.press(1, here("c"));
  t.cycle.cancel();
  t.pause();
  assert.equal(t.cycle.cycling(), false);
  assert.equal(t.chosen.length, 0);
});

test("a tap swaps, as does a step to a window in the stack", () => {
  const tap = { key: "k", start: "c", last: "c", stepped: false };
  assert.equal(cycle.commits(tap, here("c", ["a", "b", "c"], "k")), true);
  // On the master, a tap swaps it back with the master before it
  assert.equal(cycle.commits({ ...tap, start: "a", last: "a" }, here("a", ["a", "b"], "k")), true);
  assert.equal(cycle.commits({ key: "k", start: "c", last: "b", stepped: true }, here("b", ["a", "b", "c"], "k")), true);
});

test("a step onto the master leaves it", () => {
  assert.equal(cycle.commits({ key: "k", start: "c", last: "a", stepped: true }, here("a", ["a", "b", "c"], "k")), false);
});

test("nothing moves when focus, the part or the window changed meanwhile", () => {
  const c = { key: "k", start: "c", last: "b", stepped: true };
  assert.equal(cycle.commits(c, here("c", ["a", "b", "c"], "k")), false, "focus moved by other means");
  assert.equal(cycle.commits(c, here("b", ["a", "b", "c"], "other")), false, "another workspace");
  assert.equal(cycle.commits(c, here("b", ["a", "c"], "k")), false, "no longer tiled");
  assert.equal(cycle.commits(c, here(null, ["a", "b", "c"], "k")), false, "no focus");
  const tap = { key: "k", start: "c", last: "c", stepped: false };
  assert.equal(cycle.commits(tap, here("b", ["a", "b", "c"], "k")), false, "a tap, then a click elsewhere");
});

test("only the focus a step asked for keeps it going", () => {
  const t = held();
  t.cycle.press(1, here("c"));
  assert.equal(t.cycle.press(1, here("c")), "a");
  assert.equal(t.cycle.focused("a"), false, "the step's own");
  assert.equal(t.cycle.cycling(), true);
  assert.equal(t.cycle.focused("a"), true, "the same again, not asked for");
  assert.equal(t.cycle.cycling(), false);
  t.pause();
  assert.equal(t.chosen.length, 0);
});

test("focus going away and back ends it, and so does no focus", () => {
  for (const ids of [["b", "c"], [null]]) {
    const t = held();
    t.cycle.press(1, here("c"));
    for (const id of ids) t.cycle.focused(id);
    t.pause();
    assert.equal(t.chosen.length, 0, String(ids));
  }
});
