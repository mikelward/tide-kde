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
    };
  }
  print("probe: dump " + JSON.stringify({
    desktops: workspace.desktops.map((d) => d.name),
    current: workspace.currentDesktop.name,
    windows,
  }));
});
print("probe: ready");
