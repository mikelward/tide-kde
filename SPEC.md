# tide-kde: tide on KDE Plasma

**Status: the basics are built:** the layouts, the mouse, floating, the
workspaces and their keys, dimming inactive windows, the layout widget,
setup and releases (§4); the settings are in the README. The rest of
this explores what KWin allows. It takes what tide for Linux does under
Hyprland ([mikelward/tide](https://github.com/mikelward/tide)), and what
tidewm and tidesway carry of it in their compositors
([mikelward/tidewm](https://github.com/mikelward/tidewm),
[mikelward/tidesway](https://github.com/mikelward/tidesway)), and says,
for each one, how Plasma can do it, how well, and at what cost.

Claims about KWin carry a source: KWin 6.7.5, the release Ubuntu's devel
release packages and CI tests, read in its source, with `strings` over
`libkwin.so` and its plugins, or in a headless KWin (§6). Plasma's other
parts are read at the same release. The rest are marked *(unverified)*.
References like "tide §6.1" are to tide for Linux's `SPEC.md`.

## 1. Goals

- **tide's window management on Plasma:** its layouts, the single-window
  rule, dimming inactive windows, named workspaces that span every
  monitor, the focus guard and its keys (tide §6, §14).
- **tide's launcher with its tabs.** tide's Plasma launcher (tide §8.5)
  stays tide's, and reads KWin's desktops and windows itself (§4.6).
- **Plasma stays Plasma.** Its panel, notifications, lock, login and
  settings stay its own. tide-kde adds to them; it replaces none, except
  Plasma's keys that tide's take (§4.5) and, as tide §5.5 already does,
  the launcher on `Meta+Space`.
- **Off undoes the script.** Disabling the script, or stopping
  `tide-kde.service`, leaves nothing of either to undo. What `make setup`
  changed (the README's Setup) stays until undone; an undo for it is
  planned (TODO.md).
- **Say what can't be done,** as tidemo does for macOS (§4).

## 2. What KWin allows

KWin 6 runs scripts in JavaScript or QML, packaged with a
`metadata.json` and installed with `kpackagetool6 --type KWin/Script`
(tested in CI, §6). A script sees and moves every window. It can't draw
outside QML, and can't veto a close: a window has no signal it could
stop one with (KWin's `src/window.h`). Its keys are global shortcuts, so
it can't take a key from one app alone *(unverified)*.

A script's settings are its group in `kwinrc`, `[Script-<id>]` (KWin's
`Script::config`), which `readConfig(key, default)` reads. It hands the
default to KConfig's `readEntry`, which reads the value as the default's
type, so with no default it gives nothing, even for a key that's set. A
script can't read other files, so tide's `layouts.json` (tide §16) can't
reach it: its settings are its own (README.md).

KWin's script engine is Qt's QV4. ES modules don't load in it, so
`scripts/bundle.mjs` joins `src/` into one script. A headless KWin shows
what else QV4 lacks of what Node runs, and `scripts/bundle.mjs` refuses
each:

- Object spread, `{ ...x }`, and class fields, public, static or
  private: the script fails to load.
- `\p{...}` in a regular expression: it matches nothing.
- `Object.fromEntries` and `structuredClone`: they're undefined.

What `tide.js` calls of KWin's script API (KWin's
`src/scripting/workspace_wrapper.h`, `src/window.h` and
`src/scripting/scripting.cpp`):

| Area | Names |
|---|---|
| Windows | `workspace.windowList`, `activeWindow`, `stackingOrder`; a window's `frameGeometry`, `output`, `desktops`, `activities`, `minimized`, `hidden`, `fullScreen`, `maximizeMode`, `setMaximize`, `closeWindow`, and what kind it is (`normalWindow`, `dialog`, `dock`, `transient`, `minSize`, `maxSize` and more) |
| Window signals | `windowAdded`, `windowRemoved`, `windowActivated`; a window's `frameGeometryChanged`, `outputChanged`, `desktopsChanged`, `activitiesChanged`, `minimizedChanged`, `fullScreenChanged`, `maximizedChanged`, `interactiveMoveResizeStarted`, `interactiveMoveResizeFinished` |
| Desktops | `desktops`, `currentDesktop`, `createDesktop`, `removeDesktop`; `desktopsChanged`, `currentDesktopChanged`; `currentActivity`, `currentActivityChanged` |
| Screens | `screens`, `activeScreen`, `clientArea`, `screenAt`, `cursorPos`, `sendClientToScreen`; the slots `slotSwitchToLeftScreen`, `slotSwitchToRightScreen`, `slotSwitchToAboveScreen` and `slotSwitchToBelowScreen`; `screensChanged`, `virtualScreenGeometryChanged` |
| Keys | `registerShortcut`, a global shortcut under KGlobalAccel |
| Elsewhere | `readConfig`; `callDBus`, for a notification, the layout widget (§4.7), and Dim Inactive: KWin's own `org.kde.kwin.Effects` `loadEffect` and `unloadEffect` (`src/effect/effecthandler.h`) |

And in KWin's own settings and effects:

- **Dim Inactive** is a stock effect (`src/plugins/diminactive`).
- **Focus stealing prevention** is a setting,
  `focusStealingPreventionLevel`, from None to Extreme (`src/options.h`).
- **X11 scaling**: `XwaylandClientsScale` (`src/workspace.cpp`), as
  Hyprland's `xwayland:force_zero_scaling` and tidesway's
  `xwayland_scaling`.
- **`closeRequested`** is a task manager asking KWin to close a window,
  over Plasma's window management protocol
  (`src/wayland/plasmawindowmanagement.h`). A script never sees it.

KWin's virtual desktops span every monitor, as tide's workspaces do
(tide §6.5), so that part is free.

## 3. Three ways to build it

| | A KWin script | Krohnkite, configured | A fork of KWin |
|---|---|---|---|
| What it is | tide's layouts and keys in JavaScript, against KWin's script API | An existing tiling script, with tide's settings | tide's code in KWin's C++, as tidesway is in sway's C |
| Layouts | tide's own | Krohnkite's: tile, three-column, monocle and more, but not tide's single-window rule per output *(unverified)* | tide's own |
| Focus guard | Partial (§4.4) | KWin's | Whole |
| Upkeep | Small: the script API changes rarely *(unverified)* | None of ours, but its pace isn't ours | Large: KWin is big and moves fast, and distros ship it |
| Install | `kpackagetool6`, per user | The same | A package replacing Plasma's compositor |

**Recommendation: a KWin script.** It is the pattern tidemo
(Hammerspoon) and tideco (a Chrome extension) follow: tide's behavior on
top of the platform's own manager. Krohnkite shows the approach works,
and tide §3.1 lists it, but tide's layouts and keys differ enough that
configuring it would leave gaps. A fork costs too much for what a script
can't reach (§4).

## 4. Feature map

Status: **yes**, **partial**, **no**, or **differs** (done another way).

### 4.1 Layouts (tide §6.1, §6.3, §6.4)

| Feature | Status | How |
|---|---|---|
| Tile: master left at 55% | yes | The script sets each window's `frameGeometry` within `clientArea` |
| Three columns at aspect ≥ 2.1, master centered at 50% | yes | Script geometry |
| Two columns plus a stack; monocle | yes | Script geometry |
| `mfact`, `nmaster` keys | yes | `registerShortcut` |
| Single window at 80% on a wide monitor (60% from 3.2) | yes | Script geometry, by each monitor's aspect |
| Drag to swap; edge drag to set the split | partial | `interactiveMoveResizeFinished` tells where a drag ended; the script re-lays out from there. Mid-drag feedback is KWin's *(unverified)* |
| Maximize and fullscreen | yes | KWin's own, `setMaximize` and `fullScreen`, on tide for Linux's keys; such a window leaves the layout |
| Floating: dialogs, fixed-size windows, windows on every desktop, and the float key | yes | The script leaves them out of the layout, where KWin placed them |

### 4.2 Dimming inactive windows (tide §6.2)

| Feature | Status | How |
|---|---|---|
| Dim inactive windows | yes | Dim Inactive, at a strength set in its settings (`[Effect-diminactive]` `Strength`, a percentage). tide §6.2 found KDE's dimming looks weaker than Hyprland's at the same number |
| No dimming with one window | differs | The effect has no rule for that (its `canDimWindow`), so the script loads it only while some monitor shows two windows or more, and unloads it otherwise, over KWin's own D-Bus (`org.kde.kwin.Effects`). A lone window on one monitor dims while the other monitor shows two |
| `nodim` for video and calls | no | Dim Inactive has no rule for a window; it leaves out panels, the desktop, keep-above and fullscreen windows by its own settings (`canDimWindow`) |

### 4.3 Workspaces and monitors (tide §6.5, §6.7)

| Feature | Status | How |
|---|---|---|
| Workspaces spanning every monitor | yes | KWin's virtual desktops |
| Named, made and removed on demand | yes | `createDesktop`, `removeDesktop`, and the desktop's name |
| `in`, `re`, `oc`, `me` standing | differs | Made at start if missing, and kept even empty, so Plasma's Pager lists them all. tide for Linux makes them on demand |
| A monitor's part, `@` | differs | KWin has no per-monitor desktop. Each monitor's windows are laid out on their own already |
| Minimize and restore (`Meta+Z`) | yes | A window's `minimized` |
| Move a window to a monitor | yes | `sendClientToScreen`, by the arrows' rule (tide §6.6) |

### 4.4 Focus and attention (tide §14)

| Feature | Status | How |
|---|---|---|
| New windows from other apps don't take focus | partial | KWin's focus stealing prevention at Medium, which `make setup` sets, covers most of tide §14.1: a new window from the app you're in takes focus, one from another app doesn't. tide's rules for launches, terminals and polkit aren't KWin's |
| Mark such a window urgent | yes | KWin does it with the prevention on *(unverified)* |
| Go to the next window wanting attention (`next_attention`) | yes | The `tide-next-attention` shortcut, with no key, as in tide for Linux. The windows are the launcher's Attention tab's, from the script's one follower of `demandsAttention` (§4.6). KWin keeps their order (`Workspace::attention_chain`) but gives a script none, so that follower also notes it, newest last. A press shows the newest one's desktop and activates it; KWin clears its mark as it does (`Workspace::setActiveWindow`). With none, nothing. tide shows the desktop itself, as KWin's activation switches desktops only by its Activation desktop policy |
| Minimizing the window you're in focuses the window under the pointer (tide §6.7) | yes | See below |
| A launch from tide's launcher takes focus | partial | KWin trusts an activation token *(unverified)*; the launcher passes one if Quickshell does |

**Focus after a minimize.** KWin picks the next window itself, before
the script hears. `XdgToplevelWindow::doMinimize` calls
`Workspace::activateNextWindow`, and only then does `Window::setMinimized`
emit `minimizedChanged`. So the spot under the pointer is still empty,
and KWin falls back to its focus chain: the window used last that reaches
onto the same output (`FocusChain::nextForDesktop`, with
`SeparateScreenFocus` on by default). That may be a window wanting
attention, or a floating one from the next output.

- **The script picks again** once it has re-tiled. It takes the topmost
  window under the pointer (`workspace.stackingOrder`, `cursorPos`),
  judging each tile by where the script put it. KWin moves a window's
  frame only once the app has resized
  (`XdgSurfaceWindow::moveResizeInternal`).
- **Otherwise, tide §6.7's fallback:** the window you were in before on
  that output. KWin gives a script no such history, so the script keeps
  its own from `windowActivated`.
- **The window you were in** is the one that lost activation in the same
  turn of KWin's event loop (`later` in `main.js`): `setActiveWindow`
  emits `windowActivated` for KWin's pick synchronously, before
  `minimizedChanged`. Minimizing another window moves no focus.
- **KWin's pick keeps its mark.** Activating a window clears its
  `demandsAttention` (`Workspace::setActiveWindow`), so if KWin picked a
  window wanting attention, the script marks it again.
- **A dialog** goes to its parent, as KWin's `activateNextWindow` sends
  it. The script leaves it.
- **`NextFocusPrefersMouse` stays off.** It makes KWin take the window
  under the pointer (`Workspace::windowUnderMouse`), but before the
  re-tile, so it can't find the one moving in. It also comes before a
  dialog's parent in `activateNextWindow`, so a minimized dialog would
  give focus to whatever is under the pointer.

### 4.5 Keys (tide §6.6)

| Feature | Status | How |
|---|---|---|
| tide's window and workspace keys | yes | `registerShortcut`, under `Meta`, as tide for Linux binds them under `Super`. Plasma binds none of `Meta+X`, `Meta+Shift+X`, `Meta+Shift+Up` or `Meta+Shift+Down` (KWin's, plasma-workspace's and plasma-desktop's source) |
| A key Plasma already has | yes | KGlobalAccel gives the key to both, and a press goes to the shortcut made first, Plasma's (kglobalacceld's `GlobalShortcutsRegistry::activeShortcutByKey`). `make setup` (`scripts/setup.mjs`) takes Plasma's off it in `kglobalshortcutsrc`, keeping their other keys, and binds tide's; KGlobalAccel reads them as the session starts |
| Pinned apps: an app's close key doesn't close it | no | A script can't take one app's keys, or veto a close (§2). tidewm does it with `keep_open` |

### 4.6 Launcher (tide §8)

| Feature | Status | How |
|---|---|---|
| Apps and Actions | yes | tide's Plasma launcher, as before |
| Workspaces and Windows | yes | tide's launcher reads KWin's own D-Bus as it opens: its desktops, its window search's windows, and each window's app and desktop (tide §8.5, mikelward/tide#445). It needs only stock KWin, not this script |
| Attention | yes | The windows KWin marks as wanting attention: those its focus stealing prevention keeps from taking focus, and those that ask. KWin's D-Bus doesn't say which (its `getWindowInfo` and window runner have no such field), so the script follows each window's `demandsAttention` and writes their UUIDs, as JSON, to the desktop's settings in plasmashell (group `tide`, key `attention`), as it writes the layout widget's. tide's launcher reads them as it opens (tide §8.5) |

### 4.7 Bar, login and lock

- **The bar** is Plasma's panel, to start with: its Pager shows the
  workspaces by name once `make setup` sets its Text to the desktops'
  names (Plasma's default is none). tide's own bar could run on Plasma later, fed by
  the script over D-Bus as a third backend beside Hyprland's and
  tidewm's (tide `shell/Compositor.qml`), but that's much more work.
  - Tiles keep out of the panels' room, KWin's placement area. KWin gives
    scripts no signal for that area changing (`workspace_wrapper.h`), so
    tide lays out again as a panel comes, moves or goes. Plasma's come
    after tide's first layout at login. For one that goes, KWin updates
    the area only on a timer it starts once scripts have heard
    (`Workspace::scheduleRearrange`), so tide looks again over the next
    few turns of KWin's event loop (`later` in `main.js`).
- **The layout symbol** is in a panel widget of its own, `plasmoid/`,
  showing the layout of the workspace on its panel's monitor, as tide's
  bar does. A click is the next layout. `make setup` puts it just after
  the Pager, where tide's bar has it, after the workspaces. It sets the
  widget's `index`, its place in the panel, which Plasma moves it to and
  saves; the panel's saved order, `AppletOrder`, is read only at start.
  - A script can call D-Bus but can't be called: the script API has
    `callDBus` and nothing to serve a call (`scripting.cpp`). So it can't
    serve the widget. Instead it writes the widget's settings through
    plasmashell's scripting (`org.kde.PlasmaShell.evaluateScript`,
    `writeConfig` then `reloadConfig`), which the widget follows at once.
    It writes them only when a layout changes.
  - A widget just added, or a plasmashell just started, asks for them
    by pressing a shortcut tide has with no key, `tide-announce`, through
    KGlobalAccel's `invokeShortcut`, with Plasma's QML D-Bus module
    (`org.kde.plasma.workspace.dbus`). A click presses
    `tide-next-layout-here` the same way: the next layout on the monitor
    under the pointer, which is the clicked widget's, wherever the focus
    is.
- **Login** is tide's greeter (tide §11), which already lists every
  session greetd can start, Plasma's among them. An SDDM theme could
  match it, but needn't. Plasma's Switch User asks the display manager
  over D-Bus, which greetd doesn't answer *(unverified)*.
- **Lock** stays Plasma's lock screen, which keeps its security.
  - **The wallpaper** is its own setting, so `make setup` gives it the
    desktop's: plasmashell's scripting reads the first desktop's image,
    and `kscreenlockerrc`'s `[Greeter][Wallpaper][org.kde.image][General]`
    `Image` takes it. It doesn't follow a later change.
  - **The face**, tide's hostname over the date and time (tide §11),
    needs Plasma changed. The greeter loads `lockscreen/LockScreen.qml`
    from the Plasma shell package (kscreenlocker's
    `UnlockApp::setShell`), which `plasmashellrc`'s `[Shell]`
    `ShellPackage` names, or else `PLASMA_DEFAULT_SHELL`. Both choose
    plasmashell's shell too, and a shell of another name keeps its own
    panels, so a tide package there would lose yours. Tested in a
    headless KWin: a shell package of tide's own loads in the greeter
    either way, and `kscreenlockerrc` names none.
  - So the way in is upstream: a `kscreenlockerrc` setting naming the
    package the greeter takes its lock screen from, falling back to the
    shell's. Until then, Plasma's own face shows.
- **Notifications, idle, screenshots and the theme** stay Plasma's.
  Their tide versions (tide §9, §10, §13, §15) need a session Plasma
  doesn't share.

## 5. `tide-kde.service`

`tide-kde.service` stays tide's, running tide's Plasma launcher
(`shell/kde.qml`, tide §8.5), with its Workspaces and Windows tabs. tide's
`setup` enables it, `tide-doctor` checks it, and scripts' `setup-kde`
binds `Meta+Space` to it.

- **Why not here.** The launcher is about 79 QML files and 57 modules of
  tide's shell. tide-kde would have to copy them, as tidemo copies tide's
  code, or run tide's installed files from a unit of its own; either way
  the two repositories would release in step for nothing.
- **What's here** is what runs inside KWin and Plasma: the script, the
  layout widget, setup and releases. Neither half needs the other: tide's
  launcher reads stock KWin, and tide-kde tiles with or without it.

## 6. Testing

- **Geometry** is pure JavaScript, free of KWin's API, as tide's Lua is
  free of Hyprland's. `node --test` runs it here, against tide's layout
  numbers.
- **tide.js** runs on a fake KWin (`src/fake_kwin.js`) for what a
  headless KWin can't be made to do, such as a drag or moving the
  pointer. It picks the next window as `activateNextWindow` does, and
  can hold geometry until the app resizes, as KWin does.
- **Defaults.** `make check-tide-defaults`, in CI against a tide
  checkout, fails when a default tide on KDE restates drifts from tide's:
  the layouts' main shares and counts, the cycle, where a new window goes,
  the ultrawide aspect, the lone-window rules, the main share's step and
  bounds, and the standing workspaces.
- **Against KWin.** `make test-kwin` runs a headless `kwin_wayland
  --virtual` per test, with the script loaded over D-Bus or installed as
  a user would. It opens foot windows, presses tide's keys through
  KGlobalAccel's `invokeShortcut`, and reads what a probe script prints
  to KWin's log. CI runs it in Ubuntu's devel release, the one that
  packages KWin 6; Debian testing has no `kwin-wayland` package now.
  - A container can't grant `kwin_wayland` its `CAP_SYS_NICE`, so the
    kernel won't run it there. A copy without the capability runs, if it
    keeps its name: KWin's own platform plugin checks it.
- **The launcher's** tests stay in tide.

## 7. Open questions

1. **The focus guard.** Is KWin's prevention at Medium close enough to
   tide §14.1, or does the script need its own rules on `windowAdded`?
2. **Pinned apps.** Without them, `Ctrl+Q` closes a browser on Plasma. Say
   so, or ask KWin upstream for a veto?

## Sources

- KWin's source at that release, in KDE's `kwin` repository: the script
  API (`src/scripting/`), `src/window.h`, `src/workspace.cpp`,
  `src/options.h`, `src/effect/effecthandler.h` and Dim Inactive
  (`src/plugins/diminactive/`).
- Ubuntu devel's `kwin-wayland` and `libkwin6` packages: `strings` over
  `libkwin.so.6` and `kwin_diminactive_config.so`, and `kwin_wayland
  --help`.
- A headless `kwin_wayland --virtual`: `make test-kwin` (§6), and the
  lock screen's shell package (§4.7).
- kglobalacceld's `src/globalshortcutsregistry.cpp` and
  `src/globalshortcut.cpp`: two shortcuts on one key (§4.5).
- kscreenlocker's `UnlockApp::setShell` (§4.7).
- plasma-workspace's and plasma-desktop's source: the keys Plasma binds
  (§4.5).
- tide for Linux's `SPEC.md`: §3.1, §5.5, §6 (§6.1 to §6.7), §8 and
  §8.5, §9, §10, §11, §13, §14 and §14.1, §15, §16.
