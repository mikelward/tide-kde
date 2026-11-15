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

function contains(r, p) {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
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
    this.dim = true;
    // Whether Dim Inactive is loaded, as tide last asked; null before it has.
    this.dimLoaded = null;
    // The layouts last written for the layout widget, as JSON.
    this.announced = null;
    // The windows wanting attention as last written for tide's launcher, as
    // JSON, and the windows whose wanting it tide follows.
    this.attention = null;
    this.heeded = new Set();
    // The windows wanting attention by id, newest last, for the
    // next-attention key: KWin keeps an order of its own but gives a script
    // none.
    this.marks = [];
    // Where tide put each tiled window, by id: KWin's frameGeometry
    // follows only once the app has resized.
    this.boxes = new Map();
    // The windows activated, by id, latest first, and the active one.
    this.history = [];
    this.current = null;
    // What happened in this turn of KWin's event loop: the window that lost
    // activation first, with the history as it was, and the windows KWin's
    // activation cleared the mark of. Null between turns.
    this.turn = null;
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
    this.dim = loaded.dim;
    for (const e of loaded.errors) this.problem(`setting ${e}; using its default`);

    this.ensureStanding();
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
    this.current = this.ws.activeWindow ? idOf(this.ws.activeWindow) : null;
    if (this.current !== null) this.history = [this.current];
    this.ws.windowActivated?.connect((w) => this.activated(w));
    this.ws.currentDesktopChanged.connect(() => this.announce());
    this.relayoutAll();
    this.updateDim();
    this.announce();
    // What the last session left names windows gone with it. plasmashell
    // may not be up yet to hear; the launcher only lists windows it finds.
    this.announceAttention();
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
    if (w.dock) {
      this.panelAdded(w);
      return;
    }
    this.heed(w);
    if (!this.candidate(w)) return;
    const id = idOf(w);
    if (!this.watched.has(id)) {
      this.watched.add(id);
      const again = () => this.place(w);
      w.desktopsChanged?.connect(again);
      w.outputChanged?.connect(again);
      w.minimizedChanged?.connect(() => this.minimizedChanged(w));
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
      const part = this.part(key, w.output);
      layout.insert(part, id, focused ? idOf(focused) : null, this.config, this.tiledIn(key).map(idOf));
      this.placed.set(id, key);
      const landing = this.landings.get(id);
      this.landings.delete(id);
      if (landing && this.tiled(w)) this.land(w, key, landing);
    }
    if (was !== undefined && was !== key) this.relayout(was);
    if (key !== null) this.relayout(key);
    // A window on every desktop has no part to relayout, but counts for dimming
    else this.updateDim();
  }

  // A panel takes room from the tiles, and gives it back as it moves,
  // resizes or goes: KWin's placement area changes, but nothing tells a
  // script, and Plasma's panels come after tide has laid out at login.
  panelAdded(w) {
    const id = idOf(w);
    if (!this.watched.has(id)) {
      this.watched.add(id);
      w.frameGeometryChanged?.connect(() => this.panelsChanged());
    }
    this.panelsChanged();
  }

  // Lays out again now, and again once KWin has taken the change into
  // its placement area. For a panel that goes, KWin does that after it
  // says so, on a timer it starts afresh after the script hears; a few
  // turns of its event loop later, the area has changed or won't.
  panelsChanged() {
    this.relayoutAll();
    const areas = () => JSON.stringify(this.ws.screens.map((o) => this.area(o)));
    const seen = areas();
    let turns = 4;
    const check = () => {
      if (areas() !== seen) this.relayoutAll();
      else if (--turns > 0) this.env.later(check);
    };
    this.env.later?.(check);
  }

  removed(w) {
    if (w.dock) {
      this.watched.delete(idOf(w));
      this.panelsChanged();
      return;
    }
    const id = idOf(w);
    const key = this.placed.get(id);
    this.placed.delete(id);
    this.floating.delete(id);
    this.watched.delete(id);
    this.dragFrom.delete(id);
    this.boxes.delete(id);
    this.history = this.history.filter((x) => x !== id);
    this.marks = this.marks.filter((m) => m !== id);
    if (this.heeded.delete(id)) this.announceAttention();
    if (key !== undefined) {
      layout.remove(this.parts.get(key), id);
      this.relayout(key);
    } else {
      this.updateDim();
    }
  }

  minimizedChanged(w) {
    this.place(w);
    if (w.minimized) this.refocus(w);
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
  // place nearest the edge it came in by (tide SPEC.md §6.6). Going up or
  // down, `from` is turned, and so are the places.
  land(w, key, { d, from, vertical }) {
    const part = this.parts.get(key);
    const id = idOf(w);
    const ids = this.tiledIn(key).map(idOf);
    const area = this.area(this.outputOf(key), this.desktopOf(key));
    const slots = geometry.arrange(part.mode, area, ids.length, part.opts[part.mode], layout.singleRules(part, this.config));
    const at = direction.landing(vertical ? slots.map(direction.turn) : slots, d, from);
    const others = ids.filter((x) => x !== id);
    layout.remove(part, id);
    const before = at === null ? undefined : others[at];
    const i = before === undefined ? part.order.length : part.order.indexOf(before);
    part.order.splice(i, 0, id);
  }

  relayout(key) {
    this.updateDim();
    const output = this.outputOf(key);
    const desktop = this.desktopOf(key);
    if (!output || !desktop) return;
    const windows = this.tiledIn(key);
    this.announce();
    if (windows.length === 0) return;
    const area = this.area(output, desktop);
    const boxes = layout.arrange(this.parts.get(key), area, windows.map(idOf), this.config);
    for (const w of windows) {
      const b = boxes.get(idOf(w));
      const want = { x: b.x, y: b.y, width: b.w, height: b.h };
      this.boxes.set(idOf(w), want);
      if (!sameBox(w.frameGeometry, want)) w.frameGeometry = want;
    }
  }

  relayoutAll() {
    for (const key of new Set(this.placed.values())) this.relayout(key);
  }

  // --- Focus after minimizing (SPEC.md §4.4) -----------------------------

  // The current turn of KWin's event loop, begun if it hasn't been: it
  // ends once KWin is done with what it's doing (`later`).
  thisTurn() {
    if (!this.turn) {
      this.turn = { lost: null, cleared: new Set() };
      this.env.later(() => {
        this.turn = null;
      });
    }
    return this.turn;
  }

  activated(w) {
    const id = w ? idOf(w) : null;
    const turn = this.thisTurn();
    if (this.current !== null && this.current !== id && !turn.lost) {
      turn.lost = { id: this.current, history: this.history };
    }
    this.current = id;
    if (w && this.appWindow(w)) this.history = [id].concat(this.history.filter((x) => x !== id));
    this.updateDim();
  }

  // Whether `w` shows: not minimized or hidden, on this desktop and
  // activity.
  shown(w) {
    if (w.deleted || w.minimized || w.hidden || !this.onActivity(w)) return false;
    const desktops = w.desktops ?? [];
    return desktops.length === 0 || desktops.some((d) => d.id === this.ws.currentDesktop.id);
  }

  // Whether `w` wants attention, or did until KWin activated it in this
  // turn: tide keeps such a window waiting (tide SPEC.md §14).
  waiting(w) {
    return !!w.demandsAttention || (this.turn !== null && this.turn.cleared.has(idOf(w)));
  }

  // Where `w` is, or for a tile, where tide has put it.
  where(w) {
    return (this.tiled(w) && this.boxes.get(idOf(w))) || w.frameGeometry;
  }

  // The window under the pointer once `gone` has left `output`: the
  // topmost of that output's windows there, if it's an app's window that
  // isn't waiting. With the pointer on another output, none.
  underPointer(gone, output) {
    const c = this.ws.cursorPos;
    if (!c) return null;
    const at = this.ws.screenAt(c);
    if (!at || at.name !== output.name) return null;
    const stack = this.ws.stackingOrder ?? [];
    for (let i = stack.length - 1; i >= 0; i--) {
      const w = stack[i];
      if (idOf(w) === idOf(gone) || !this.shown(w)) continue;
      if (!w.output || w.output.name !== output.name) continue;
      if (!contains(this.where(w), c)) continue;
      return this.appWindow(w) && !this.waiting(w) ? w : null;
    }
    return null;
  }

  // The window you were in before `gone` on `output`, from `history`.
  usedBefore(gone, output, history) {
    const byId = this.windowsById();
    for (const id of history) {
      const w = byId.get(id);
      if (!w || id === idOf(gone) || !this.appWindow(w) || !this.shown(w) || this.waiting(w)) continue;
      if (w.output && w.output.name === output.name) return w;
    }
    return null;
  }

  // Once `gone`, the window you were in, is minimized and tide has laid
  // out again, focuses the window under the pointer on its output, or with
  // none, the window you were in before there (tide SPEC.md §6.7). KWin
  // has already focused its own pick, as the space was still empty.
  refocus(gone) {
    const turn = this.turn;
    const output = gone.output;
    if (!turn || !turn.lost || turn.lost.id !== idOf(gone) || !output) return;
    const target = this.underPointer(gone, output) ?? this.usedBefore(gone, output, turn.lost.history);
    const picked = this.ws.activeWindow;
    if (!target || (picked && idOf(picked) === idOf(target))) return;
    this.ws.activeWindow = target;
    // KWin's pick cleared its mark as it activated it
    if (picked && !picked.deleted && turn.cleared.has(idOf(picked))) picked.demandsAttention = true;
  }

  // --- Attention (SPEC.md §4.6) -------------------------------------------

  // Follows whether `w` wants attention, as KWin marks a window its focus
  // stealing prevention keeps from taking focus, or one that asks.
  heed(w) {
    const id = idOf(w);
    if (this.heeded.has(id)) return;
    this.heeded.add(id);
    w.demandsAttentionChanged?.connect(() => this.attentionChanged(w));
    if (w.demandsAttention) this.attentionChanged(w);
  }

  // Keeps the order for the next-attention key, then tells the launcher.
  attentionChanged(w) {
    const id = idOf(w);
    const was = this.marks.includes(id);
    if (w.demandsAttention && !w.deleted) {
      if (!was) this.marks.push(id);
    } else if (was) {
      this.marks = this.marks.filter((m) => m !== id);
    }
    // KWin's setActiveWindow clears it just after making `w` active
    const active = this.ws.activeWindow;
    if (!w.demandsAttention && active && idOf(active) === id) this.thisTurn().cleared.add(id);
    this.announceAttention();
  }

  // tide's next_attention: the window that wanted attention last, on any
  // workspace, which it comes up with. Activating it clears its mark, as
  // KWin's setActiveWindow does, so the next press goes to the next. With
  // none, nothing.
  nextAttention() {
    const byId = this.windowsById();
    let w = null;
    while (this.marks.length && !w) {
      const found = byId.get(this.marks.pop());
      if (found && !found.deleted) w = found;
    }
    if (!w) return;
    // KWin's own activation switches desktops only by its Activation
    // desktop policy, which you can change, so tide shows the desktop.
    const desktops = w.desktops ?? [];
    if (desktops.length > 0 && !desktops.some((d) => d.id === this.ws.currentDesktop.id)) {
      this.show({ name: desktops[0].name, desktop: desktops[0] });
    }
    this.ws.activeWindow = w;
  }

  // Tells tide's launcher, for its Attention tab, which windows want
  // attention, by the UUIDs KWin's D-Bus knows them by. A KWin script can't
  // be asked, so it keeps them in the desktop's settings in plasmashell,
  // group "tide", key "attention", which the launcher reads as it opens.
  announceAttention() {
    const ids = this.ws.windowList().filter((w) => !w.deleted && w.demandsAttention).map(idOf).sort();
    const json = JSON.stringify(ids);
    if (json === this.attention) return;
    this.attention = json;
    this.log(`${ids.length} window${ids.length === 1 ? "" : "s"} wanting attention`);
    const script =
      `for (const d of desktops()) { d.currentConfigGroup = ["tide"]; d.writeConfig("attention", ${JSON.stringify(json)}); }`;
    try {
      this.env.callDBus("org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell", "evaluateScript", script);
    } catch (e) {
      this.log(`couldn't tell the launcher which windows want attention (${e}), so its Attention tab may be out of date`);
      this.attention = null;
    }
  }

  // --- The layout widget (SPEC.md §4.7) -----------------------------------

  // Each monitor's layout on the current desktop, {output: {symbol, mode}}.
  layouts() {
    const desktop = this.ws.currentDesktop;
    const out = {};
    for (const o of this.ws.screens) {
      const key = `${desktop.id}|${o.name}`;
      const p = this.part(key, o);
      out[o.name] = { symbol: layout.symbol(p.mode, this.tiledIn(key).length), mode: p.mode };
    }
    return out;
  }

  // Tells the layout widget (plasmoid/) each monitor's layout when it
  // changes. A KWin script can't be asked, so it writes the widget's
  // settings through plasmashell's scripting, which the widget follows.
  announce() {
    const json = JSON.stringify(this.layouts());
    if (json === this.announced) return;
    this.announced = json;
    const script =
      `for (const c of [...panels(), ...desktops()]) for (const w of c.widgets("org.tide.layout")) {` +
      ` w.currentConfigGroup = ["General"]; w.writeConfig("layouts", ${JSON.stringify(json)}); w.reloadConfig(); }`;
    try {
      this.env.callDBus("org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell", "evaluateScript", script);
    } catch (e) {
      this.log(`couldn't tell the layout widget (${e}), so it may show an old layout`);
      this.announced = null;
    }
  }

  // The next layout on the monitor under the pointer: a click on that
  // monitor's layout widget, whichever window has focus.
  cycleHere() {
    const output = this.ws.screenAt(this.ws.cursorPos);
    if (!output) return;
    const key = `${this.ws.currentDesktop.id}|${output.name}`;
    layout.cycle(this.part(key, output), 1, this.config);
    this.relayout(key);
  }

  // Tells the widget again, as one that's just loaded asks.
  reannounce() {
    this.announced = null;
    this.announce();
  }

  // --- Dimming inactive windows (SPEC.md §4.2) ---------------------------

  // KWin's Dim Inactive dims every inactive window, so tide has it on only
  // while some monitor shows two windows or more: with one apiece there's
  // nothing to tell apart, and a dimmed lone window just looks wrong (tide
  // SPEC.md §6.2). With `dim` false, tide leaves it as Plasma's settings
  // have it.
  updateDim() {
    if (!this.dim) return;
    const desktop = this.ws.currentDesktop;
    const shown = new Map();
    for (const w of this.ws.windowList()) {
      if (!this.candidate(w) || w.minimized || !w.output || !this.onActivity(w)) continue;
      // A window on every desktop has none listed
      const desktops = w.desktops ?? [];
      if (desktops.length > 0 && !desktops.some((d) => d.id === desktop.id)) continue;
      shown.set(w.output.name, (shown.get(w.output.name) ?? 0) + 1);
    }
    const want = [...shown.values()].some((n) => n >= 2);
    if (want === this.dimLoaded) return;
    this.dimLoaded = want;
    const method = want ? "loadEffect" : "unloadEffect";
    try {
      this.env.callDBus("org.kde.KWin", "/Effects", "org.kde.kwin.Effects", method, "diminactive", (ok) => {
        if (want && ok === false) this.log("KWin couldn't load Dim Inactive, so nothing dims");
        else this.log(`dim ${want ? "on" : "off"}`);
      });
    } catch (e) {
      this.log(`couldn't ${want ? "turn on" : "turn off"} Dim Inactive (${e}), so dimming may be wrong`);
      this.dimLoaded = null;
    }
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

  // Meta+X toggles maximize, as tide's Super+X does.
  maximize() {
    const w = this.active();
    if (w && w.maximizable) w.setMaximize(!w.maximizeMode, !w.maximizeMode);
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

  // --- Left, right, up and down (tide SPEC.md §6.6) ----------------------

  // Every monitor, with the current desktop's tiles on it, for direction.js;
  // turned for up and down. `area` is the monitor's own, never turned.
  monitors(vertical = false) {
    const desktop = this.ws.currentDesktop;
    const byId = this.windowsById();
    const list = this.ws.screens.map((o) => {
      const area = this.area(o, desktop);
      return {
        name: o.name,
        output: o,
        area,
        box: area,
        tiles: this.tiledIn(`${desktop.id}|${o.name}`, byId).map((w) => ({ box: box(w.frameGeometry), window: w })),
      };
    });
    return vertical ? direction.turned(list) : list;
  }

  // Meta and an arrow (d -1 for left or up, 1 for right or down): the
  // window that way, or at a monitor's edge the nearest one on the next
  // monitor, or that monitor itself if it has none.
  focusWay(d, vertical) {
    const w = this.active();
    const here = w && w.output ? w.output : this.ws.activeScreen;
    const from = w ? box(w.frameGeometry) : this.area(here, this.ws.currentDesktop);
    const r = direction.find(vertical ? direction.turn(from) : from, here.name, this.monitors(vertical), d);
    if (!r) return;
    if (r.tile) this.ws.activeWindow = r.tile.window;
    else if (vertical) {
      if (d > 0) this.ws.slotSwitchToBelowScreen();
      else this.ws.slotSwitchToAboveScreen();
    } else if (d > 0) this.ws.slotSwitchToRightScreen();
    else this.ws.slotSwitchToLeftScreen();
  }

  focusSide(d) {
    this.focusWay(d, false);
  }

  focusVertical(d) {
    this.focusWay(d, true);
  }

  // Meta+Shift and an arrow: a tiled window swaps with the one that way,
  // or at the edge goes onto the next monitor, landing nearest the edge it
  // came in by; a floating one goes onto the next monitor at the same
  // relative spot.
  moveWay(d, vertical) {
    const w = this.active();
    if (!w || !w.output) return;
    const monitors = this.monitors(vertical);
    const at = box(w.frameGeometry);
    const from = vertical ? direction.turn(at) : at;
    if (this.tiled(w)) {
      const r = direction.find(from, w.output.name, monitors, d);
      if (!r) return;
      if (r.monitor.name === w.output.name) {
        const key = this.partKey(w);
        layout.swapWindows(this.parts.get(key), idOf(w), idOf(r.tile.window));
        this.relayout(key);
        return;
      }
      this.landings.set(idOf(w), { d, from, vertical });
      this.ws.sendClientToScreen(w, r.monitor.output);
      return;
    }
    const cur = monitors.find((m) => m.name === w.output.name);
    const next = cur ? direction.nextMonitor(cur, monitors, d) : null;
    if (!next) return;
    this.ws.sendClientToScreen(w, next.output);
    const b = direction.place(at, cur.area, next.area);
    w.frameGeometry = { x: b.x, y: b.y, width: b.w, height: b.h };
  }

  moveSide(d) {
    this.moveWay(d, false);
  }

  moveVertical(d) {
    this.moveWay(d, true);
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

  // Every standing workspace is made at start. Home takes the first
  // desktop's name, unless a desktop has it already; each other one missing
  // is made in its place.
  ensureStanding() {
    const home = this.standing[0];
    if (!this.ws.desktops.some((d) => workspaces.sameName(d.name, home))) {
      this.ws.desktops[0].name = home;
      this.log(`named the first desktop ${home}, tide's home`);
    }
    for (const name of workspaces.missing(this.view())) {
      this.ws.createDesktop(workspaces.position(this.view(), name), name);
      this.log(`made ${name}, a standing workspace`);
    }
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
