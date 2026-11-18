// tide on KWin (SPEC.md §4): tiles each desktop's windows per monitor in
// tide's layouts, and runs tide's window and workspace keys. Everything it
// knows of KWin comes in `env`, so tests hand it a fake:
//   workspace, KWin, registerShortcut, readConfig, callDBus, print, info
// as KWin's script engine has them (`info` is its console.info).
//
// A workspace is a KWin desktop, which spans every monitor; each monitor's
// part of it has its own layout (layout.js), keyed by desktop and output.
import * as direction from "./direction.js";
import * as geometry from "./geometry.js";
import * as layout from "./layout.js";
import * as reopened from "./reopened.mjs";
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
    // The sides of each tile that a drag moves, by id, as tide's decoration
    // was last told (SPEC.md §4.8).
    this.edges = new Map();
    // Where a window moved by side lands in its new part, by id: the way it
    // went and the box it left (direction.landing).
    this.landings = new Map();
    // The windows seen and those closed, for sending reopened ones back to
    // their desktops (reopened.mjs).
    this.reopened = reopened.NOTHING;
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
    // activation first, with the history as it was, the windows KWin's
    // activation cleared the mark of, and the desktop and window tide
    // switched to, until KWin says it has. Null between turns.
    this.turn = null;
    // Why tide is acting, for the log: the key being pressed, or null.
    this.why = null;
  }

  // Logs `text` as tide-kde's, at info level where KWin gives it, as
  // print's debug level is one logging rules may hide (SPEC.md §4.9).
  log(text) {
    const line = `tide-kde: ${text}`;
    if (this.env.info) this.env.info(line);
    else this.env.print(line);
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

    // What a tide before this one told the decoration no longer holds
    this.tellDecoration("reset");
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
    this.why = `key ${key.name}`;
    try {
      this[key.action](key.arg);
    } catch (e) {
      this.log(`${key.name} failed: ${e}`);
    } finally {
      this.why = null;
    }
  }

  // --- The log of workspace switches and focus moves (SPEC.md §4.9) ------

  // Why tide does what it does now: `rule`, and the key pressed.
  because(rule = null) {
    if (!rule) return this.why ?? "tide";
    return this.why ? `${rule}, ${this.why}` : rule;
  }

  // `w`'s app and workspace, for the log.
  describe(w) {
    const desktops = w.desktops ?? [];
    const where = desktops.length === 0 ? "every workspace" : desktops.map((d) => d.name).join(", ");
    return `${w.resourceClass || "a window"} on ${where}`;
  }

  // Shows desktop `d`, logging it and why.
  switchTo(d, rule = null) {
    const from = this.ws.currentDesktop;
    if (!d || (from && d.id === from.id)) return;
    this.log(`workspace ${from ? from.name : "none"} -> ${d.name} (${this.because(rule)})`);
    this.thisTurn().desktop = d.id;
    this.ws.currentDesktop = d;
  }

  // Focuses `w`, logging it and why, unless it has focus already.
  focus(w, rule = null) {
    const active = this.ws.activeWindow;
    if (!active || idOf(active) !== idOf(w)) {
      this.log(`focus ${this.describe(w)} (${this.because(rule)})`);
      this.thisTurn().focus = idOf(w);
    }
    this.ws.activeWindow = w;
  }

  // KWin says desktop `d` is shown: logged if tide didn't switch to it.
  sawDesktop(previous, d) {
    if (this.turn && this.turn.desktop === d.id) {
      this.turn.desktop = null;
      return;
    }
    this.log(`workspace ${previous ? previous.name : "none"} -> ${d.name} (not tide)`);
  }

  // KWin says `w`, or nothing, has focus: logged if tide didn't focus it.
  // Plasma's panels and the like aren't app windows, and aren't logged.
  sawFocus(w) {
    const id = w ? idOf(w) : null;
    const turn = this.thisTurn();
    if (id !== null && turn.focus === id) {
      turn.focus = null;
      return;
    }
    if (w === null) this.log("focus nothing (not tide)");
    else if (this.appWindow(w)) this.log(`focus ${this.describe(w)} (not tide)`);
  }

  // --- Report a bug (SPEC.md §4.9) ---------------------------------------

  // Meta+Shift+B: has systemd start tide-kde's unit, which runs tide's
  // collector, `tide report-bug`. A script can't run a program, and
  // callDBus says nothing of a call that fails, so it asks first whether
  // the unit is there.
  reportBug() {
    const unit = "tide-kde-report-bug.service";
    const systemd = "org.freedesktop.systemd1";
    const manager = "org.freedesktop.systemd1.Manager";
    const fail = (e) => this.problem(`Couldn't report a bug: ${e}`);
    this.log("reporting a bug");
    this.env.callDBus(systemd, "/org/freedesktop/systemd1", manager, "LoadUnit", unit, (path) => {
      try {
        this.env.callDBus(systemd, String(path), "org.freedesktop.DBus.Properties", "Get",
          "org.freedesktop.systemd1.Unit", "LoadState", (state) => {
            try {
              if (state !== "loaded") {
                this.problem("To report a bug, run make setup in tide-kde");
                return;
              }
              this.env.callDBus(systemd, "/org/freedesktop/systemd1", manager, "StartUnit", unit, "replace");
            } catch (e) {
              fail(e);
            }
          });
      } catch (e) {
        fail(e);
      }
    });
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
      w.desktopsChanged?.connect(() => this.windowsChanged());
      w.captionNormalChanged?.connect(() => this.windowsChanged());
      w.minimizedChanged?.connect(() => this.windowsChanged());
      w.moveableChanged?.connect(again);
      w.resizeableChanged?.connect(again);
      w.interactiveMoveResizeStarted?.connect(() => this.dragStarted(w));
      w.interactiveMoveResizeStepped?.connect((g) => this.dragStepped(w, g));
      w.interactiveMoveResizeFinished?.connect(() => this.dragFinished(w));
      w.frameGeometryAboutToChange?.connect(() => this.dragAsked(w, true));
      w.frameGeometryChanged?.connect(() => this.dragAsked(w, false));
    }
    this.place(w, quiet ? null : this.ws.activeWindow);
    this.windowsChanged();
  }

  // Reopened windows go back to their desktops (tide SPEC.md §6.5): an
  // app's windows that open again, with the titles of windows of its that
  // closed, go back where those were, made again if they went. `gone` is a
  // window going, and `watched` whether tide watched it: if so, it's looked
  // at once more first, as it is now, since its desktop may have been
  // renamed since it was last seen. Then it's left out, though KWin may
  // still list it.
  windowsChanged(gone = null, watched = false) {
    const others = this.ws.windowList().filter((w) => w !== gone && this.candidate(w));
    if (gone && watched) this.windowsSeen(others.concat([gone]));
    this.windowsSeen(others);
  }

  windowsSeen(windows) {
    const now = this.env.now ? this.env.now() : Date.now();
    const list = windows.map((w) => {
      const desktops = w.desktops ?? [];
      const workspace = desktops.length === 1 ? desktops[0].name : "";
      return {
        address: idOf(w),
        app: String(w.resourceClass ?? ""),
        title: String(w.captionNormal ?? w.caption ?? ""),
        workspace,
        // A window minimized while it waits for its title stays put.
        place: w.minimized ? `${workspace}\nminimized` : workspace,
      };
    });
    const r = reopened.windowsChanged(this.reopened, list, now);
    this.reopened = r.state;
    for (const m of r.moves) {
      const w = this.ws.windowList().find((x) => idOf(x) === m.address);
      if (!w || w.deleted) continue;
      const desktop = this.ws.desktops.find((d) => workspaces.sameName(d.name, m.workspace)) ?? null;
      this.log(`sending ${m.app}'s window, reopened, back to ${m.workspace}`);
      this.send(w, { name: m.workspace, desktop });
    }
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
    if (!this.tiled(w)) this.tellEdges(id, layout.FLOATING);
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
    const app = this.watched.delete(id);
    this.dragFrom.delete(id);
    this.boxes.delete(id);
    this.tellEdges(id, layout.FLOATING);
    this.history = this.history.filter((x) => x !== id);
    this.marks = this.marks.filter((m) => m !== id);
    if (this.heeded.delete(id)) this.announceAttention();
    if (key !== undefined) {
      layout.remove(this.parts.get(key), id);
      this.relayout(key);
    } else {
      this.updateDim();
    }
    if (app) this.refocus(w, { sameOutput: false });
    this.windowsChanged(w, app);
  }

  minimizedChanged(w) {
    this.place(w);
    if (w.minimized) this.refocus(w, { sameOutput: true });
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
    const part = this.parts.get(key);
    const boxes = layout.arrange(part, area, windows.map(idOf), this.config);
    windows.forEach((w, i) => {
      const id = idOf(w);
      const b = boxes.get(id);
      const want = { x: b.x, y: b.y, width: b.w, height: b.h };
      // Where tide last asked it to be, which it may yet be going to
      const asked = this.boxes.get(id);
      this.boxes.set(id, want);
      this.tellEdges(id, layout.dragEdges(part, windows.length, i, b, area));
      // KWin has the one whose edge you're dragging, until you let go
      const from = this.dragFrom.get(id);
      if (from && from.resize) return;
      if (!sameBox(w.frameGeometry, want) || (asked && !sameBox(asked, want))) w.frameGeometry = want;
    });
  }

  // Tells tide's decoration which sides of tile `id` a drag moves, or that
  // it's no tile (SPEC.md §4.8), when that has changed.
  tellEdges(id, edges) {
    const was = this.edges.has(id) ? this.edges.get(id) : layout.FLOATING;
    if (was === edges) return;
    if (edges === layout.FLOATING) this.edges.delete(id);
    else this.edges.set(id, edges);
    if (!this.tellDecoration("setEdges", id, edges)) this.edges.delete(id);
  }

  // Calls tide's decoration, which is inside KWin, at KWin's own D-Bus
  // name. With no decoration nothing answers, and KWin's callDBus says
  // nothing of it; so the decoration asks for everything again as it
  // starts (reannounce). Returns whether the call was made.
  tellDecoration(method, ...args) {
    try {
      this.env.callDBus("org.kde.KWin", "/org/tide/Decoration", "org.tide.Decoration", method, ...args);
      return true;
    } catch (e) {
      this.log(`couldn't tell tide's decoration which sides of a tile drag (${e}), so its shadow may not resize it`);
      return false;
    }
  }

  relayoutAll() {
    for (const key of new Set(this.placed.values())) this.relayout(key);
  }

  // --- Focus after minimizing or closing (SPEC.md §4.4) -------------------

  // The current turn of KWin's event loop, begun if it hasn't been: it
  // ends once KWin is done with what it's doing (`later`).
  thisTurn() {
    if (!this.turn) {
      this.turn = { lost: null, cleared: new Set(), desktop: null, focus: null };
      this.env.later(() => {
        this.turn = null;
      });
    }
    return this.turn;
  }

  activated(w) {
    this.sawFocus(w);
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

  // The window under the pointer once `gone` has left: the topmost there,
  // if it's an app's window that isn't waiting. With `output`, the pointer
  // must be on that output, and only its windows count.
  underPointer(gone, output) {
    const c = this.ws.cursorPos;
    if (!c) return null;
    if (output) {
      const at = this.ws.screenAt(c);
      if (!at || at.name !== output.name) return null;
    }
    const stack = this.ws.stackingOrder ?? [];
    for (let i = stack.length - 1; i >= 0; i--) {
      const w = stack[i];
      if (idOf(w) === idOf(gone) || !this.shown(w)) continue;
      if (output && (!w.output || w.output.name !== output.name)) continue;
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

  // Once `gone`, the window you were in, is minimized or closed and tide
  // has laid out again, focuses the window under the pointer (tide SPEC.md
  // §6.7, §14.2). KWin has already focused its own pick, as the space was
  // still empty. After a minimize, only a window on `gone`'s output
  // counts, and with none there, the window you were in before on it
  // does; after a close, any output's, and with none, KWin's pick stays.
  refocus(gone, { sameOutput }) {
    const turn = this.turn;
    if (!turn || !turn.lost || turn.lost.id !== idOf(gone)) return;
    const output = sameOutput ? gone.output : null;
    if (sameOutput && !output) return;
    const after = sameOutput ? "after a minimize" : "after a close";
    let target = this.underPointer(gone, output);
    let rule = `the window under the pointer ${after}`;
    if (!target && sameOutput) {
      target = this.usedBefore(gone, output, turn.lost.history);
      rule = `the window used before on that monitor ${after}`;
    }
    const picked = this.ws.activeWindow;
    if (!target || (picked && idOf(picked) === idOf(target))) return;
    this.focus(target, rule);
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
    this.focus(w);
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
  // tide's decoration asks the same way as it starts (SPEC.md §4.8): it
  // has heard none of what tide said before then, so every tile's sides
  // are told again.
  reannounce() {
    this.announced = null;
    this.announce();
    this.edges.clear();
    this.relayoutAll();
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
    const from = { x: g.x, y: g.y, width: g.width, height: g.height, resize: !!w.resize, last: null, share: null, asked: false };
    // The main share and the lone window's width as the drag began, which
    // an edge dragged back to where it was gives back.
    const part = this.parts.get(this.placed.get(idOf(w)));
    if (part) from.share = { mode: part.mode, mfact: part.opts[part.mode]?.mfact, singleWidth: part.singleWidth };
    this.dragFrom.set(idOf(w), from);
  }

  // As a tile's edge is dragged, the tiles beside it follow: each step
  // sets the main share, or a lone window's width, as letting go does.
  // `g` is where KWin has the window going, which its frame follows once
  // the app has resized.
  dragStepped(w, g) {
    const id = idOf(w);
    const from = this.dragFrom.get(id);
    const key = this.placed.get(id);
    if (!from || !from.resize || !g || key === undefined || !this.tiled(w)) return;
    from.last = { x: g.x, y: g.y, width: g.width, height: g.height };
    from.asked = false;
    if (this.resized(w, key, from, from.last)) this.relayout(key);
  }

  // Sets the main share of the part at `key`, or its lone window's width,
  // from tile `w`'s edge having been dragged from box `from` to `now`.
  // Returns whether either changed.
  resized(w, key, from, now) {
    const part = this.parts.get(key);
    const ids = this.tiledIn(key).map(idOf);
    const area = this.area(this.outputOf(key), this.desktopOf(key));
    // Back where it began, after steps that moved it: as it was then
    if (now.x === from.x && now.width === from.width) return this.restoreShare(part, from.share);
    if (ids.length === 1) {
      const f = geometry.singleWidthFor(area, { x: from.x, w: from.width }, { x: now.x, w: now.width });
      if (f === null || f === part.singleWidth) return false;
      part.singleWidth = f;
      return true;
    }
    const right = now.x + now.width !== from.x + from.width;
    const edge = right ? "right" : now.x !== from.x ? "left" : null;
    if (!edge) return false;
    const x = edge === "right" ? now.x + now.width : now.x;
    const opts = part.opts[part.mode];
    const m = geometry.mfactFor(part.mode, area, ids.length, opts, layout.singleRules(part, this.config), ids.indexOf(idOf(w)), edge, x);
    if (m === null || m === opts.mfact) return false;
    layout.setMfact(part, m);
    return true;
  }

  // Notes whether KWin has asked the window being dragged for a geometry
  // since the drag's last step, which is how a resize cancelled shows.
  // - KWin says only that a resize finished, cancelled or not, and a
  //   script can't read where KWin has the window going.
  // - But each step asks the window for its geometry and then says it
  //   stepped (Window::updateInteractiveMoveResize), and a cancel asks it
  //   to go back to where it began, with no step, and then says it
  //   finished (Window::finishInteractiveMoveResize). Each asking shows as
  //   frameGeometryAboutToChange (XdgSurfaceWindow::moveResizeInternal).
  // - A frame that changes is the app catching up, not a cancel.
  // - An X11 window's steps and cancel go another way
  //   (X11Window::doInteractiveResizeSync), so its cancel doesn't show,
  //   and ends as letting go does.
  dragAsked(w, asked) {
    const from = this.dragFrom.get(idOf(w));
    if (from) from.asked = asked;
  }

  // Gives the part back the main share and lone window's width it had as
  // a drag began, `share`. Returns whether either changed.
  restoreShare(part, share) {
    if (!share || share.mode !== part.mode) return false;
    const opts = part.opts[part.mode];
    const changed = part.singleWidth !== share.singleWidth || (opts && opts.mfact !== share.mfact);
    if (share.singleWidth === undefined) delete part.singleWidth;
    else part.singleWidth = share.singleWidth;
    if (opts && share.mfact !== undefined) opts.mfact = share.mfact;
    return !!changed;
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
    if (from.resize) {
      // Cancelled, as with Escape: the share it had as the drag began
      if (from.asked) this.restoreShare(part, from.share);
      // Where KWin last had it going, which its frame may not have reached
      else this.resized(w, key, from, from.last || w.frameGeometry);
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
    this.focus(windows[ids.indexOf(next)]);
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
    if (!this.tiled(w)) this.tellEdges(id, layout.FLOATING);
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
    if (r.tile) this.focus(r.tile.window);
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
    if (d) this.switchTo(d);
  }

  send(w, entry, { follow = false } = {}) {
    if (!w || !entry) return;
    const d = this.make(entry);
    if (!d) return;
    w.desktops = [d];
    if (follow) {
      this.show({ name: d.name, desktop: d });
      this.focus(w);
    }
  }

  desktopChanged(previous) {
    this.sawDesktop(previous, this.ws.currentDesktop);
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
