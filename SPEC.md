# tide-kde: tide on KDE Plasma

**Status: the basics are built:** the layouts, the mouse, floating, the
workspaces and their keys, dimming inactive windows, the layout widget,
a window decoration whose shadow is the drag-to-resize zone (§4.8),
reporting a bug (§4.9), setup and releases (§4); the settings are in the README. The rest of
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

A script can't see a pointer press, set a cursor, start a pointer resize
or draw a shadow: `workspace_wrapper.h` and `window.h` have none of them.
A window decoration can do the last three. It is a KDecoration3 plugin, in
C++, loaded into KWin itself (§4.8).

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
| Elsewhere | `readConfig`; `callDBus`, for a notification, the layout widget (§4.7), Dim Inactive: KWin's own `org.kde.kwin.Effects` `loadEffect` and `unloadEffect` (`src/effect/effecthandler.h`), and systemd's `StartUnit` (§4.9); `console.info`, for the log (§4.9) |

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
| Drag to swap | partial | `interactiveMoveResizeFinished` tells where a drag ended; the script re-lays out from there. Mid-drag, the window moves as KWin moves it |
| Edge drag to set the split, from a window's shadow | yes, with tide's decoration | §4.8. The tiles beside the edge follow as it's dragged (`interactiveMoveResizeStepped`). Without the decoration there's no zone to press: KWin's own resize, as `Meta` and the right button, still sets the split |
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
| Reopened windows go back to their workspaces | yes | `src/reopened.mjs`, tide's own rules copied, which `make check-tide-reopened` compares: from the windows KWin lists, by `resourceClass` and `captionNormal`, sent back by setting `desktops`. KWin 6.7's own xdg-session-management restores the desktops of an app that asks for it before tide sees the window; Chromium doesn't ask yet (tide §6.5) |

### 4.4 Focus and attention (tide §14)

| Feature | Status | How |
|---|---|---|
| New windows from other apps don't take focus | partial | KWin's focus stealing prevention at Medium, which `make setup` sets, covers most of tide §14.1: a new window from the app you're in takes focus, one from another app doesn't. tide's rules for launches, terminals and polkit aren't KWin's |
| Mark such a window urgent | yes | KWin does it with the prevention on *(unverified)* |
| Go to the next window wanting attention (`next_attention`) | yes | The `tide-next-attention` shortcut, with no key, as in tide for Linux. The windows are the launcher's Attention tab's, from the script's one follower of `demandsAttention` (§4.6). KWin keeps their order (`Workspace::attention_chain`) but gives a script none, so that follower also notes it, newest last. A press shows the newest one's desktop and activates it; KWin clears its mark as it does (`Workspace::setActiveWindow`). With none, nothing. tide shows the desktop itself, as KWin's activation switches desktops only by its Activation desktop policy |
| Minimizing the window you're in focuses the window under the pointer (tide §6.7) | yes | See below |
| Closing it does too (tide §14.2) | yes | See below |
| A launch from tide's launcher takes focus | partial | KWin trusts an activation token *(unverified)*; the launcher passes one if Quickshell does |

**Focus after a minimize or close.** KWin picks the next window itself,
before the script hears. `XdgToplevelWindow::doMinimize` calls
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
- **Closing the window you're in** has the same gap:
  `Workspace::removeWaylandWindow` calls `activateNextWindow` before
  `removeWindow` emits `windowRemoved`. So the script picks again there
  too, by the same rule but on any output, as tide §14.2 has it. With
  nothing to take, KWin's pick stays.
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

### 4.8 Shadows, borders and drag to resize (tide §6.2, §6.4, §6.6)

tide's standard, on every compositor: a window's shadow is where a drag
resizes it, floating or tiled, and the zone is at least as wide as the
shadow (tide §6.6). On Plasma that takes a window decoration, `decoration/`:
`org.tide.decoration`, a KDecoration3 plugin. It is optional. Without it,
windows keep Plasma's decoration and its resize zone.

| Feature | Status | How |
|---|---|---|
| A floating window's shadow is its resize zone | yes | The decoration's resize-only borders, as far out as the shadow reaches |
| The zone with shadows off: 8 px | yes | The same borders, 8 px |
| A window that casts no shadow has the same zone | yes | The zone follows the setting, not the shadow drawn |
| A tile's shadow across the master/stack edge drags it; so do a lone window's sides | yes | The script tells the decoration which sides drag |
| Edges at the display's edge, and a stack's rows, don't drag | yes | Those sides get no zone |
| 4 px either side of a tiled edge with no shadow | differs | 4 px outside the window only (below) |
| The tiles beside the edge follow the drag | yes | `interactiveMoveResizeStepped` |
| Which windows cast a shadow, and how far | yes | `shadows` and `shadowSize`, through `make setup` |
| A border, in the palette's surface-3 | yes | `borderWidth`; dark or light by Plasma's colors |
| Rounded corners | yes | `roundedCorners`: 6 px, as on Hyprland |
| No title bar | no | The decoration draws one, as Plasma's did (TODO.md) |
| A change on tide's Borders page applies at once | no | `make setup` copies the settings (below) |

**How KWin makes it a zone.** Read in KWin 6.7.5 and KDecoration 6.7.5,
and run in a headless KWin (§6):

- A decorated window takes the pointer over its borders and its
  *resize-only borders*, a margin outside the frame
  (`Window::updateDecorationInputShape`, `Window::hitTest`). The shadow is
  drawn apart and takes no input. So the decoration sets the margin to the
  shadow's reach (`Decoration::setResizeOnlyBorders`).
- KDecoration says which side or corner the pointer is by
  (`Decoration::Private::updateSectionUnderMouse`). KWin shows its resize
  cursor there and starts its own resize on a press
  (`Window::processDecorationMove`, `processDecorationButtonPress`).
- The press activates and raises the window, and never reaches the window
  under the zone. The pointer over the zone is over the zone's window, so
  the focus doesn't move to the one below.
- The topmost window under the pointer takes it
  (`InputRedirection::findToplevel`). KWin raises a window as it's
  activated (`Workspace::activateWindow`), so the focused tile's zone lies
  over its neighbor.

**The shadow** is tide's on every compositor: black at 0x44 by the
window's edge, fading as the square of the distance, gone at `shadowSize`
(tide §6.2). The decoration draws it once for each size and hands it to
KWin (`Decoration::setShadow`), which stretches its sides.

**Tiles.** KWin has no idea of a tile, so the script tells the decoration
which sides of each a drag moves (`layout.dragEdges`): those on the edge
between the masters and the stack, either side of three columns' centered
master, and a lone window's when it's narrower than the monitor.

- **The channel** is D-Bus. A script can call it (`callDBus`), and the
  decoration, being inside KWin, serves `/org/tide/Decoration` on KWin's
  own name: `setEdges(window, edges)`, with the window's `internalId` and
  the sides as `Qt::Edges`, or -1 for a window that's no tile.
  `describe(window)` answers what the decoration has, for the tests.
- **The decoration knows its window** by its parent: KWin makes a
  decoration with the window as its `QObject` parent
  (`DecorationBridge::createDecoration`), whose `internalId` property is
  the script's. That isn't KDecoration's API. If KWin stops doing it, every
  window gets a floating window's zone.
- **A window the script hasn't spoken of floats.** So without the script,
  every window has the zone all around.
- **The two start in either order.** The decoration hears nothing said
  before it started, and `callDBus` tells a script nothing of a call
  that failed. So as the decoration starts, it has the script say every
  tile's sides again, by pressing its `tide-announce` shortcut through
  KGlobalAccel, as the layout widget does (§4.7). That covers a
  decoration chosen while tide is tiling, and one KWin loads again. As
  the script starts, it has the decoration forget what a script before it
  said (`reset`), and then says its own. KWin makes a window's decoration
  again as settings change; the sides are kept apart from it.
- **As the script stops, every window floats again.** KWin tells a script
  nothing as it stops; it deletes it (`Scripting::unloadScript`,
  `AbstractScript::stop`). So the decoration watches KWin's scripts, the
  children of the object at `/Scripting`, and as one goes asks KWin
  whether tide's is still loaded (`Scripting::isScriptLoaded`). That is
  KWin's own layout, not an API.
- **A side drags whole.** KDecoration would take a corner near a side's
  end. The decoration hands it the pointer at the side's middle instead
  (`sectionPoint` in `zones.h`).
- **The rest follow the drag.** KWin resizes the one tile. At each step
  (`interactiveMoveResizeStepped`) the script sets the main share from
  where KWin has that tile going and lays out the others, leaving the
  dragged one to KWin until the button comes up. An edge dragged back to
  where it began gives the part the share it had.
- **Escape cancels the drag,** and the tiles go back. KWin says only that
  a resize finished, cancelled or not, and a script can't read where KWin
  has a window going. But each step asks the window for a geometry
  (`frameGeometryAboutToChange`) and then says it stepped, and a cancel
  asks it back to where it began and says it finished, with no step
  (`Window::finishInteractiveMoveResize`). So an asking after the last
  step is a cancel. An X11 window's resize goes another way
  (`X11Window::doInteractiveResizeSync`), so its cancel ends as letting go
  does *(unverified)*.

**What differs from tide's standard, and why:**

- **A tile's zone is outside the window only.** KWin's input region for a
  decoration is its borders and what's outside them; inside the frame the
  app takes the pointer. So with no shadow the zone is 4 px on the
  neighbor's side of the edge, not 4 px either side.
- **An unfocused tile's zone works only where nothing is above it.** Each
  window has its own zone, and a neighbor higher in the stack covers it
  with its surface. The focused tile is raised as it's activated, so its
  zone is whole. With a focus policy that doesn't raise, such as focus
  follows mouse, it may not be *(unverified)*.
- **A window that draws its own decoration has no zone or shadow of
  tide's.** KWin decorates only a window that asks for a server-side
  decoration. A GTK app with its own header bar keeps its own shadow and
  resize zone.
- **The title bar stays** (TODO.md). tide's windows have none elsewhere.
- **Settings come through `make setup`,** which copies `shadows`,
  `shadowSize`, `borderWidth` and `roundedCorners` from tide's
  `appearance.json` and `appearance.local.json` (tide §16) into `kwinrc`'s
  `[tide-decoration]`. The decoration reads them as KWin starts and each
  time it reconfigures (`DecorationSettings::reconfigured`). A change on
  tide's Borders page reaches KWin at the next `make setup`.
- **The border is dark or light by Plasma's colors,** the title bar's
  lightness, not by tide's schedule.

**Cost and reliability** of a compiled plugin:

- **It builds on your machine.** It needs a C++ compiler, CMake,
  extra-cmake-modules and the headers of Qt 6, KDecoration3, KCoreAddons
  and KConfig (README.md). Releases carry no binary: one built for one
  distro's Qt doesn't load in another's.
- **It runs inside KWin.** A crash in it is a crash of the compositor.
  A script can't do that.
- **ABI.** It links `libkdecorations3.so.6`, whose version Plasma 6 has
  kept. Qt checks a plugin's Qt version as it loads. One that won't load
  is logged, and KWin uses Breeze (`DecorationBridge::init`). After a
  Plasma or Qt upgrade that breaks it, `make install-decoration` builds it
  again.
- **Linux only.** KWin is.
- **Install.** `make install-decoration` puts it in the user's own Qt
  plugin directory and has Plasma's session add that to `QT_PLUGIN_PATH`
  (`~/.config/plasma-workspace/env/tide-kde.sh`, which `startplasma`
  sources: plasma-workspace's `runEnvironmentScripts`). A headless KWin
  finds the plugin through `QT_PLUGIN_PATH`. That a real session's KWin,
  which holds `CAP_SYS_NICE`, does too is *(unverified)*.
- **Unseen.** No screen shows a headless KWin, and its screenshots need
  OpenGL, which the container lacks. So the title bar, its buttons, the
  shadow and the corners have been drawn but not looked at, nor the resize
  cursor. X11 windows are untested.

### 4.9 Report a bug

`Meta+Shift+B` runs tide's bug report, `tide report-bug`, as `Super+Shift+B`
does on tide's other platforms. It copies the report to the clipboard,
opens the issue page and saves the report under
`~/.local/state/tide/reports` (tide's SPEC.md).

| Feature | Status | How |
|---|---|---|
| The key | yes | `tide-report-bug`, a shortcut like tide's others, on the key tide's other platforms use. Plasma binds no `Meta+Shift+X` (§4.5) |
| It runs tide's report | yes, through systemd | Below |
| Without tide, or with one too old | yes | A notification says what to do |
| The workspace switches and focus moves, with why | yes | In the journal, below |

**Running it.** A KWin script can't run a program: its API has D-Bus
calls and nothing else that reaches out (`scripting.cpp`). systemd's
user manager starts a unit for a D-Bus call of two strings, `StartUnit`.
So `make setup` and `make install` install a user unit,
`tide-kde-report-bug.service`, and the script it runs,
`bin/tide-kde-report-bug`, in `~/.local/share/tide-kde`. `make
uninstall` takes both out.

- **The script asks first.** `callDBus` tells a script nothing of a call
  that fails (§4.8). `LoadUnit` answers even for a unit no file has, whose
  `LoadState` is then `not-found` (systemd's `method_load_unit`,
  `manager_load_unit`). So the script asks for that, and starts the unit
  only if it's `loaded`. Otherwise a notification says to run `make
  setup`. With no systemd on the bus, nothing answers, and only KWin's
  log says so.
- **tide's report runs in a scope of its own** (`systemd-run --user
  --scope`). systemd stops what a service leaves running as it ends, and
  the report leaves the clipboard's owner, and maybe a browser.
- **A tide too old** answers `tide report-bug` with its usage, exiting 2.
  The usage doesn't name `report-bug`, which tells it from a newer one.
  The notification says to update tide; with no tide, to install it.
- **Tested** with stubs (`bin/tide-kde-report-bug_test.sh`), and in a
  headless KWin with a stand-in for systemd (`tests/kwin/fake_systemd.py`).
  Never with a real systemd, nor with tide's own report.

**The log.** tide's report takes the last 30 seconds of the journal
and filters it itself. tide-kde keeps nothing: it only logs. Every line
the script logs starts `tide-kde: `, after KWin's `js: `. Each workspace
switch and focus move is one line:

- `tide-kde: workspace FROM -> TO (WHY)`
- `tide-kde: focus APP on WORKSPACE (WHY)`, or `tide-kde: focus nothing
  (not tide)`

WHY is `key NAME` for a key; tide's rule and the key, as in `the window
under the pointer after a minimize, key tide-minimize`; or `not tide`, for
one KWin, Plasma or an app made: a click, a new window, Plasma's task
switcher. APP is the window's class, not its title.

- **Which are tide's.** KWin says a desktop or window changed within the
  script's own setting of it, so the script knows its own. Tested in a
  headless KWin: a key's switch and focus move log no `not tide` line.
- **Info level.** `print` logs at debug level, which logging rules can
  hide, as a `qtlogging.ini` with `*.debug=false` does. `console.info`
  logs at info level, which they leave. Tested in a headless KWin with
  `QT_LOGGING_RULES=*.debug=false`.
- **Where it goes.** Plasma's KWin runs as `plasma-kwin_wayland.service`,
  so its log is the user journal *(unverified)*.
- **Cost and privacy.** A line in the journal for each switch and focus
  move, with app classes and workspace names. Nothing leaves the machine:
  the report is on the clipboard, and you send it.

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
  headless KWin can't be made to do, such as a drag that moves a window.
  It picks the next window as `activateNextWindow` does, and can hold
  geometry until the app resizes, as KWin does.
- **The decoration's rules** are `decoration/zones.h`, free of Qt: which
  windows cast a shadow, each one's zone, the shadow's fade, and where the
  pointer counts as being. `make test-zones` runs them with only a C++
  compiler.
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
  - The pointer is the tests' own, `tests/kwin/pointer.c`, over KWin's
    fake input protocol (`org_kde_kwin_fake_input`), which KWin gives any
    client with `KWIN_WAYLAND_NO_PERMISSION_CHECKS=1`. It moves, presses
    and drags: a window's shadow, a tile's edge.
  - The decoration is built and loaded through `QT_PLUGIN_PATH`. The tests
    read its zones over D-Bus, drag them with the pointer, and install it
    as `make install-decoration` and `make setup` do.
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
- KWin's `src/window.cpp`, `src/input.cpp`, `src/activation.cpp`,
  `src/decorations/decorationbridge.cpp` and `src/wayland_server.cpp`, and
  KDecoration 6.7.5's `src/decoration.cpp`: the decoration's input region,
  sides and corners, fallback and fake input (§4.8, §6).
- Ubuntu devel's `kwin-wayland` and `libkwin6` packages: `strings` over
  `libkwin.so.6` and `kwin_diminactive_config.so`, and `kwin_wayland
  --help`.
- A headless `kwin_wayland --virtual`: `make test-kwin` (§6), and the
  lock screen's shell package (§4.7).
- kglobalacceld's `src/globalshortcutsregistry.cpp` and
  `src/globalshortcut.cpp`: two shortcuts on one key (§4.5).
- kscreenlocker's `UnlockApp::setShell` (§4.7).
- systemd v258's `src/core/dbus-manager.c` and `manager.c`: `LoadUnit`
  for a unit with no file (§4.9).
- The source of KWin, plasma-workspace, plasma-desktop,
  kdeplasma-addons, powerdevil, kscreen, kglobalacceld, plasma-pa,
  plasma-nm, bluedevil and xdg-desktop-portal-kde at 6.7.5, and
  Spectacle's, Konsole's and Dolphin's: the keys under `Meta+Alt` (§4.9).
- plasma-workspace's and plasma-desktop's source: the keys Plasma binds
  (§4.5), and `startkde/startplasma.cpp`'s environment scripts (§4.8).
- tide for Linux's `SPEC.md`: §3.1, §5.5, §6 (§6.1 to §6.7), §6.6's drag to resize, §8 and
  §8.5, §9, §10, §11, §13, §14 and §14.1, §15, §16.
