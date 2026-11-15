// tide.js against a fake KWin (fake_kwin.js): what a headless KWin can't
// be made to do, dragging above all. tests/kwin/ runs the same in a real one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Tide } from "./tide.js";
import { FakeWindow, FakeWorkspace, fakeEnv } from "./fake_kwin.js";
import { KEYS } from "./keys.js";

function start(opts = {}, config = {}) {
  const ws = new FakeWorkspace(opts);
  const env = fakeEnv(ws, config);
  const tide = new Tide(env);
  tide.start();
  return { ws, env, tide };
}

function box(w) {
  const g = w.frameGeometry;
  return [g.x, g.y, g.width, g.height];
}

test("every key is registered once, under its own name", () => {
  const { env } = start();
  assert.equal(env.shortcuts.size, KEYS.length);
  assert.equal(new Set(KEYS.map((k) => k.name)).size, KEYS.length);
});

test("windows tile as they open", () => {
  const { ws } = start();
  const a = ws.open();
  assert.deepEqual(box(a), [0, 0, 1920, 1080]);
  const b = ws.open();
  assert.deepEqual([box(a), box(b)], [[0, 0, 1056, 1080], [1056, 0, 864, 1080]]);
});

test("a dialog, a fixed-size window and one on every desktop float", () => {
  const { ws } = start();
  const a = ws.open();
  const dialog = ws.open({ transient: true });
  const fixed = ws.open({ minSize: { width: 300, height: 200 }, maxSize: { width: 300, height: 200 } });
  const sticky = ws.open({ _desktops: [] });
  assert.deepEqual(box(a), [0, 0, 1920, 1080]);
  for (const w of [dialog, fixed, sticky]) assert.deepEqual(box(w), [100, 100, 400, 300]);
});

test("dragging the master's edge sets the main share", () => {
  const { ws } = start();
  const a = ws.open();
  const b = ws.open();
  a.drag({ width: 1200 }, { resize: true });
  assert.deepEqual([box(a), box(b)], [[0, 0, 1200, 1080], [1200, 0, 720, 1080]]);
  // It stays with the workspace's part
  ws.open();
  assert.equal(box(a)[2], 1200);
});

test("dragging the stack's edge sets the main share too", () => {
  const { ws } = start();
  const a = ws.open();
  const b = ws.open();
  b.drag({ x: 960, width: 960 }, { resize: true });
  assert.deepEqual([box(a), box(b)], [[0, 0, 960, 1080], [960, 0, 960, 1080]]);
});

test("dragging a lone window's edge sets its width, centered", () => {
  const { ws } = start();
  const a = ws.open();
  // Its right edge 720 px right of the middle: half of 1440
  a.drag({ width: 1680 }, { resize: true });
  assert.deepEqual(box(a), [240, 0, 1440, 1080]);
});

test("a window dropped on another swaps with it", () => {
  const { ws } = start();
  const a = ws.open();
  const b = ws.open();
  a.drag({ x: 1300, y: 300 }, { cursor: { x: 1500, y: 500 } });
  assert.deepEqual([box(a), box(b)], [[1056, 0, 864, 1080], [0, 0, 1056, 1080]]);
});

test("a window dropped on nothing goes back to its tile", () => {
  const { ws } = start();
  const a = ws.open();
  ws.open();
  a.drag({ x: 300, y: 300 }, { cursor: { x: 400, y: 400 } });
  assert.deepEqual(box(a), [0, 0, 1056, 1080]);
});

test("each monitor's part of a workspace tiles on its own", () => {
  const { ws } = start({
    outputs: [
      { name: "left", x: 0, y: 0, width: 1920, height: 1080 },
      { name: "right", x: 1920, y: 0, width: 3440, height: 1440 },
    ],
  });
  const a = ws.open();
  ws.activeScreen = ws.screens[1];
  const b = ws.open();
  assert.deepEqual([box(a), box(b)], [[0, 0, 1920, 1080], [1920 + 344, 0, 2752, 1440]]);
  // Moved to the left monitor, it joins that part
  b.setOutput(ws.screens[0]);
  assert.deepEqual([box(a), box(b)], [[0, 0, 1056, 1080], [1056, 0, 864, 1080]]);
});

test("a window moved to another desktop leaves its tile", () => {
  const { ws, env } = start();
  const a = ws.open();
  const b = ws.open();
  env.press("tide-send-2");
  assert.deepEqual(box(a), [0, 0, 1920, 1080]);
  assert.equal(b.desktops[0].name, "re");
});

test("a maximized or fullscreen window leaves the layout", () => {
  const { ws, env } = start();
  const a = ws.open();
  const b = ws.open();
  env.press("tide-maximize");
  assert.equal(b.maximizeMode, 3);
  assert.deepEqual(box(a), [0, 0, 1920, 1080]);
  // Pressed again, it toggles back, as tide's Super+X does
  env.press("tide-maximize");
  assert.equal(b.maximizeMode, 0);
  assert.deepEqual(box(a), [0, 0, 1056, 1080]);
  env.press("tide-maximize");
  env.press("tide-restore");
  assert.equal(b.maximizeMode, 0);
  assert.deepEqual(box(a), [0, 0, 1056, 1080]);
  env.press("tide-fullscreen");
  assert.ok(b.fullScreen);
  assert.deepEqual(box(a), [0, 0, 1920, 1080]);
});

test("the layout used last comes back with two presses", () => {
  const { ws, env } = start();
  const a = ws.open();
  ws.open();
  env.press("tide-next-layout");
  env.press("tide-last-layout");
  assert.deepEqual(box(a), [0, 0, 1056, 1080]);
  env.press("tide-last-layout");
  // Three columns, which two windows share
  assert.deepEqual(box(a), [0, 0, 960, 1080]);
});

test("with normalMode monocle, the monocle key still leaves monocle", () => {
  const { ws, env } = start({}, { normalMode: "monocle" });
  const a = ws.open();
  const b = ws.open();
  assert.deepEqual([box(a), box(b)], [[0, 0, 1920, 1080], [0, 0, 1920, 1080]]);
  env.press("tide-monocle");
  assert.deepEqual([box(a), box(b)], [[0, 0, 1056, 1080], [1056, 0, 864, 1080]]);
  env.press("tide-monocle");
  assert.deepEqual([box(a), box(b)], [[0, 0, 1920, 1080], [0, 0, 1920, 1080]]);
});

test("the keys act on the active monitor's part with no window", () => {
  const { ws, env, tide } = start();
  env.press("tide-next-layout");
  const a = ws.open();
  ws.open();
  assert.equal(tide.parts.size, 1);
  assert.deepEqual(box(a), [0, 0, 960, 1080]);
});

test("every standing workspace is made at start, home from the first desktop", () => {
  assert.deepEqual(start().ws.desktops.map((d) => d.name), ["in", "re", "oc", "me"]);
  // One named already stays where it is, and the rest go after it in order
  const { ws } = start({ desktops: ["web", "IN", "oc"] });
  assert.deepEqual(ws.desktops.map((d) => d.name), ["web", "IN", "re", "oc", "me"]);
  assert.deepEqual(start({}, { standing: "home, work" }).ws.desktops.map((d) => d.name), ["home", "work"]);
});

test("Super+End toggles between the last two workspaces other than home", () => {
  const { ws, env } = start();
  env.press("tide-go-2");
  env.press("tide-go-3");
  env.press("tide-home");
  env.press("tide-last-other");
  assert.equal(ws.currentDesktop.name, "oc");
  env.press("tide-last-other");
  assert.equal(ws.currentDesktop.name, "re");
  env.press("tide-last-other");
  assert.equal(ws.currentDesktop.name, "oc");
});

// tide's next_attention (tide SPEC.md §6.6), on KWin's own urgency: the
// window that wanted attention last, on any workspace.
test("the next-attention key goes to the newest window wanting attention, with its workspace, and clears it", () => {
  const { ws, env } = start();
  const a = ws.open();
  env.press("tide-go-2");
  const b = ws.open();
  env.press("tide-go-3");
  const c = ws.open();
  env.press("tide-home");
  ws.activeWindow = a;
  c.demandsAttention = true;
  b.demandsAttention = true;
  env.press("tide-next-attention");
  assert.equal(ws.currentDesktop.name, "re");
  assert.equal(ws.activeWindow, b);
  assert.equal(b.demandsAttention, false);
  env.press("tide-next-attention");
  assert.equal(ws.currentDesktop.name, "oc", "the next press goes to the next");
  assert.equal(ws.activeWindow, c);
  // One that stops wanting it on its own is passed over
  b.demandsAttention = true;
  a.demandsAttention = true;
  b.demandsAttention = false;
  env.press("tide-next-attention");
  assert.equal(ws.activeWindow, a);
  assert.equal(ws.currentDesktop.name, "in");
});

test("a window wanting attention as tide starts counts, and a closed one doesn't", () => {
  const ws = new FakeWorkspace();
  const env = fakeEnv(ws);
  const a = ws.open();
  const b = ws.open();
  a.demandsAttention = true;
  new Tide(env).start();
  const c = ws.open();
  ws.activeWindow = b;
  c.demandsAttention = true;
  c.closeWindow();
  env.press("tide-next-attention");
  assert.equal(ws.activeWindow, a);
});

test("with nothing wanting attention, the next-attention key does nothing", () => {
  const { ws, env } = start();
  const a = ws.open();
  env.press("tide-go-2");
  ws.open();
  env.press("tide-home");
  ws.activeWindow = a;
  env.press("tide-next-attention");
  assert.equal(ws.currentDesktop.name, "in", "not the last workspace");
  assert.equal(ws.activeWindow, a, "nor the last window");
});

test("the next-attention key has no default key, as restore", () => {
  const k = KEYS.find((x) => x.name === "tide-next-attention");
  assert.equal(k?.title, "Go to the next window wanting attention");
  assert.equal(k.key, "");
});

test("a made desktop with a window stays when left", () => {
  const { ws, env } = start();
  ws.createDesktop(ws.desktops.length, "work");
  env.press("tide-go-0");
  ws.open();
  env.press("tide-home");
  assert.deepEqual(ws.desktops.map((d) => d.name), ["in", "re", "oc", "me", "work"]);
});

test("a bad setting is a notification naming it", () => {
  const { env } = start({}, { standing: "in, in" });
  assert.ok(env.logs.some((l) => l.includes("standing: in is listed twice")), env.logs);
  const notify = env.calls.find((c) => c[3] === "Notify");
  assert.ok(notify[8].includes("standing: in is listed twice"));
});

test("settings set the layouts", () => {
  const { ws } = start({}, { tileMfact: "0.6", newWindow: "master" });
  const a = ws.open();
  const b = ws.open();
  assert.deepEqual([box(b), box(a)], [[0, 0, 1152, 1080], [1152, 0, 768, 1080]]);
});

test("newWindow top puts a window after the master, with one minimized before it", () => {
  const { ws } = start({}, { newWindow: "top" });
  const a = ws.open();
  const b = ws.open();
  const c = ws.open();
  // c went to the top of the stack, after the master a
  assert.deepEqual([box(a), box(c), box(b)], [[0, 0, 1056, 1080], [1056, 0, 864, 540], [1056, 540, 864, 540]]);
  a.minimized = true;
  assert.deepEqual([box(c), box(b)], [[0, 0, 1056, 1080], [1056, 0, 864, 1080]]);
  const n = ws.open();
  // c stays the master; n is the top of the stack
  assert.deepEqual([box(c), box(n), box(b)], [[0, 0, 1056, 1080], [1056, 0, 864, 540], [1056, 540, 864, 540]]);
});

test("a key that fails is logged, and the rest go on", () => {
  const { ws, env, tide } = start();
  tide.zoom = () => {
    throw new Error("boom");
  };
  ws.open();
  env.press("tide-zoom");
  assert.ok(env.logs.some((l) => l.includes("tide-zoom failed: Error: boom")));
  env.press("tide-monocle");
});

test("a desktop with only a fixed-size window isn't empty", () => {
  const { ws, env } = start();
  ws.createDesktop(ws.desktops.length, "work");
  env.press("tide-go-0");
  ws.open({ minSize: { width: 300, height: 200 }, maxSize: { width: 300, height: 200 } });
  env.press("tide-home");
  assert.deepEqual(ws.desktops.map((d) => d.name), ["in", "re", "oc", "me", "work"]);
});

test("single set empty makes a lone window fill an ultrawide", () => {
  const { ws } = start({ outputs: [{ name: "uw", x: 0, y: 0, width: 3440, height: 1440 }] }, { single: "" });
  assert.deepEqual(box(ws.open()), [0, 0, 3440, 1440]);
});

test("the window keys act on a dialog and a fixed-size window", () => {
  const { ws, env } = start();
  ws.open();
  const fixed = ws.open({ minSize: { width: 300, height: 200 }, maxSize: { width: 300, height: 200 } });
  env.press("tide-send-2");
  assert.equal(fixed.desktops[0].name, "re");
  const dialog = ws.open({ normalWindow: false, dialog: true, transient: true });
  env.press("tide-close");
  assert.ok(dialog.deleted);
  const other = ws.open({ normalWindow: false, dialog: true, transient: true });
  env.press("tide-minimize");
  assert.ok(other.minimized);
});

test("a window fullscreen as tide starts tiles once it isn't", () => {
  const ws = new FakeWorkspace();
  const a = new FakeWindow(ws);
  ws.windows.push(a);
  a.fullScreen = true;
  const b = new FakeWindow(ws);
  ws.windows.push(b);
  const env = fakeEnv(ws);
  new Tide(env).start();
  assert.deepEqual(box(b), [0, 0, 1920, 1080]);
  a.fullScreen = false;
  assert.deepEqual([box(a), box(b)], [[0, 0, 1056, 1080], [1056, 0, 864, 1080]]);
});

test("a window on another activity takes no tile", () => {
  const { ws } = start();
  const a = ws.open({ activities: ["a1"] });
  const b = ws.open({ activities: ["a2"] });
  assert.deepEqual(box(a), [0, 0, 1920, 1080]);
  ws.currentActivity = "a2";
  assert.deepEqual(box(b), [0, 0, 1920, 1080]);
});

function pairOfMonitors() {
  return {
    outputs: [
      { name: "A", x: 0, y: 0, width: 1920, height: 1080 },
      { name: "B", x: 1920, y: 0, width: 1920, height: 1080 },
    ],
  };
}

test("left and right focus across windows, then monitors", () => {
  const { ws, env } = start(pairOfMonitors());
  const a1 = ws.open();
  const a2 = ws.open();
  ws.activeScreen = ws.screens[1];
  const b1 = ws.open();
  ws.activeWindow = a1;
  env.press("tide-focus-right");
  assert.equal(ws.activeWindow, a2);
  env.press("tide-focus-right");
  assert.equal(ws.activeWindow, b1);
  env.press("tide-focus-right");
  assert.equal(ws.activeWindow, b1, "nothing past the last monitor");
});

test("moving right swaps on the monitor, then lands on the next one's near edge", () => {
  const { ws, env } = start(pairOfMonitors());
  const a1 = ws.open();
  const a2 = ws.open();
  ws.activeScreen = ws.screens[1];
  const b1 = ws.open();
  ws.activeWindow = a1;
  env.press("tide-move-right");
  assert.deepEqual([box(a2), box(a1)], [[0, 0, 1056, 1080], [1056, 0, 864, 1080]]);
  env.press("tide-move-right");
  assert.equal(a1.output.name, "B");
  // It came in by B's left edge, so it's B's master
  assert.deepEqual([box(a1), box(b1), box(a2)], [[1920, 0, 1056, 1080], [2976, 0, 864, 1080], [0, 0, 1920, 1080]]);
});

test("a floating window moves to the same spot on the next monitor", () => {
  const { ws, env } = start(pairOfMonitors());
  ws.open();
  const f = ws.open();
  env.press("tide-float");
  f.frameGeometry = { x: 96, y: 54, width: 400, height: 300 };
  env.press("tide-move-right");
  assert.equal(f.output.name, "B");
  assert.deepEqual(box(f), [2016, 54, 400, 300]);
});

test("right from an empty monitor's edge focuses the next monitor", () => {
  const { ws, env } = start(pairOfMonitors());
  ws.activeWindow = null;
  env.press("tide-focus-right");
  assert.equal(ws.activeScreen.name, "B");
});

function stackedMonitors() {
  return {
    outputs: [
      { name: "A", x: 0, y: 0, width: 1920, height: 1080 },
      { name: "B", x: 0, y: 1080, width: 1920, height: 1080 },
    ],
  };
}

test("maximize, fullscreen and the arrows have tide's keys", () => {
  const keyOf = (name) => KEYS.find((k) => k.name === name).key;
  assert.deepEqual(
    ["tide-maximize", "tide-fullscreen", "tide-restore", "tide-focus-above", "tide-focus-below", "tide-move-above", "tide-move-below"].map(keyOf),
    ["Meta+X", "Meta+Shift+X", "", "Meta+Up", "Meta+Down", "Meta+Shift+Up", "Meta+Shift+Down"],
  );
});

test("up and down focus along the stack, then the monitor below, not the stack from the master", () => {
  const { ws, env } = start(stackedMonitors());
  const a1 = ws.open();
  const a2 = ws.open();
  const a3 = ws.open();
  ws.activeScreen = ws.screens[1];
  const b1 = ws.open();
  ws.activeWindow = a2;
  env.press("tide-focus-below");
  assert.equal(ws.activeWindow, a3);
  env.press("tide-focus-below");
  assert.equal(ws.activeWindow, b1);
  // Up from B: the window at A's bottom edge sharing the most width
  env.press("tide-focus-above");
  assert.equal(ws.activeWindow, a1);
  env.press("tide-focus-above");
  assert.equal(ws.activeWindow, a1, "nothing above the top monitor");
  env.press("tide-focus-below");
  assert.equal(ws.activeWindow, b1, "from the master, down is the monitor below");
});

test("moving down swaps along the stack, then lands on the monitor below's top edge", () => {
  const { ws, env } = start(stackedMonitors());
  const a1 = ws.open();
  const a2 = ws.open();
  const a3 = ws.open();
  ws.activeScreen = ws.screens[1];
  const b1 = ws.open();
  ws.activeWindow = a2;
  env.press("tide-move-below");
  assert.deepEqual([box(a1), box(a3), box(a2)], [[0, 0, 1056, 1080], [1056, 0, 864, 540], [1056, 540, 864, 540]]);
  env.press("tide-move-below");
  assert.equal(a2.output.name, "B");
  // Of B's places, the master and the stack both touch its top edge; the
  // stack shares more width with where a2 was
  assert.deepEqual([box(b1), box(a2)], [[0, 1080, 1056, 1080], [1056, 1080, 864, 1080]]);
  env.press("tide-move-above");
  assert.equal(a2.output.name, "A");
});

test("a floating window moves to the same spot on the monitor below", () => {
  const { ws, env } = start(stackedMonitors());
  ws.open();
  const f = ws.open();
  env.press("tide-float");
  f.frameGeometry = { x: 96, y: 54, width: 400, height: 300 };
  env.press("tide-move-below");
  assert.equal(f.output.name, "B");
  assert.deepEqual(box(f), [96, 1134, 400, 300]);
});

test("down from an empty monitor's edge focuses the monitor below", () => {
  const { ws, env } = start(stackedMonitors());
  ws.activeWindow = null;
  env.press("tide-focus-below");
  assert.equal(ws.activeScreen.name, "B");
});

function effects(env) {
  return env.calls.filter((c) => c[2] === "org.kde.kwin.Effects").map((c) => c[3]);
}

test("dimming is on only while a monitor shows two windows", () => {
  const { ws, env } = start();
  assert.deepEqual(effects(env), ["unloadEffect"]);
  ws.open();
  const b = ws.open();
  assert.deepEqual(effects(env), ["unloadEffect", "loadEffect"]);
  b.minimized = true;
  assert.deepEqual(effects(env), ["unloadEffect", "loadEffect", "unloadEffect"]);
});

test("one window on each of two monitors isn't dimmed", () => {
  const { ws, env } = start(pairOfMonitors());
  ws.open();
  ws.activeScreen = ws.screens[1];
  ws.open();
  assert.deepEqual(effects(env), ["unloadEffect"]);
});

test("a window on every desktop counts toward dimming", () => {
  const { ws, env } = start();
  ws.open();
  const sticky = ws.open({ _desktops: [] });
  assert.deepEqual(effects(env), ["unloadEffect", "loadEffect"]);
  sticky.closeWindow();
  assert.deepEqual(effects(env), ["unloadEffect", "loadEffect", "unloadEffect"]);
});

test("with dim false, tide leaves Dim Inactive alone", () => {
  const { ws, env } = start({}, { dim: "false" });
  ws.open();
  ws.open();
  assert.deepEqual(effects(env), []);
});

function announced(env) {
  const calls = env.calls.filter((c) => c[3] === "evaluateScript" && c[4].includes('writeConfig("layouts"'));
  if (calls.length === 0) return null;
  const m = /writeConfig\("layouts", ("(?:[^"\\]|\\.)*")\)/.exec(calls.at(-1)[4]);
  return JSON.parse(JSON.parse(m[1]));
}

test("the layout widget hears each monitor's layout as it changes", () => {
  const { ws, env } = start({
    outputs: [
      { name: "A", x: 0, y: 0, width: 1920, height: 1080 },
      { name: "B", x: 1920, y: 0, width: 3440, height: 1440 },
    ],
  });
  assert.deepEqual(announced(env), { A: { symbol: "[]=", mode: "tile" }, B: { symbol: "|M|", mode: "threecol" } });
  ws.open();
  ws.open();
  env.press("tide-monocle");
  assert.deepEqual(announced(env).A, { symbol: "[1]", mode: "monocle" });
  const count = env.calls.length;
  env.press("tide-focus-down");
  assert.equal(env.calls.length, count, "nothing new, nothing written");
});

test("a widget that asks hears the layouts again", () => {
  const { env } = start();
  const count = env.calls.length;
  env.press("tide-announce");
  assert.equal(env.calls.length, count + 1);
  assert.deepEqual(announced(env), { "out-1": { symbol: "[]=", mode: "tile" } });
});

test("a click on a monitor's widget changes that monitor's layout", () => {
  const { ws, env } = start(pairOfMonitors());
  ws.open();
  ws.cursorPos = { x: 2500, y: 10 };
  env.press("tide-next-layout-here");
  assert.deepEqual(announced(env), { A: { symbol: "[]=", mode: "tile" }, B: { symbol: "|M|", mode: "threecol" } });
});

test("tiles make room for a panel as it comes, changes and goes", () => {
  const { ws, env } = start();
  const a = ws.open();
  const panel = ws.open({ dock: true, normalWindow: false, frameGeometry: { x: 0, y: 1040, width: 1920, height: 40 } });
  assert.deepEqual(box(a), [0, 0, 1920, 1040]);
  panel.frameGeometry = { x: 0, y: 1000, width: 1920, height: 80 };
  panel.frameGeometryChanged.emit();
  assert.deepEqual(box(a), [0, 0, 1920, 1000]);
  ws.close(panel);
  env.settle();
  assert.deepEqual(box(a), [0, 0, 1920, 1080]);
});

// What tide last told the launcher wants attention, from its calls.
function attention(env) {
  const calls = env.calls.filter((c) => c[3] === "evaluateScript" && c[4].includes('writeConfig("attention"'));
  if (calls.length === 0) return undefined;
  const m = /writeConfig\("attention", ("(?:[^"\\]|\\.)*")\)/.exec(calls.at(-1)[4]);
  return JSON.parse(JSON.parse(m[1]));
}

test("the launcher hears which windows want attention, as they change", () => {
  const { ws, env } = start();
  assert.deepEqual(attention(env), [], "a session's start clears what the last one left");
  const a = ws.open();
  const b = ws.open();
  const before = env.calls.length;
  a.demandsAttention = true;
  assert.deepEqual(attention(env), [a.internalId]);
  b.demandsAttention = true;
  assert.deepEqual(attention(env), [a.internalId, b.internalId].sort());
  a.demandsAttention = false;
  assert.deepEqual(attention(env), [b.internalId]);
  ws.close(b);
  assert.deepEqual(attention(env), []);
  const writes = env.calls.slice(before).filter((c) => c[4].includes('"attention"')).length;
  a.minimized = true;
  assert.equal(env.calls.slice(before).filter((c) => c[4].includes('"attention"')).length, writes, "nothing changed, nothing written");
});

test("a dialog wanting attention counts too", () => {
  const { ws, env } = start();
  const d = ws.open({ transient: true });
  d.demandsAttention = true;
  assert.deepEqual(attention(env), [d.internalId]);
});

// --- Focus after minimizing or closing (tide SPEC.md §6.7, §14.2) --------
//
// The fake decides as KWin does (activateNextWindow, with its defaults),
// before tide hears and lays out again, and with `lag` the apps resize
// only at `ack`, as they do after KWin has decided: so where a window will
// be is where tide's layout puts it, not its frame yet.

const TWO = [
  { name: "left", x: 0, y: 0, width: 1920, height: 1080 },
  { name: "right", x: 1920, y: 0, width: 1920, height: 1080 },
];

const FIXED = { minSize: { width: 400, height: 300 }, maxSize: { width: 400, height: 300 } };

// A fixed-size window on the right monitor that reaches onto the left
// one, at `y`: KWin's focus chain counts it for the left monitor
// (FocusChain::isUsableFocusCandidate), tide doesn't.
function overhang(ws, y = 100) {
  ws.activeScreen = ws.screens[1];
  const x = ws.open(Object.assign({ frameGeometry: { x: 1800, y, width: 400, height: 300 } }, FIXED));
  ws.activeScreen = ws.screens[0];
  return x;
}

test("minimizing the window you're in focuses the one that tiles in under the pointer", () => {
  const { ws, env } = start({ lag: true });
  const a = ws.open();
  const b = ws.open();
  ws.open();
  ws.activeWindow = a;
  ws.ack();
  env.settle();
  ws.cursorPos = { x: 500, y: 500 };
  env.press("tide-minimize");
  assert.ok(a.minimized);
  assert.equal(ws.activeWindow, b, "b took the master's place, under the pointer");
});

test("minimizing with the pointer over a panel focuses the window used before on that monitor", () => {
  const { ws, env } = start({ outputs: TWO, lag: true });
  ws.open({ dock: true, normalWindow: false, frameGeometry: { x: 0, y: 1040, width: 1920, height: 40 } });
  const a = ws.open();
  const g = ws.open();
  overhang(ws);
  ws.activeWindow = g;
  ws.ack();
  env.settle();
  ws.cursorPos = { x: 100, y: 1060 };
  env.press("tide-minimize");
  assert.equal(ws.activeWindow, a, "not KWin's pick from the other monitor");
});

test("minimizing with the pointer on another monitor focuses the window used before on this one", () => {
  const { ws, env } = start({ outputs: TWO, lag: true });
  const a = ws.open();
  const g = ws.open();
  ws.activeScreen = ws.screens[1];
  ws.open();
  overhang(ws);
  ws.activeWindow = g;
  ws.ack();
  env.settle();
  ws.cursorPos = { x: 3000, y: 900 };
  env.press("tide-minimize");
  assert.equal(ws.activeWindow, a, "not the window under the pointer there");
});

test("minimizing with the pointer where a floating window overhangs another monitor focuses the one used before", () => {
  const { ws, env } = start({ outputs: TWO, lag: true });
  // From the left monitor, reaching 180 px onto the right
  const f = ws.open(Object.assign({ frameGeometry: { x: 1700, y: 100, width: 400, height: 300 } }, FIXED));
  const a = ws.open();
  const g = ws.open();
  overhang(ws, 700);
  ws.activeWindow = g;
  ws.ack();
  env.settle();
  ws.cursorPos = { x: 2000, y: 200 };
  env.press("tide-minimize");
  assert.equal(f.output.name, "left");
  assert.equal(ws.activeWindow, a, "not the floating window, whose part there is on the other monitor");
});

test("minimizing with the pointer where another monitor's window reaches over a tile focuses the tile", () => {
  const { ws, env } = start({ outputs: TWO, lag: true });
  const a = ws.open();
  ws.open();
  const c = ws.open();
  overhang(ws);
  ws.activeWindow = a;
  ws.ack();
  env.settle();
  ws.cursorPos = { x: 1850, y: 200 };
  env.press("tide-minimize");
  assert.equal(ws.activeWindow, c, "the tile under the overhanging window, which is the other monitor's");
});

test("minimizing with the pointer over a window wanting attention leaves it waiting", () => {
  const { ws, env } = start({ lag: true });
  const a = ws.open();
  const b = ws.open();
  const c = ws.open();
  ws.activeWindow = b;
  ws.activeWindow = a;
  b.demandsAttention = true;
  ws.ack();
  env.settle();
  ws.cursorPos = { x: 500, y: 500 };
  env.press("tide-minimize");
  assert.equal(ws.activeWindow, c, "the window used before, past the one waiting");
  assert.equal(b.demandsAttention, true, "KWin's own pick of it doesn't clear its mark");
  assert.deepEqual(attention(env), [b.internalId]);
});

test("minimizing a window you aren't in moves no focus", () => {
  const { ws, env } = start({ lag: true });
  const a = ws.open();
  ws.open();
  const c = ws.open();
  ws.activeWindow = a;
  env.settle();
  ws.activeWindow = c;
  ws.ack();
  env.settle();
  ws.cursorPos = { x: 500, y: 500 };
  // As a taskbar does
  a.minimized = true;
  assert.equal(ws.activeWindow, c);
});

test("a minimized dialog gives focus to its parent, as KWin does", () => {
  const { ws, env } = start({ lag: true });
  const p = ws.open();
  ws.open();
  const d = ws.open({ normalWindow: false, dialog: true, transient: true, transientFor: p });
  ws.ack();
  env.settle();
  ws.cursorPos = { x: 1500, y: 500 };
  env.press("tide-minimize");
  assert.ok(d.minimized);
  assert.equal(ws.activeWindow, p);
});

test("closing the window you're in focuses the one that tiles in under the pointer", () => {
  const { ws, env } = start({ lag: true });
  const a = ws.open();
  const b = ws.open();
  ws.open();
  ws.activeWindow = a;
  ws.ack();
  env.settle();
  ws.cursorPos = { x: 500, y: 500 };
  env.press("tide-close");
  assert.ok(a.deleted);
  assert.equal(ws.activeWindow, b, "b took the master's place, under the pointer");
});

test("closing the window you're in focuses the window under the pointer on another monitor", () => {
  const { ws, env } = start({ outputs: TWO, lag: true });
  ws.open();
  const g = ws.open();
  ws.activeScreen = ws.screens[1];
  const c = ws.open();
  ws.activeWindow = g;
  ws.ack();
  env.settle();
  ws.cursorPos = { x: 3000, y: 500 };
  env.press("tide-close");
  assert.equal(ws.activeWindow, c);
});

test("closing with the pointer over a window wanting attention leaves KWin's pick", () => {
  const { ws, env } = start({ lag: true });
  const a = ws.open();
  const b = ws.open();
  const c = ws.open();
  ws.activeWindow = a;
  b.demandsAttention = true;
  ws.ack();
  env.settle();
  ws.cursorPos = { x: 500, y: 500 };
  env.press("tide-close");
  assert.equal(ws.activeWindow, c);
  assert.equal(b.demandsAttention, true);
});

test("closing a window you aren't in moves no focus", () => {
  const { ws, env } = start({ lag: true });
  const a = ws.open();
  ws.open();
  const c = ws.open();
  ws.activeWindow = a;
  env.settle();
  ws.activeWindow = c;
  ws.ack();
  env.settle();
  ws.cursorPos = { x: 500, y: 500 };
  a.closeWindow();
  assert.equal(ws.activeWindow, c);
});
