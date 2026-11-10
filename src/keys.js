// tide's window and workspace keys (tide SPEC.md §6.6), as KWin global
// shortcuts. Each is {name, title, key, action, arg}: `name` is the
// shortcut's ID in KDE's settings, `title` what Shortcuts in System
// Settings shows, `key` the default, written as Qt writes it, and `action`
// the Tide method a press calls, with `arg`.
//
// A default only binds where no other shortcut holds the key; Plasma holds
// some of tide's (Alt+Tab, Meta+1…9, Meta+Left/Right), and setup frees them
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
  { name: "tide-maximize", title: "Maximize the window", key: "Meta+Up", action: "maximize" },
  { name: "tide-fullscreen", title: "Make the window fullscreen", key: "Meta+Shift+Up", action: "fullscreen" },
  { name: "tide-restore", title: "Restore the window", key: "Meta+Down", action: "restore" },
  { name: "tide-float", title: "Toggle floating", key: "Meta+Shift+F", action: "toggleFloat" },
  { name: "tide-float-insert", title: "Toggle floating (Insert)", key: "Meta+Ins", action: "toggleFloat" },
  { name: "tide-home", title: "Go to home", key: "Meta+Home", action: "goHome" },
  { name: "tide-home-or-back", title: "Flip between home and the last workspace", key: "Meta+Tab", action: "homeOrBack" },
  { name: "tide-last-other", title: "Go to the last workspace other than home", key: "Meta+End", action: "lastOther" },
  { name: "tide-previous-workspace", title: "Previous workspace with a window", key: "Meta+PgUp", action: "stepWorkspace", arg: -1 },
  { name: "tide-next-workspace", title: "Next workspace with a window", key: "Meta+PgDown", action: "stepWorkspace", arg: 1 },
  { name: "tide-move-previous-workspace", title: "Move the window to the previous workspace", key: "Meta+Shift+PgUp", action: "moveToStep", arg: -1 },
  { name: "tide-move-next-workspace", title: "Move the window to the next workspace", key: "Meta+Shift+PgDown", action: "moveToStep", arg: 1 },
  ...workspaceKeys(),
];
