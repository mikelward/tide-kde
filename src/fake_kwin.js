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
      "activitiesChanged",
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
  windowList() {
    return [...this.windows];
  }
  clientArea(_option, output) {
    const g = output.geometry;
    return { x: g.x, y: g.y, width: g.width, height: g.height };
  }
  createDesktop(position, name) {
    this.desktops.splice(position, 0, this.newDesktop(name));
    this.desktopsChanged.emit();
  }
  removeDesktop(d) {
    this.desktops = this.desktops.filter((x) => x !== d);
    this.desktopsChanged.emit();
  }
  open(props = {}) {
    const w = new FakeWindow(this, props);
    this.windows.push(w);
    this.windowAdded.emit(w);
    this.activeWindow = w;
    return w;
  }
  close(w) {
    this.windows = this.windows.filter((x) => x !== w);
    w.deleted = true;
    if (this.activeWindow === w) this.activeWindow = this.windows.at(-1) ?? null;
    this.windowRemoved.emit(w);
  }
}

// The env tide.js takes, around `ws`: shortcuts by name in `shortcuts`,
// config from `config`, D-Bus calls in `calls`, the log in `logs`.
export function fakeEnv(ws, config = {}) {
  const env = {
    workspace: ws,
    KWin: { PlacementArea: 0, MaximizeArea: 2 },
    shortcuts: new Map(),
    calls: [],
    logs: [],
    registerShortcut(name, _title, _key, f) {
      env.shortcuts.set(name, f);
    },
    readConfig(key, fallback) {
      return Object.hasOwn(config, key) ? config[key] : fallback;
    },
    callDBus(...args) {
      env.calls.push(args);
    },
    print(text) {
      env.logs.push(text);
    },
    press(name) {
      const f = env.shortcuts.get(name);
      if (!f) throw new Error(`no shortcut ${name}`);
      f();
    },
  };
  return env;
}
