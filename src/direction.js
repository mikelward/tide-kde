// Left and right between windows and monitors (tide SPEC.md §6.6): which
// window Meta+Left and Right select, where Meta+Shift+Left and Right move
// the window, and where a moved window lands on the next monitor, tiled or
// floating. Pure geometry on {x, y, w, h} boxes, free of KWin's API. A port
// of tide's hypr/tide/direction.lua, whose tests these are.
//
// One rule picks both a window and a monitor: of the boxes on that side,
// the one sharing the most height with where you are, then the one whose
// center is nearest, then the first listed. "On that side" means its
// center is left (d < 0) or right (d > 0) of yours.

function center(b) {
  return [b.x + b.w / 2, b.y + b.h / 2];
}

// How many pixels of height two boxes share.
export function overlap(a, b) {
  return Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

// Whether box `b` is on side `d` of box `from`.
export function beside(from, b, d) {
  const [fx] = center(from);
  const [bx] = center(b);
  return (d < 0 && bx < fx) || (d > 0 && bx > fx);
}

// Of `items`, each {box, ...} plus whatever the caller keeps, the one the
// rule picks against `from`, or null with none.
export function nearest(from, items) {
  const [fx, fy] = center(from);
  let best = null;
  let bestOverlap = 0;
  let bestDist = 0;
  for (const it of items) {
    const o = overlap(from, it.box);
    const [x, y] = center(it.box);
    const dist = (x - fx) ** 2 + (y - fy) ** 2;
    if (best === null || o > bestOverlap || (o === bestOverlap && dist < bestDist)) {
      best = it;
      bestOverlap = o;
      bestDist = dist;
    }
  }
  return best;
}

// The same, of the items on side `d` of `from` only.
export function pick(from, items, d) {
  return nearest(from, items.filter((it) => beside(from, it.box, d)));
}

// Of `items`, the ones nearest the edge you come in by going `d`: the left
// edge going right, the right edge going left. A pixel's slack keeps a
// column whose windows were rounded differently together.
export function atEdge(items, d) {
  const edge = (it) => (d > 0 ? it.box.x : -(it.box.x + it.box.w));
  if (items.length === 0) return [];
  const best = Math.min(...items.map(edge));
  return items.filter((it) => edge(it) <= best + 1);
}

// Of `monitors`, the next one past monitor `cur` going `d`, or null.
export function nextMonitor(cur, monitors, d) {
  const others = monitors.filter((m) => m.name !== cur.name).map((m) => ({ box: m.box, monitor: m }));
  const next = pick(cur.box, others, d);
  return next ? next.monitor : null;
}

// Where Meta+Left or Right goes from `box` on monitor `here`. `monitors` is
// every monitor, each {name, box, tiles}, its tiles each {box, ...}, in
// layout order. Returns {tile, monitor}: on this monitor if a tile is that
// way; at its edge, on the next monitor that way, at the edge you come in
// by and picked against `box` as well; tile null if that monitor has none;
// null with no monitor that way.
export function find(box, here, monitors, d) {
  const cur = monitors.find((m) => m.name === here);
  if (!cur) return null;
  const hit = pick(box, cur.tiles, d);
  if (hit) return { tile: hit, monitor: cur };
  const m = nextMonitor(cur, monitors, d);
  if (!m) return null;
  // The nearest window there is one at the edge you come in by. That
  // monitor is the side test, so a tile there whose center is back past
  // `box`'s still counts.
  return { tile: nearest(box, atEdge(m.tiles, d)), monitor: m };
}

// Where a window moved onto a monitor going `d` lands: of `slots`, the
// boxes the layout would give each place in its order once the window is
// there, the index of the place nearest the edge it came in by, then the
// one sharing the most height with `from`, where the window was, then the
// first. Null with no slots.
export function landing(slots, d, from) {
  let best = null;
  let bestEdge = 0;
  let bestOverlap = 0;
  slots.forEach((b, i) => {
    const edge = d > 0 ? b.x : -(b.x + b.w);
    const o = overlap(from, b);
    if (best === null || edge < bestEdge || (edge === bestEdge && o > bestOverlap)) {
      best = i;
      bestEdge = edge;
      bestOverlap = o;
    }
  });
  return best;
}

// Where a floating window at `box` in work area `from` goes in work area
// `to`: at the same relative spot, its offset in `from` scaled to `to`; at
// its size, shrunk only where it's bigger than `to`; then moved just enough
// to be inside `to`.
export function place(box, from, to) {
  const w = Math.min(box.w, to.w);
  const h = Math.min(box.h, to.h);
  const fx = from.w > 0 ? (box.x - from.x) / from.w : 0;
  const fy = from.h > 0 ? (box.y - from.y) / from.h : 0;
  let x = Math.floor(to.x + fx * to.w + 0.5);
  let y = Math.floor(to.y + fy * to.h + 0.5);
  x = Math.max(to.x, Math.min(x, to.x + to.w - w));
  y = Math.max(to.y, Math.min(y, to.y + to.h - h));
  return { x, y, w, h };
}
