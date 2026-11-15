// The tests' eyes in KWin: says as windows open and move, and on its
// shortcut, everything the tests look at, as a line of JSON in KWin's log.
function watch(w) {
  if (!w.normalWindow) return;
  print("probe: added " + w.resourceClass);
  w.frameGeometryChanged.connect(() => print("probe: geometry " + w.resourceClass));
}
workspace.windowAdded.connect(watch);
registerShortcut("probe-dump", "probe: dump the state", "", () => {
  const windows = {};
  for (const w of workspace.windowList()) {
    if (!w.normalWindow) continue;
    const g = w.frameGeometry;
    windows[w.resourceClass] = {
      x: g.x,
      y: g.y,
      width: g.width,
      height: g.height,
      desktops: w.desktops.map((d) => d.name),
      output: w.output ? w.output.name : null,
      minimized: w.minimized,
      active: w === workspace.activeWindow,
      id: String(w.internalId),
      attention: w.demandsAttention,
    };
  }
  print("probe: dump " + JSON.stringify({
    desktops: workspace.desktops.map((d) => d.name),
    current: workspace.currentDesktop.name,
    area: (() => {
      const a = workspace.clientArea(KWin.PlacementArea, workspace.activeScreen, workspace.currentDesktop);
      return [a.x, a.y, a.width, a.height];
    })(),
    windows,
  }));
});
// Marks the windows of class "attend" as wanting attention, as an app
// asks or KWin's focus stealing prevention does.
registerShortcut("probe-attend", "probe: mark attend's windows", "", () => {
  for (const w of workspace.windowList()) if (w.resourceClass === "attend") w.demandsAttention = true;
});
// Every window but the active one wants attention, one by one in order of
// class, so the last class is the newest.
registerShortcut("probe-attention", "probe: mark the other windows wanting attention", "", () => {
  const others = workspace.windowList().filter((w) => w.normalWindow && w !== workspace.activeWindow);
  others.sort((a, b) => (a.resourceClass < b.resourceClass ? -1 : a.resourceClass > b.resourceClass ? 1 : 0));
  for (const w of others) w.demandsAttention = true;
});
print("probe: ready");
