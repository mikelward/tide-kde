// A stand-in for what KWin's script engine gives a script, enough for
// tide.js's tests: signals, windows, desktops, outputs and shortcuts. It
// sets geometry at once, where KWin waits for the app to resize, unless
// made with `lag`, where geometry set waits for `ack`. harness.py's tests
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

function sameFrame(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export class FakeWindow {
  constructor(ws, props = {}) {
    this.ws = ws;
    this.internalId = `{w${nextId++}}`;
    this.resourceClass = props.resourceClass ?? "app";
    this._caption = props.caption ?? "";
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
    this._frame = { x: 100, y: 100, width: 400, height: 300 };
    this.requested = null;
    this.closed = false;
    for (const s of ["desktopsChanged", "outputChanged", "minimizedChanged", "fullScreenChanged", "maximizedChanged",
      "activitiesChanged", "captionNormalChanged", "frameGeometryAboutToChange", "frameGeometryChanged", "demandsAttentionChanged",
      "interactiveMoveResizeStarted", "interactiveMoveResizeStepped", "interactiveMoveResizeFinished"]) this[s] = new Signal();
    Object.assign(this, props);
    if (props.frameGeometry) this._frame = props.frameGeometry;
  }
  // As KWin's XdgSurfaceWindow::moveResizeInternal: a resize is asked of
  // the app, and the frame changes only once it's done, here at `ack`.
  get frameGeometry() {
    return this._frame;
  }
  set frameGeometry(v) {
    if (this.ws.lag) this.requested = v;
    else this._frame = v;
  }
  get desktops() {
    return this._desktops;
  }
  set desktops(v) {
    this._desktops = v;
    this.desktopsChanged.emit();
  }
  // KWin's caption adds " <2>" and the like to a second window with the
  // same title; captionNormal is the title as the app gave it.
  get captionNormal() {
    return this._caption;
  }
  set caption(v) {
    this._caption = v;
    this.captionNormalChanged.emit();
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
  // As KWin's Window::setMinimized: the window you're in gives focus to
  // KWin's pick (XdgToplevelWindow::doMinimize) before minimizedChanged.
  set minimized(v) {
    if (v === this._minimized) return;
    this._minimized = v;
    if (v) this.ws.activateNext(this);
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
  // An interactive resize, step by step, as KWin's
  // Window::updateInteractiveMoveResize: each step says where the window
  // is going, which its frame follows.
  resizeStart() {
    this.resize = true;
    this.interactiveMoveResizeStarted.emit();
  }
  resizeStep(box) {
    const g = Object.assign({}, this.frameGeometry, box);
    this.frameGeometryAboutToChange.emit();
    this.frameGeometry = g;
    this.interactiveMoveResizeStepped.emit(g);
    if (!this.ws.lag) this.frameGeometryChanged.emit();
  }
  resizeEnd() {
    this.resize = false;
    this.interactiveMoveResizeFinished.emit();
  }
  // A resize cancelled, as with Escape: KWin's finishInteractiveMoveResize
  // asks the window to go back to `start`, where it began, and says it
  // finished, with no step; the frame follows once the app has resized.
  resizeCancel(start) {
    this.resize = false;
    this.frameGeometryAboutToChange.emit();
    // What it was last asked for is `start` now
    if (this.ws.lag) this.requested = sameFrame(this._frame, start) ? null : start;
    this.interactiveMoveResizeFinished.emit();
    if (this.ws.lag) return;
    // Unless tide has asked it for another since
    if (this._frame.width !== start.width || this._frame.x !== start.x) return;
    this.frameGeometryChanged.emit();
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
  constructor({ outputs = [{ name: "out-1", x: 0, y: 0, width: 1920, height: 1080 }], desktops = ["Desktop 1"], lag = false } = {}) {
    this.lag = lag;
    this.screens = outputs.map((o) => ({ name: o.name, geometry: { x: o.x, y: o.y, width: o.width, height: o.height } }));
    this.activeScreen = this.screens[0];
    this.desktops = [];
    this.nextDesktop = 1;
    for (const name of desktops) this.desktops.push(this.newDesktop(name));
    this._current = this.desktops[0];
    this.windows = [];
    this._active = null;
    // KWin's stacking order, bottom first, and its focus chain, latest
    // first.
    this.stack = [];
    this.chain = [];
    this.cursorPos = { x: 0, y: 0 };
    this._activity = "a1";
    for (const s of ["windowAdded", "windowRemoved", "currentDesktopChanged", "screensChanged", "desktopsChanged",
      "virtualScreenGeometryChanged", "currentActivityChanged", "windowActivated"]) this[s] = new Signal();
  }
  get activeWindow() {
    return this._active;
  }
  // As the script's setter, KWin's Workspace::activateWindow: raises the
  // window and activates it. It would also switch desktops, by a policy
  // you can change; this leaves that to tide.
  set activeWindow(w) {
    if (w) this.raise(w);
    this.focus(w);
  }
  // As KWin's Workspace::setActiveWindow: the window heads the focus
  // chain and no longer wants attention, which it says before
  // windowActivated.
  focus(w) {
    if (w === this._active) return;
    this._active = w;
    if (w) {
      this.chain = [w, ...this.chain.filter((x) => x !== w)];
      if (w.demandsAttention) w.demandsAttention = false;
    }
    this.windowActivated.emit(w);
  }
  raise(w) {
    this.stack = [...this.stack.filter((x) => x !== w), w];
  }
  get stackingOrder() {
    return this.stack.filter((w) => this.windows.includes(w));
  }
  // Whether `w` shows on the current desktop and activity.
  shown(w) {
    const desktops = w.desktops ?? [];
    const activities = w.activities ?? [];
    return !w.deleted && !w.minimized && (desktops.length === 0 || desktops.includes(this._current)) &&
      (activities.length === 0 || activities.includes(this._activity));
  }
  // As KWin's Workspace::activateNextWindow, with its defaults
  // (NextFocusPrefersMouse false, SeparateScreenFocus true): if `gone` is
  // active, focus goes to its leader, or else the latest in the focus
  // chain that shows and reaches onto its output (FocusChain::
  // nextForDesktop), or else nothing. It doesn't raise but for a leader.
  activateNext(gone) {
    if (this._active !== gone) return;
    const g = gone.output.geometry;
    const reaches = (w) => {
      const f = w.frameGeometry;
      return f.x < g.x + g.width && f.x + f.width > g.x && f.y < g.y + g.height && f.y + f.height > g.y;
    };
    const usable = (w) => w !== gone && this.windows.includes(w) && this.shown(w) && reaches(w);
    const leader = gone.transient ? gone.transientFor : null;
    if (leader && usable(leader)) {
      this.raise(leader);
      this.focus(leader);
      return;
    }
    this.focus(this.chain.find(usable) ?? null);
  }
  // The geometry the apps were asked for, as they've resized.
  ack() {
    for (const w of this.windows) {
      if (w.requested) w._frame = w.requested;
      w.requested = null;
    }
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
    this.stack.push(w);
    this.windowAdded.emit(w);
    this.activeWindow = w;
    return w;
  }
  // As KWin's Workspace::removeWaylandWindow: the window you're in gives
  // focus to KWin's pick before windowRemoved.
  close(w) {
    // As KWin's own, a panel's room is still taken as it says it's gone
    if (w.dock) this.windowRemoved.emit(w);
    this.activateNext(w);
    this.windows = this.windows.filter((x) => x !== w);
    this.chain = this.chain.filter((x) => x !== w);
    w.deleted = true;
    if (!w.dock) this.windowRemoved.emit(w);
  }
}

// The env tide.js takes, around `ws`: shortcuts by name in `shortcuts`,
// config from `config`, D-Bus calls in `calls`, the replies to them by
// method in `replies` (true for one not listed), the log in `logs`, and
// what's to run later in `pending`, until `settle`, the time in ms in
// `clock`, and the timers `after` starts in `timers`, which `advance(ms)`
// runs as their time comes.
export function fakeEnv(ws, config = {}) {
  const env = {
    workspace: ws,
    KWin: { PlacementArea: 0, MaximizeArea: 2 },
    shortcuts: new Map(),
    calls: [],
    replies: {},
    pending: [],
    timers: [],
    logs: [],
    clock: 0,
    now() {
      return env.clock;
    },
    registerShortcut(name, _title, _key, f) {
      env.shortcuts.set(name, f);
    },
    readConfig(key, fallback) {
      return Object.hasOwn(config, key) ? config[key] : fallback;
    },
    callDBus(...args) {
      const reply = typeof args.at(-1) === "function" ? args.pop() : null;
      env.calls.push(args);
      if (reply) reply(Object.hasOwn(env.replies, args[3]) ? env.replies[args[3]] : true);
    },
    print(text) {
      env.logs.push(text);
    },
    info(text) {
      env.logs.push(text);
    },
    later(f) {
      env.pending.push(f);
    },
    after(ms, f) {
      const t = { at: env.clock + ms, f, stop: () => (env.timers = env.timers.filter((x) => x !== t)) };
      env.timers.push(t);
      return t;
    },
    advance(ms) {
      const end = env.clock + ms;
      for (;;) {
        const due = env.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        env.timers = env.timers.filter((t) => t !== due);
        env.clock = due.at;
        due.f();
      }
      env.clock = end;
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
