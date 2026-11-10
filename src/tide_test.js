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

test("the keys act on the active monitor's part with no window", () => {
  const { ws, env, tide } = start();
  env.press("tide-next-layout");
  const a = ws.open();
  ws.open();
  assert.equal(tide.parts.size, 1);
  assert.deepEqual(box(a), [0, 0, 960, 1080]);
});

test("home is the first desktop, and a desktop already named home stays", () => {
  assert.deepEqual(start().ws.desktops.map((d) => d.name), ["in"]);
  const { ws } = start({ desktops: ["web", "IN"] });
  assert.deepEqual(ws.desktops.map((d) => d.name), ["web", "IN"]);
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

test("a made desktop with a window stays when left", () => {
  const { ws, env } = start();
  ws.createDesktop(1, "work");
  env.press("tide-go-0");
  ws.open();
  env.press("tide-home");
  assert.deepEqual(ws.desktops.map((d) => d.name), ["in", "work"]);
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
  ws.createDesktop(1, "work");
  env.press("tide-go-0");
  ws.open({ minSize: { width: 300, height: 200 }, maxSize: { width: 300, height: 200 } });
  env.press("tide-home");
  assert.deepEqual(ws.desktops.map((d) => d.name), ["in", "work"]);
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
  env.press("tide-minimize");
  assert.ok(dialog.minimized);
  env.press("tide-close");
  assert.ok(dialog.deleted);
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

function effects(env) {
  return env.calls.filter((c) => c[2] === "org.kde.kwin.Effects").map((c) => c[3]);
}

test("the dim is on only while a monitor shows two windows", () => {
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

test("a window on every desktop counts toward the dim", () => {
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
