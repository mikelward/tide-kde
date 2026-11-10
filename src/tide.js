// tide on KWin (SPEC.md §4): tiles each desktop's windows per monitor in
// tide's layouts, and runs tide's window and workspace keys. Everything it
// knows of KWin comes in `env`, so tests hand it a fake:
//   workspace, KWin, registerShortcut, readConfig, callDBus, print
// as KWin's script engine has them.
//
// A workspace is a KWin desktop, which spans every monitor; each monitor's
// part of it has its own layout (layout.js), keyed by desktop and output.
import * as direction from "./direction.js";
import * as geometry from "./geometry.js";
import * as layout from "./layout.js";
import * as settings from "./settings.js";
import * as workspaces from "./workspaces.js";
import { KEYS } from "./keys.js";

export function idOf(w) {
  return String(w.internalId);
}

function sameBox(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function box(r) {
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

export class Tide {
  constructor(env) {
    this.env = env;
    this.ws = env.workspace;
    // Each desktop and output's layout, by partKey.
    this.parts = new Map();
    // Which part each window is in, by id: what it was put in, so a move
    // can take it out of its old one.
    this.placed = new Map();
    // Windows you made float with the key.
    this.floating = new Set();
    // Windows this script watches the signals of.
    this.watched = new Set();
    // The desktops shown before this one, most recent first, by id.
    this.recent = [];
    // A window's geometry as an interactive move or resize began, by id.
    this.dragFrom = new Map();
    // Where a window moved by side lands in its new part, by id: the way it
    // went and the box it left (direction.landing).
    this.landings = new Map();
    this.config = layout.DEFAULTS;
    this.standing = workspaces.DEFAULT_STANDING;
  }

  log(text) {
    this.env.print(`tide: ${text}`);
  }

  // Says what's wrong where you'll see it, and in KWin's log.
  problem(text) {
    this.log(text);
    try {
      this.env.callDBus(
        "org.freedesktop.Notifications",
        "/org/freedesktop/Notifications",
        "org.freedesktop.Notifications",
        "Notify",
        "tide",
        0,
        "",
        "tide",
        text,
        [],
        {},
        -1,
      );
    } catch (e) {
      this.log(`couldn't show a notification (${e}), so only this log says: ${text}`);
    }
  }

  start() {
    // A default nothing would set, so an unset key reads as unset and one
    // set empty, as single= is, as empty.
    const UNSET = "\u0000unset";
    const read = (key) => {
      const v = this.env.readConfig(key, UNSET);
      return v === UNSET || v === undefined || v === null ? undefined : v;
    };
    const loaded = settings.load(read);
    this.config = loaded.config;
    this.standing = loaded.standing;
    for (const e of loaded.errors) this.problem(`setting ${e}; using its default`);

    this.ensureHome();
    this.ws.windowAdded.connect((w) => this.added(w));
    this.ws.windowRemoved.connect((w) => this.removed(w));
    this.ws.currentDesktopChanged.connect((previous) => this.desktopChanged(previous));
    this.ws.screensChanged.connect(() => this.relayoutAll());
    this.ws.desktopsChanged?.connect(() => this.relayoutAll());
    this.ws.virtualScreenGeometryChanged?.connect(() => this.relayoutAll());
    this.ws.currentActivityChanged?.connect(() => this.relayoutAll());
    for (const w of this.ws.windowList()) this.added(w, { quiet: true });
    for (const k of KEYS) {
      this.env.registerShortcut(k.name, `tide: ${k.title}`, k.key, () => this.run(k));
    }
    this.relayoutAll();
    this.log("started");
  }

  run(key) {
    try {
      this[key.action](key.arg);
    } catch (e) {
      this.log(`${key.name} failed: ${e}`);
    }
  }

  // --- Windows ----------------------------------------------------------

  // Whether `w` is an app's window, which the window keys act on and which
  // keeps its desktop: not Plasma's panels, desktop or popups.
  appWindow(w) {
    if (!w || w.deleted || !w.managed || w.specialWindow) return false;
    return !!(w.normalWindow || w.dialog || w.utility);
  }

  // Whether `w` is one tide lays out at all, now or later: an app's own
  // top-level window. Dialogs and the like float.
  candidate(w) {
    return this.appWindow(w) && w.normalWindow && !w.transient && !w.popupWindow && !w.skipTaskbar;
  }

  // Whether `w` is on the current activity, as it is on all of them when
  // it names none.
  onActivity(w) {
    const list = w.activities ?? [];
    const current = this.ws.currentActivity;
    return list.length === 0 || !current || list.includes(current);
  }

  // Whether `w` takes a tile now. A fullscreen window can't be moved or
  // resized in KWin, so it's checked each time, not once.
  tiled(w) {
    if (!this.candidate(w) || !w.moveable || !w.resizeable) return false;
    const min = w.minSize;
    const max = w.maxSize;
    // A window that can only be one size floats (tide SPEC.md §6.4).
    if (min && max && min.width > 0 && min.width === max.width && min.height === max.height) return false;
    return (
      !this.floating.has(idOf(w)) &&
      !w.minimized &&
      !w.fullScreen &&
      !w.maximizeMode &&
      this.onActivity(w) &&
      this.partKey(w) !== null
    );
  }

  // The part a window belongs in: its desktop's, on its output, or null if
  // it's on every desktop or none.
  partKey(w) {
    const desktops = w.desktops ?? [];
    if (desktops.length !== 1 || !w.output) return null;
    return `${desktops[0].id}|${w.output.name}`;
  }

  part(key, output) {
    let p = this.parts.get(key);
    if (!p) {
      const area = output ? this.area(output, this.desktopOf(key)) : null;
      p = layout.create(area, this.config);
      this.parts.set(key, p);
    }
    return p;
  }

  desktopOf(key) {
    const id = key.split("|")[0];
    return this.ws.desktops.find((d) => d.id === id) ?? null;
  }

  outputOf(key) {
    const name = key.slice(key.indexOf("|") + 1);
    return this.ws.screens.find((s) => s.name === name) ?? null;
  }

  area(output, desktop) {
    return box(this.ws.clientArea(this.env.KWin.PlacementArea, output, desktop ?? this.ws.currentDesktop));
  }

  added(w, { quiet = false } = {}) {
    if (!this.candidate(w)) return;
    const id = idOf(w);
    if (!this.watched.has(id)) {
      this.watched.add(id);
      const again = () => this.place(w);
      w.desktopsChanged?.connect(again);
      w.outputChanged?.connect(again);
      w.minimizedChanged?.connect(again);
      w.fullScreenChanged?.connect(again);
      w.maximizedChanged?.connect(again);
      w.activitiesChanged?.connect(again);
      w.moveableChanged?.connect(again);
      w.resizeableChanged?.connect(again);
      w.interactiveMoveResizeStarted?.connect(() => this.dragStarted(w));
      w.interactiveMoveResizeFinished?.connect(() => this.dragFinished(w));
    }
    this.place(w, quiet ? null : this.ws.activeWindow);
  }

  // Puts `w` in the part it belongs in, taking it out of any other, and
  // lays out both. One moved here counts as new (tide SPEC.md §6.1).
  place(w, focused = this.ws.activeWindow) {
    if (w.deleted) return;
    const id = idOf(w);
    const was = this.placed.get(id);
    const key = this.partKey(w);
    if (was !== undefined && was !== key) {
      layout.remove(this.parts.get(was), id);
      this.placed.delete(id);
    }
    if (key !== null && was !== key) {
      layout.insert(this.part(key, w.output), id, focused ? idOf(focused) : null, this.config);
      this.placed.set(id, key);
      const landing = this.landings.get(id);
      this.landings.delete(id);
      if (landing && this.tiled(w)) this.land(w, key, landing);
    }
    if (was !== undefined && was !== key) this.relayout(was);
    if (key !== null) this.relayout(key);
  }

  removed(w) {
    const id = idOf(w);
    const key = this.placed.get(id);
    this.placed.delete(id);
    this.floating.delete(id);
    this.watched.delete(id);
    this.dragFrom.delete(id);
    if (key !== undefined) {
      layout.remove(this.parts.get(key), id);
      this.relayout(key);
    }
  }

  windowsById() {
    const out = new Map();
    for (const w of this.ws.windowList()) out.set(idOf(w), w);
    return out;
  }

  // The windows tiled in part `key`, in its order.
  tiledIn(key, byId = this.windowsById()) {
    const p = this.parts.get(key);
    if (!p) return [];
    return p.order.map((id) => byId.get(id)).filter((w) => w && this.tiled(w) && this.partKey(w) === key);
  }

  // Puts `w`, just moved into part `key` going `d` from box `from`, in the
  // place nearest the edge it came in by (tide SPEC.md §6.6).
  land(w, key, { d, from }) {
    const part = this.parts.get(key);
    const id = idOf(w);
    const ids = this.tiledIn(key).map(idOf);
    const area = this.area(this.outputOf(key), this.desktopOf(key));
    const slots = geometry.arrange(part.mode, area, ids.length, part.opts[part.mode], layout.singleRules(part, this.config));
    const at = direction.landing(slots, d, from);
    const others = ids.filter((x) => x !== id);
    layout.remove(part, id);
    const before = at === null ? undefined : others[at];
    const i = before === undefined ? part.order.length : part.order.indexOf(before);
    part.order.splice(i, 0, id);
  }

  relayout(key) {
    const output = this.outputOf(key);
    const desktop = this.desktopOf(key);
    if (!output || !desktop) return;
    const windows = this.tiledIn(key);
    if (windows.length === 0) return;
    const area = this.area(output, desktop);
    const boxes = layout.arrange(this.parts.get(key), area, windows.map(idOf), this.config);
    for (const w of windows) {
      const b = boxes.get(idOf(w));
      const want = { x: b.x, y: b.y, width: b.w, height: b.h };
      if (!sameBox(w.frameGeometry, want)) w.frameGeometry = want;
    }
  }

  relayoutAll() {
    for (const key of new Set(this.placed.values())) this.relayout(key);
  }

  // --- Dragging (tide SPEC.md §6.6) ---------------------------------------

  dragStarted(w) {
    const g = w.frameGeometry;
    this.dragFrom.set(idOf(w), { x: g.x, y: g.y, width: g.width, height: g.height, resize: !!w.resize });
  }

  // A tiled window dropped on another swaps with it; one whose edge was
  // dragged sets the main share, or a lone window's width. Either way the
  // layout puts it back in a tile.
  dragFinished(w) {
    const id = idOf(w);
    const from = this.dragFrom.get(id);
    this.dragFrom.delete(id);
    const key = this.placed.get(id);
    if (!from || key === undefined || !this.tiled(w)) return;
    const part = this.parts.get(key);
    const windows = this.tiledIn(key);
    const ids = windows.map(idOf);
    const now = w.frameGeometry;
    if (from.resize) {
      const area = this.area(this.outputOf(key), this.desktopOf(key));
      if (ids.length === 1) {
        const f = geometry.singleWidthFor(area, { x: from.x, w: from.width }, { x: now.x, w: now.width });
        if (f !== null) part.singleWidth = f;
      } else {
        const right = now.x + now.width !== from.x + from.width;
        const edge = right ? "right" : now.x !== from.x ? "left" : null;
        if (edge) {
          const x = edge === "right" ? now.x + now.width : now.x;
          const opts = part.opts[part.mode];
          const m = geometry.mfactFor(part.mode, area, ids.length, opts, layout.singleRules(part, this.config), ids.indexOf(id), edge, x);
          if (m !== null) layout.setMfact(part, m);
        }
      }
    } else {
      const c = this.ws.cursorPos;
      const target = windows.find((o) => {
        const g = o.frameGeometry;
        return o !== w && c.x >= g.x && c.x < g.x + g.width && c.y >= g.y && c.y < g.y + g.height;
      });
      if (target) layout.swapWindows(part, id, idOf(target));
    }
    this.relayout(key);
  }

  // --- What the keys act on ---------------------------------------------

  active() {
    const w = this.ws.activeWindow;
    return this.appWindow(w) ? w : null;
  }

  // The part the keys act on: the active window's, or the current desktop's
  // on the active monitor.
  activeKey() {
    const w = this.ws.activeWindow;
    const key = w ? this.partKey(w) : null;
    if (key !== null && this.candidate(w)) return key;
    const output = this.ws.activeScreen;
    return output ? `${this.ws.currentDesktop.id}|${output.name}` : null;
  }

  activePart() {
    const key = this.activeKey();
    if (key === null) return null;
    return { key, part: this.part(key, this.outputOf(key)) };
  }

  withPart(change) {
    const a = this.activePart();
    if (!a) return;
    change(a.part, a.key);
    this.relayout(a.key);
  }

  focusStack(delta) {
    const w = this.active();
    const key = this.activeKey();
    const windows = this.tiledIn(key);
    if (windows.length === 0) return;
    const ids = windows.map(idOf);
    const next = layout.neighbor(ids, w ? idOf(w) : null, delta);
    this.ws.activeWindow = windows[ids.indexOf(next)];
  }

  moveStack(delta) {
    const w = this.active();
    if (!w || !this.tiled(w)) return;
    const key = this.partKey(w);
    layout.move(this.parts.get(key), this.tiledIn(key).map(idOf), idOf(w), delta);
    this.relayout(key);
  }

  zoom() {
    const w = this.active();
    if (!w || !this.tiled(w)) return;
    const key = this.partKey(w);
    layout.swapMaster(this.parts.get(key), this.tiledIn(key).map(idOf), idOf(w));
    this.relayout(key);
  }

  mfact(sign) {
    this.withPart((p) => layout.mfact(p, sign * this.config.mfactStep));
  }

  nmaster(delta) {
    this.withPart((p) => layout.nmaster(p, delta));
  }

  cycle(delta) {
    this.withPart((p) => layout.cycle(p, delta, this.config));
  }

  lastLayout() {
    this.withPart((p) => layout.last(p));
  }

  monocle() {
    this.withPart((p) => layout.toggleMonocle(p, this.config));
  }

  close() {
    this.active()?.closeWindow();
  }

  minimize() {
    const w = this.active();
    if (w && w.minimizable) w.minimized = true;
  }

  maximize() {
    const w = this.active();
    if (w && w.maximizable) w.setMaximize(true, true);
  }

  fullscreen() {
    const w = this.active();
    if (w && w.fullScreenable) w.fullScreen = !w.fullScreen;
  }

  restore() {
    const w = this.active();
    if (!w) return;
    if (w.fullScreen) w.fullScreen = false;
    else if (w.maximizeMode) w.setMaximize(false, false);
  }

  toggleFloat() {
    const w = this.active();
    if (!w) return;
    const id = idOf(w);
    if (this.floating.has(id)) this.floating.delete(id);
    else this.floating.add(id);
    const key = this.partKey(w);
    if (key !== null) this.relayout(key);
  }

  // --- Left and right (tide SPEC.md §6.6) --------------------------------

  // Every monitor, with the current desktop's tiles on it, for direction.js.
  monitors() {
    const desktop = this.ws.currentDesktop;
    const byId = this.windowsById();
    return this.ws.screens.map((o) => ({
      name: o.name,
      output: o,
      box: this.area(o, desktop),
      tiles: this.tiledIn(`${desktop.id}|${o.name}`, byId).map((w) => ({ box: box(w.frameGeometry), window: w })),
    }));
  }

  // Meta+Left and Right: the window that way, or at a monitor's edge the
  // nearest one on the next monitor, or that monitor itself if it has none.
  focusSide(d) {
    const w = this.active();
    const here = w && w.output ? w.output : this.ws.activeScreen;
    const from = w ? box(w.frameGeometry) : this.area(here, this.ws.currentDesktop);
    const r = direction.find(from, here.name, this.monitors(), d);
    if (!r) return;
    if (r.tile) this.ws.activeWindow = r.tile.window;
    else if (d > 0) this.ws.slotSwitchToRightScreen();
    else this.ws.slotSwitchToLeftScreen();
  }

  // Meta+Shift+Left and Right: a tiled window swaps with the one that way,
  // or at the edge goes onto the next monitor, landing nearest the edge it
  // came in by; a floating one goes onto the next monitor at the same
  // relative spot.
  moveSide(d) {
    const w = this.active();
    if (!w || !w.output) return;
    const monitors = this.monitors();
    const from = box(w.frameGeometry);
    if (this.tiled(w)) {
      const r = direction.find(from, w.output.name, monitors, d);
      if (!r) return;
      if (r.monitor.name === w.output.name) {
        const key = this.partKey(w);
        layout.swapWindows(this.parts.get(key), idOf(w), idOf(r.tile.window));
        this.relayout(key);
        return;
      }
      this.landings.set(idOf(w), { d, from });
      this.ws.sendClientToScreen(w, r.monitor.output);
      return;
    }
    const cur = monitors.find((m) => m.name === w.output.name);
    const next = cur ? direction.nextMonitor(cur, monitors, d) : null;
    if (!next) return;
    this.ws.sendClientToScreen(w, next.output);
    const b = direction.place(from, cur.box, next.box);
    w.frameGeometry = { x: b.x, y: b.y, width: b.w, height: b.h };
  }

  // --- Workspaces (SPEC.md §4.3) ----------------------------------------

  // Desktop `d`'s windows: its apps' windows, tiled or not.
  windowsOn(d) {
    return this.ws.windowList().filter((w) => this.appWindow(w) && (w.desktops ?? []).some((x) => x.id === d.id)).length;
  }

  view() {
    return {
      standing: this.standing,
      desktops: this.ws.desktops.map((d) => ({ id: d.id, name: d.name, windows: this.windowsOn(d) })),
      current: this.ws.currentDesktop.id,
      recent: this.recent,
    };
  }

  // Home is made at start: the first desktop takes its name, unless one has
  // it already.
  ensureHome() {
    const home = this.standing[0];
    if (this.ws.desktops.some((d) => workspaces.sameName(d.name, home))) return;
    this.ws.desktops[0].name = home;
    this.log(`named the first desktop ${home}, tide's home`);
  }

  // The desktop for bar entry `entry` ({name, desktop}), making it if it's
  // a standing one not made yet.
  make(entry) {
    if (entry.desktop) return this.ws.desktops.find((d) => d.id === entry.desktop.id) ?? null;
    const view = this.view();
    this.ws.createDesktop(workspaces.position(view, entry.name), entry.name);
    return this.ws.desktops.find((d) => workspaces.sameName(d.name, entry.name)) ?? null;
  }

  show(entry) {
    if (!entry) return;
    const d = this.make(entry);
    if (d && d.id !== this.ws.currentDesktop.id) this.ws.currentDesktop = d;
  }

  send(w, entry, { follow = false } = {}) {
    if (!w || !entry) return;
    const d = this.make(entry);
    if (!d) return;
    w.desktops = [d];
    if (follow) {
      this.show({ name: d.name, desktop: d });
      this.ws.activeWindow = w;
    }
  }

  desktopChanged(previous) {
    if (previous) this.recent = workspaces.remember(this.recent, previous.id, this.ws.currentDesktop.id);
    for (const d of workspaces.leftEmpty(this.view())) {
      const desktop = this.ws.desktops.find((x) => x.id === d.id);
      if (desktop) {
        this.log(`removing ${d.name}, left empty`);
        this.ws.removeDesktop(desktop);
      }
    }
    this.recent = this.recent.filter((id) => this.ws.desktops.some((d) => d.id === id));
    this.relayoutAll();
  }

  goNth(n) {
    this.show(workspaces.nth(this.view(), n));
  }

  sendNth(n) {
    this.send(this.active(), workspaces.nth(this.view(), n));
  }

  goHome() {
    this.show(workspaces.home(this.view()));
  }

  homeOrBack() {
    this.show(workspaces.homeOrBack(this.view()));
  }

  lastOther() {
    this.show(workspaces.lastOther(this.view()));
  }

  stepWorkspace(by) {
    this.show(workspaces.step(this.view(), by, { withWindows: true }));
  }

  moveToStep(by) {
    this.send(this.active(), workspaces.step(this.view(), by), { follow: true });
  }
}
