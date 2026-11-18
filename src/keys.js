// tide's window and workspace keys (tide SPEC.md §6.6), as KWin global
// shortcuts. Each is {name, title, key, action, arg}: `name` is the
// shortcut's ID in KDE's settings, `title` what Shortcuts in System
// Settings shows, `key` the default, written as Qt writes it, and `action`
// the Tide method a press calls, with `arg`.
//
// Where Plasma holds a key too (Alt+Tab, Meta+1…9, the arrows), both have
// it and a press goes to Plasma's, the older shortcut; setup frees Plasma's
// (SPEC.md §4.5).

const SHIFTED_DIGITS = [")", "!", "@", "#", "$", "%", "^", "&", "*", "("];

function workspaceKeys() {
  const out = [];
  for (let n = 1; n <= 10; n++) {
    const digit = n % 10;
    const which = digit === 0 ? "the last workspace" : `workspace ${digit}`;
    out.push({ name: `tide-go-${digit}`, title: `Go to ${which}`, key: `Meta+${digit}`, action: "goNth", arg: digit });
    out.push({
      name: `tide-send-${digit}`,
      title: `Send the window to ${which}`,
      key: `Meta+${SHIFTED_DIGITS[digit]}`,
      action: "sendNth",
      arg: digit,
    });
  }
  return out;
}

export const KEYS = [
  { name: "tide-focus-down", title: "Focus the next window in the stack", key: "Meta+J", action: "focusStack", arg: 1 },
  { name: "tide-focus-up", title: "Focus the previous window in the stack", key: "Meta+K", action: "focusStack", arg: -1 },
  { name: "tide-move-down", title: "Move the window down the stack", key: "Meta+Shift+J", action: "moveStack", arg: 1 },
  { name: "tide-move-up", title: "Move the window up the stack", key: "Meta+Shift+K", action: "moveStack", arg: -1 },
  { name: "tide-focus-left", title: "Focus the window to the left", key: "Meta+Left", action: "focusSide", arg: -1 },
  { name: "tide-focus-right", title: "Focus the window to the right", key: "Meta+Right", action: "focusSide", arg: 1 },
  { name: "tide-move-left", title: "Move the window left", key: "Meta+Shift+Left", action: "moveSide", arg: -1 },
  { name: "tide-move-right", title: "Move the window right", key: "Meta+Shift+Right", action: "moveSide", arg: 1 },
  { name: "tide-focus-above", title: "Focus the window above", key: "Meta+Up", action: "focusVertical", arg: -1 },
  { name: "tide-focus-below", title: "Focus the window below", key: "Meta+Down", action: "focusVertical", arg: 1 },
  { name: "tide-move-above", title: "Move the window up", key: "Meta+Shift+Up", action: "moveVertical", arg: -1 },
  { name: "tide-move-below", title: "Move the window down", key: "Meta+Shift+Down", action: "moveVertical", arg: 1 },
  { name: "tide-zoom", title: "Make the window the master", key: "Alt+Tab", action: "zoom" },
  { name: "tide-grow", title: "Grow the master", key: "Meta+\\", action: "mfact", arg: 1 },
  { name: "tide-shrink", title: "Shrink the master", key: "Meta+/", action: "mfact", arg: -1 },
  { name: "tide-add-master", title: "Add a master", key: "Meta+=", action: "nmaster", arg: 1 },
  { name: "tide-remove-master", title: "Remove a master", key: "Meta+-", action: "nmaster", arg: -1 },
  { name: "tide-next-layout", title: "Next layout", key: "Meta+.", action: "cycle", arg: 1 },
  { name: "tide-previous-layout", title: "Previous layout", key: "Meta+,", action: "cycle", arg: -1 },
  { name: "tide-last-layout", title: "The layout used last", key: "", action: "lastLayout" },
  { name: "tide-monocle", title: "Toggle monocle", key: "Meta+O", action: "monocle" },
  { name: "tide-monocle-backtick", title: "Toggle monocle (backtick)", key: "Meta+`", action: "monocle" },
  { name: "tide-close", title: "Close the window", key: "Meta+Backspace", action: "close" },
  { name: "tide-minimize", title: "Minimize the window", key: "Meta+Z", action: "minimize" },
  { name: "tide-maximize", title: "Toggle maximize", key: "Meta+X", action: "maximize" },
  { name: "tide-fullscreen", title: "Toggle fullscreen", key: "Meta+Shift+X", action: "fullscreen" },
  // No key, as in tide: undoes either
  { name: "tide-restore", title: "Restore the window", key: "", action: "restore" },
  { name: "tide-float", title: "Toggle floating", key: "Meta+Shift+F", action: "toggleFloat" },
  { name: "tide-float-insert", title: "Toggle floating (Insert)", key: "Meta+Ins", action: "toggleFloat" },
  { name: "tide-home", title: "Go to home", key: "Meta+Home", action: "goHome" },
  { name: "tide-home-or-back", title: "Flip between home and the last workspace", key: "Meta+Tab", action: "homeOrBack" },
  { name: "tide-last-other", title: "Go to the last workspace other than home", key: "Meta+End", action: "lastOther" },
  { name: "tide-previous-workspace", title: "Previous workspace with a window", key: "Meta+PgUp", action: "stepWorkspace", arg: -1 },
  { name: "tide-next-workspace", title: "Next workspace with a window", key: "Meta+PgDown", action: "stepWorkspace", arg: 1 },
  { name: "tide-move-previous-workspace", title: "Move the window to the previous workspace", key: "Meta+Shift+PgUp", action: "moveToStep", arg: -1 },
  { name: "tide-move-next-workspace", title: "Move the window to the next workspace", key: "Meta+Shift+PgDown", action: "moveToStep", arg: 1 },
  // No key, as in tide: yours to give it in System Settings
  { name: "tide-next-attention", title: "Go to the next window wanting attention", key: "", action: "nextAttention" },
  // Plasma 6.7 binds nothing to it (SPEC.md §4.9)
  { name: "tide-report-bug", title: "Report a bug", key: "Meta+Shift+B", action: "reportBug" },
  ...workspaceKeys(),
  // No key: the layout widget presses it as it loads, for the layouts now.
  { name: "tide-announce", title: "Tell the layout widget the layouts", key: "", action: "reannounce" },
  // No key: a click on the layout widget, which is on the monitor under
  // the pointer, as the click is.
  { name: "tide-next-layout-here", title: "Next layout on the monitor under the pointer", key: "", action: "cycleHere" },
];
