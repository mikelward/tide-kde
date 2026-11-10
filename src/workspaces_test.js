// Tests for workspaces.js: tide's workspace rules over KWin's desktops.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as ws from "./workspaces.js";

function view(names, { current = names[0], windows = {}, recent = [], standing = ws.DEFAULT_STANDING } = {}) {
  return {
    standing,
    desktops: names.map((name) => ({ id: name, name, windows: windows[name] ?? 0 })),
    current,
    recent,
  };
}

test("a name is one trimmed line without quotes, backslashes, @ or control characters", () => {
  assert.deepEqual(ws.checkName("  web "), { name: "web" });
  for (const bad of ["", "a\nb", 'say "hi"', "a\\b", "me@work", "tab\there", "bell\u0007", "c1\u0085"]) {
    assert.ok(ws.checkName(bad).error, JSON.stringify(bad));
  }
  assert.ok(ws.checkName("x".repeat(33)).error);
  assert.deepEqual(ws.checkName("é".repeat(32)), { name: "é".repeat(32) });
});

test("the standing list needs a name, and no name twice", () => {
  assert.deepEqual(ws.parseStanding("in, re ,oc"), { names: ["in", "re", "oc"] });
  assert.match(ws.parseStanding(" , ").error, /at least one/);
  assert.match(ws.parseStanding("in,IN").error, /in is listed twice/i);
  assert.match(ws.parseStanding("in,a@b").error, /standing: "a@b"/);
});

test("the bar lists the standing names, made or not, then the rest", () => {
  const order = ws.barOrder(view(["IN", "web", "oc"])).map((w) => [w.name, w.desktop ? w.desktop.id : null]);
  assert.deepEqual(order, [["IN", "IN"], ["re", null], ["oc", "oc"], ["me", null], ["web", "web"]]);
});

test("the nth counts along the bar, 0 being the last", () => {
  const v = view(["in", "web"]);
  assert.equal(ws.nth(v, 1).name, "in");
  assert.equal(ws.nth(v, 2).name, "re");
  assert.equal(ws.nth(v, 0).name, "web");
  assert.equal(ws.nth(v, 9), null);
});

test("a new standing desktop goes after the standing ones before it", () => {
  const v = view(["in", "me", "web"]);
  assert.equal(ws.position(v, "re"), 1);
  assert.equal(ws.position(v, "oc"), 1);
  assert.equal(ws.position(view(["in", "re", "me"]), "oc"), 2);
  assert.equal(ws.position(v, "new"), 3);
});

test("stepping passes over empty workspaces and wraps", () => {
  const v = view(["in", "re", "oc", "web"], { current: "web", windows: { re: 1 } });
  assert.equal(ws.step(v, 1, { withWindows: true }).name, "re");
  assert.equal(ws.step(v, -1, { withWindows: true }).name, "re");
  assert.equal(ws.step(v, 1).name, "in");
  assert.equal(ws.step(view(["in"]), 1, { withWindows: true }), null);
});

test("home or back flips between home and the last other", () => {
  const away = view(["in", "re"], { current: "re" });
  assert.equal(ws.homeOrBack(away).name, "in");
  const home = view(["in", "re", "oc"], { current: "in", recent: ["oc", "re"] });
  assert.equal(ws.homeOrBack(home).name, "oc");
  assert.equal(ws.homeOrBack(view(["in"])), null);
});

test("the last other skips home, the current one and ones gone", () => {
  const v = view(["in", "re", "oc"], { current: "re", recent: ["gone", "in", "re", "oc"] });
  assert.equal(ws.lastOther(v).name, "oc");
});

test("only empty desktops that aren't standing or showing are left empty", () => {
  const v = view(["in", "re", "web", "work", "now"], { current: "now", windows: { work: 1 } });
  assert.deepEqual(ws.leftEmpty(v).map((d) => d.name), ["web"]);
});

test("history keeps the most recent first, once each", () => {
  assert.deepEqual(ws.remember(["b", "c"], "c", "a"), ["c", "b"]);
  assert.deepEqual(ws.remember([], "a", "a"), []);
});
