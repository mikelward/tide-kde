// A stand-in for what KWin's script engine gives a script, enough for
// tide.js's tests: signals, windows, desktops, outputs and shortcuts. It
// sets geometry at once, where KWin waits for the app; harness.py's tests
// run the same script in a real KWin.

export class Signal {
  constructor() {
    this.slots = [];
  }
  connect(f) {
    this.slots.push(f);
  }
  emit(...args) {
    for (const f of [...this.slots]) f(...args);
  }
}

let nextId = 1;

export class FakeWindow {
  constructor(ws, props = {}) {
    this.ws = ws;
    this.internalId = `{w${nextId++}}`;
    this.resourceClass = props.resourceClass ?? "app";
    this.managed = true;
    this.deleted = false;
    this.normalWindow = true;
    this.dialog = false;
    this.utility = false;
    this.activities = [];
    this.transient = false;
    this.specialWindow = false;
    this.popupWindow = false;
    this.dock = false;
    this._demandsAttention = false;
    this.skipTaskbar = false;
    this.moveable = true;
    this.resizeable = true;
    this.minimizable = true;
    this.maximizable = true;
    this.fullScreenable = true;
    this.minSize = { width: 0, height: 0 };
    this.maxSize = { width: 32767, height: 32767 };
    this._minimized = false;
    this._fullScreen = false;
    this.maximizeMode = 0;
    this.move = false;
    this.resize = false;
    this._desktops = [ws.currentDesktop];
    this.output = ws.activeScreen;
    this.frameGeometry = { x: 100, y: 100, width: 400, height: 300 };
    this.closed = false;
    for (const s of ["desktopsChanged", "outputChanged", "minimizedChanged", "fullScreenChanged", "maximizedChanged",
      "activitiesChanged", "frameGeometryChanged", "demandsAttentionChanged",
      "interactiveMoveResizeStarted", "interactiveMoveResizeFinished"]) this[s] = new Signal();
    Object.assign(this, props);
  }
  get desktops() {
    return this._desktops;
  }
  set desktops(v) {
    this._desktops = v;
    this.desktopsChanged.emit();
  }
  get demandsAttention() {
    return this._demandsAttention;
  }
  set demandsAttention(v) {
    this._demandsAttention = v;
    this.demandsAttentionChanged.emit();
  }
  get minimized() {
    return this._minimized;
  }
  set minimized(v) {
    this._minimized = v;
    this.minimizedChanged.emit();
  }
  get fullScreen() {
    return this._fullScreen;
  }
  set fullScreen(v) {
    this._fullScreen = v;
    // As KWin's own: a fullscreen window can't be moved or resized
    this.moveable = !v;
    this.resizeable = !v;
    this.fullScreenChanged.emit();
  }
  setMaximize(v, h) {
    this.maximizeMode = (v ? 1 : 0) | (h ? 2 : 0);
    this.maximizedChanged.emit();
  }
  setOutput(o) {
    this.output = o;
    this.outputChanged.emit();
  }
  closeWindow() {
    this.ws.close(this);
  }
  // An interactive drag that ends at `box`, with the cursor at `cursor`.
  drag(box, { resize = false, cursor = null } = {}) {
    this.resize = resize;
    this.move = !resize;
    this.interactiveMoveResizeStarted.emit();
    this.frameGeometry = Object.assign({}, this.frameGeometry, box);
    if (cursor) this.ws.cursorPos = cursor;
    this.resize = false;
    this.move = false;
    this.interactiveMoveResizeFinished.emit();
  }
}

export class FakeWorkspace {
  constructor({ outputs = [{ name: "out-1", x: 0, y: 0, width: 1920, height: 1080 }], desktops = ["Desktop 1"] } = {}) {
    this.screens = outputs.map((o) => ({ name: o.name, geometry: { x: o.x, y: o.y, width: o.width, height: o.height } }));
    this.activeScreen = this.screens[0];
    this.desktops = [];
    this.nextDesktop = 1;
    for (const name of desktops) this.desktops.push(this.newDesktop(name));
    this._current = this.desktops[0];
    this.windows = [];
    this.activeWindow = null;
    this.cursorPos = { x: 0, y: 0 };
    this._activity = "a1";
    for (const s of ["windowAdded", "windowRemoved", "currentDesktopChanged", "screensChanged", "desktopsChanged",
      "virtualScreenGeometryChanged", "currentActivityChanged"]) this[s] = new Signal();
  }
  newDesktop(name) {
    return { id: `d${this.nextDesktop++}`, name };
  }
  get currentDesktop() {
    return this._current;
  }
  set currentDesktop(d) {
    const previous = this._current;
    this._current = d;
    if (previous !== d) this.currentDesktopChanged.emit(previous);
  }
  get currentActivity() {
    return this._activity;
  }
  set currentActivity(a) {
    this._activity = a;
    this.currentActivityChanged.emit(a);
  }
  screenAt(pos) {
    return this.screens.find((o) => {
      const g = o.geometry;
      return pos.x >= g.x && pos.x < g.x + g.width && pos.y >= g.y && pos.y < g.y + g.height;
    }) ?? null;
  }
  windowList() {
    return [...this.windows];
  }
  // The output less the panels along its bottom edge, as KWin's
  // placement area leaves out a panel's room.
  clientArea(_option, output) {
    const g = output.geometry;
    let height = g.height;
    for (const w of this.windows) {
      const f = w.frameGeometry;
      if (w.dock && w.output === output && f.y + f.height === g.y + g.height) height = Math.min(height, f.y - g.y);
    }
    return { x: g.x, y: g.y, width: g.width, height };
  }
  createDesktop(position, name) {
    this.desktops.splice(position, 0, this.newDesktop(name));
    this.desktopsChanged.emit();
  }
  removeDesktop(d) {
    this.desktops = this.desktops.filter((x) => x !== d);
    this.desktopsChanged.emit();
  }
  sendClientToScreen(w, output) {
    w.setOutput(output);
  }
  slotSwitchToRightScreen() {
    this.activeScreen = this.screens[Math.min(this.screens.indexOf(this.activeScreen) + 1, this.screens.length - 1)];
  }
  slotSwitchToLeftScreen() {
    this.activeScreen = this.screens[Math.max(this.screens.indexOf(this.activeScreen) - 1, 0)];
  }
  // The nearest screen wholly above or below the active one, if any.
  slotSwitchToAboveScreen() {
    const g = this.activeScreen.geometry;
    const above = this.screens.filter((o) => o.geometry.y + o.geometry.height <= g.y);
    if (above.length) this.activeScreen = above.reduce((a, b) => (b.geometry.y > a.geometry.y ? b : a));
  }
  slotSwitchToBelowScreen() {
    const g = this.activeScreen.geometry;
    const below = this.screens.filter((o) => o.geometry.y >= g.y + g.height);
    if (below.length) this.activeScreen = below.reduce((a, b) => (b.geometry.y < a.geometry.y ? b : a));
  }
  open(props = {}) {
    const w = new FakeWindow(this, props);
    this.windows.push(w);
    this.windowAdded.emit(w);
    this.activeWindow = w;
    return w;
  }
  close(w) {
    // As KWin's own, a panel's room is still taken as it says it's gone
    if (w.dock) this.windowRemoved.emit(w);
    this.windows = this.windows.filter((x) => x !== w);
    w.deleted = true;
    if (this.activeWindow === w) this.activeWindow = this.windows.at(-1) ?? null;
    if (!w.dock) this.windowRemoved.emit(w);
  }
}

// The env tide.js takes, around `ws`: shortcuts by name in `shortcuts`,
// config from `config`, D-Bus calls in `calls`, the log in `logs`, and
// what's to run later in `pending`, until `settle`.
export function fakeEnv(ws, config = {}) {
  const env = {
    workspace: ws,
    KWin: { PlacementArea: 0, MaximizeArea: 2 },
    shortcuts: new Map(),
    calls: [],
    pending: [],
    logs: [],
    registerShortcut(name, _title, _key, f) {
      env.shortcuts.set(name, f);
    },
    readConfig(key, fallback) {
      return Object.hasOwn(config, key) ? config[key] : fallback;
    },
    callDBus(...args) {
      const reply = typeof args.at(-1) === "function" ? args.pop() : null;
      env.calls.push(args);
      if (reply) reply(true);
    },
    print(text) {
      env.logs.push(text);
    },
    later(f) {
      env.pending.push(f);
    },
    settle() {
      while (env.pending.length) env.pending.shift()();
    },
    press(name) {
      const f = env.shortcuts.get(name);
      if (!f) throw new Error(`no shortcut ${name}`);
      f();
    },
  };
  return env;
}
