// Workspaces as KWin's virtual desktops (SPEC.md §4.3), free of KWin's
// API. A desktop spans every monitor, as tide's workspaces do.
//
// The rules are tide's (tide SPEC.md §6.5): the standing names come first,
// home leading, made or not; the rest follow in the order they were made.
// Home is made at start and never removed. Another standing one is made the
// first time you go there or send a window there, and stays. The rest go
// once you leave them empty.
//
// A view is {standing, desktops, current, recent}: `desktops` is KWin's
// list in its order, each {id, name, windows}, `windows` being how many it
// holds; `current` is the current desktop's id; and `recent` the ids of the
// desktops shown before it, most recent first.

export const DEFAULT_STANDING = ["in", "re", "oc", "me"];

// The longest a name may be, in characters, as on tide.
export const MAX_NAME = 32;

// What a name can't hold, as on tide: quotes, backslashes, `@` and control
// characters (C0 and C1, as Unicode's Cc). tide keeps `@` for a monitor's
// part of a workspace. Spelled out, as KWin's script engine has no \p{...}.
const UNSAFE = /["'`\\@\u0000-\u001f\u007f-\u009f]/;

// A name as typed, made one: trimmed, and refused if it's empty, runs over
// more than one line, holds an unsafe character or is too long. Returns
// {name} or {error}, as tide's checkName does.
export function checkName(text) {
  const name = String(text ?? "").trim();
  if (name === "") return { error: "a workspace needs a name" };
  if (/[\n\r\u2028\u2029]/.test(name)) return { error: "a workspace's name is one line" };
  if (UNSAFE.test(name)) return { error: "a workspace's name can't have quotes, backslashes, @ or control characters" };
  if ([...name].length > MAX_NAME) return { error: `a workspace's name is at most ${MAX_NAME} characters` };
  return { name };
}

// Whether two names are the same workspace's: case doesn't count.
export function sameName(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

// The standing list from its setting, a comma-separated string, or an error
// naming the setting: none, a bad name, or one listed twice.
export function parseStanding(text) {
  const names = String(text ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n !== "");
  if (names.length === 0) return { error: "standing needs at least one name, the first being home" };
  for (const [i, n] of names.entries()) {
    const checked = checkName(n);
    if (checked.error) return { error: `standing: ${JSON.stringify(n)}: ${checked.error}` };
    if (names.slice(0, i).some((m) => sameName(m, n))) return { error: `standing: ${n} is listed twice` };
  }
  return { names };
}

export function isStanding(view, name) {
  return view.standing.some((n) => sameName(n, name));
}

// The desktop named `name`, ignoring case, or null.
export function find(view, name) {
  return view.desktops.find((d) => sameName(d.name, name)) ?? null;
}

// The workspaces in the bar's order, each {name, desktop}: the standing
// ones, `desktop` null for one not made yet, then the rest in KWin's order,
// which is the order they were made in.
export function barOrder(view) {
  const standing = view.standing.map((n) => {
    const d = find(view, n);
    return { name: d ? d.name : n, desktop: d };
  });
  const rest = view.desktops.filter((d) => !isStanding(view, d.name)).map((d) => ({ name: d.name, desktop: d }));
  return [...standing, ...rest];
}

// The `n`th workspace in bar order, from 1, or null past the last. 0 is the
// last, as Super+0 is.
export function nth(view, n) {
  const order = barOrder(view);
  return order[n === 0 ? order.length - 1 : n - 1] ?? null;
}

export function home(view) {
  return barOrder(view)[0];
}

function currentName(view) {
  return view.desktops.find((d) => d.id === view.current)?.name ?? null;
}

// The workspace `by` places from the current one in bar order, wrapping
// from the last to home and back. With `withWindows`, the nearest that way
// with a window, so Super+PgUp and PgDn pass over empty ones; moving a
// window takes the very next, empty or not. Null if there's none.
export function step(view, by, { withWindows = false } = {}) {
  const bar = barOrder(view);
  const name = currentName(view);
  const i = bar.findIndex((w) => w.desktop && w.desktop.id === view.current);
  if (i < 0 || name === null) return null;
  for (let k = 1; k < bar.length; k++) {
    const w = bar[(((i + by * k) % bar.length) + bar.length) % bar.length];
    if (!withWindows || (w.desktop && w.desktop.windows > 0)) return w;
  }
  return null;
}

// Super+End: the last workspace other than home you showed, other than the
// current one, so presses toggle between two. Null if there's none.
export function lastOther(view) {
  const h = home(view).desktop;
  for (const id of view.recent) {
    if (id === view.current || (h && id === h.id)) continue;
    const d = view.desktops.find((x) => x.id === id);
    if (d) return { name: d.name, desktop: d };
  }
  return null;
}

// Super+Tab: from any other workspace, home; from home, the last other one.
export function homeOrBack(view) {
  const h = home(view);
  if (h.desktop && h.desktop.id === view.current) return lastOther(view);
  return h;
}

// Where in KWin's list a new desktop named `name` goes, from 0: a standing
// one after the standing ones before it in the list, the rest at the end.
export function position(view, name) {
  if (!isStanding(view, name)) return view.desktops.length;
  const i = view.standing.findIndex((n) => sameName(n, name));
  const before = view.standing.slice(0, i);
  let at = 0;
  view.desktops.forEach((d, k) => {
    if (before.some((n) => sameName(n, d.name))) at = k + 1;
  });
  return at;
}

// The desktops to remove: those not standing, with no window, that aren't
// showing.
export function leftEmpty(view) {
  return view.desktops.filter((d) => d.id !== view.current && d.windows === 0 && !isStanding(view, d.name));
}

// The history after showing desktop `id`, having shown `previous`.
export function remember(recent, previous, id, limit = 20) {
  const out = [previous, ...recent].filter((x, i, all) => x && x !== id && all.indexOf(x) === i);
  return out.slice(0, limit);
}
