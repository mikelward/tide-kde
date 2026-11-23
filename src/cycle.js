// Alt+Tab held (tide SPEC.md §6.6), as tide for Linux's layout.lua has it:
// the press that begins it notes the focused window and moves nothing, so a
// tap is the swap with the master. Each further press moves focus to the
// next tiled window in layout order, round from the end. The choice is made
// as Alt comes up, but a KWin script can't hear that, so here a pause of
// PAUSE_MS after the last press makes it instead: the focused window becomes
// the master, unless focus moved and it's the master already.
//
// This is the part with no KWin in it: tide.js says where focus is and does
// what it decides. `after(ms, f)` runs `f` once, `ms` from now, and returns
// something with `stop()`.

export const PAUSE_MS = 500;

// Where focus goes from `active` in `order`, `dir` places on, round from the
// end; from a window not in it, or none, the master. Null with no windows.
export function step(order, active, dir) {
  if (order.length === 0) return null;
  const i = active === null ? -1 : order.indexOf(active);
  if (i < 0) return order[0];
  return order[(((i + dir) % order.length) + order.length) % order.length];
}

// Whether choosing ends in a swap with the master, given how it began,
// {key, start, last, stepped}; focus moved or a workspace switched in
// between has already ended it (Cycle.focused, Cycle.cancel), and where things are now, {key, active,
// order}. Anything else moving focus meanwhile, or the part changing, makes
// none: tide never moves a window you didn't choose.
export function commits(c, now) {
  if (now.key !== c.key || now.active === null) return false;
  if (!now.order.includes(now.active)) return false;
  if (now.active !== c.last) return false;
  // Focus moved onto the master: leave it.
  if (c.stepped && now.order[0] === now.active) return false;
  return true;
}

export class Cycle {
  // `after` as above; `done(c)` runs as the pause ends, with how it began.
  constructor(after, done, pause = PAUSE_MS) {
    this.after = after;
    this.done = done;
    this.pause = pause;
    this.state = null;
    this.timer = null;
  }

  cycling() {
    return this.state !== null;
  }

  // A press, `dir` 1 for Alt+Tab, -1 for Alt+Shift+Tab, with where things
  // are, {key, active, order}. Returns the window to focus, or null. A press
  // in another part than the one it began in begins afresh there.
  press(dir, here) {
    let target = null;
    if (this.state === null || this.state.key !== here.key) {
      this.state = { key: here.key, start: here.active, last: here.active, stepped: false, expect: null };
    } else {
      target = step(here.order, here.active, dir);
      if (target === null || target === here.active) target = null;
      else {
        this.state.last = target;
        this.state.stepped = true;
        this.state.expect = target;
      }
    }
    this.restart();
    return target;
  }

  restart() {
    this.timer?.stop();
    this.timer = this.after(this.pause, () => {
      const c = this.state;
      this.state = null;
      this.timer = null;
      if (c) this.done(c);
    });
  }

  // Focus moved to `id` (null for none). Only the move a step asked for
  // keeps it going: any other, even one that comes back, ends it with no
  // choice, as the window focused may not be the one chosen. Returns true
  // if it ended it.
  focused(id) {
    if (this.state === null) return false;
    if (id !== null && id === this.state.expect) {
      this.state.expect = null;
      return false;
    }
    this.cancel();
    return true;
  }

  // Ends it with no choice made.
  cancel() {
    this.timer?.stop();
    this.timer = null;
    this.state = null;
  }
}
