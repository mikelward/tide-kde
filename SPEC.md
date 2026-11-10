# tide-kde: tide on KDE Plasma

**Status: exploration.** This explores what KWin allows. It doesn't yet
decide what tide-kde is. It takes what tide for Linux does under Hyprland
([mikelward/tide](https://github.com/mikelward/tide)), and what tidewm and
tidesway carry of it in their compositors
([mikelward/tidewm](https://github.com/mikelward/tidewm),
[mikelward/tidesway](https://github.com/mikelward/tidesway)), and says, for
each one, how Plasma can do it, how well, and at what cost.

Claims about KWin carry a source: KWin 6.7.5 as Ubuntu packages it, read
with `strings` over `libkwin.so` and its plugins, or KWin's source. The rest
are marked *(unverified)*. References like "tide §6.1" are to tide's
`SPEC.md`.

## 1. Goals

- **tide's window management on Plasma:** its layouts, the single-window
  rule, the dim, named workspaces that span every monitor, the focus guard
  and its keys (tide §6, §14).
- **tide's launcher with every tab.** tide's Plasma launcher (tide §8.5)
  has only Apps and Actions, since only a compositor knows the workspaces
  and windows. tide-kde's KWin script does, so it can serve them.
- **Plasma stays Plasma.** Its panel, notifications, lock, login and
  settings stay its own. tide-kde adds to them; it replaces none, except
  where tide §5.5 already does (the launcher on `Meta+Space`).
- **Off is Plasma as it was.** Disabling the script, or stopping
  `tide-kde.service`, leaves stock Plasma, with nothing left to undo.
- **Say what can't be done,** as tidemo does for macOS (§4).

## 2. What KWin allows

KWin 6 runs scripts in JavaScript or QML, packaged with a
`metadata.json` and installed with `kpackagetool6 --type KWin/Script`
*(unverified: the type's name)*. A script sees and moves every window. It
can't draw outside QML, can't veto a close, and can't take a key an app
asks for.

What KWin 6.7.5's script API has, by the names in `libkwin.so`:

| Area | Names |
|---|---|
| Windows | `workspace.windowList`, `stackingOrder`, `activeWindow`; a window's `frameGeometry`, `minimized`, `keepAbove`, `closeWindow` |
| Window signals | `windowAdded`, `windowRemoved`, `windowActivated`; a window's `interactiveMoveResizeStarted`, `interactiveMoveResizeFinished`, `tileChanged`, `maximizedAboutToChange` |
| Desktops | `currentDesktop`, `createDesktop`, `removeDesktop`; `desktopsChanged`, `currentDesktopChanged` |
| Screens | `clientArea`, `screenAt`, `outputAt`, `sendToOutput`; `screensChanged` |
| Keys | `registerShortcut`, a global shortcut under KGlobalAccel |
| Elsewhere | `callDBus`, to reach tide-kde's launcher or anything else on the session bus |

And in KWin's own settings and effects:

- **Dim Inactive** is a stock effect (`kwin_diminactive_config.so`).
- **Focus stealing prevention** is a setting,
  `focusStealingPreventionLevel`, from None to Extreme.
- **X11 scaling**: `XwaylandClientsScale`, as Hyprland's
  `xwayland:force_zero_scaling` and tidesway's `xwayland_scaling`.
- **`closeRequested`** exists. Whether a script can stop a close with it
  is *(unverified)*, and likely not.

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

### 4.1 Layouts (tide §6.1, §6.3)

| Feature | Status | How |
|---|---|---|
| Tile: master left at 55% | yes | The script sets each window's `frameGeometry` within `clientArea` |
| Three columns at aspect ≥ 2.1, master centered at 50% | yes | Script geometry |
| Two columns plus a stack; monocle | yes | Script geometry |
| `mfact`, `nmaster` keys | yes | `registerShortcut` |
| Single window at 80% on a wide monitor (60% at 32:9) | yes | Script geometry, per output |
| Drag to swap; edge drag to set the split | partial | `interactiveMoveResizeFinished` tells where a drag ended; the script re-lays out from there. Mid-drag feedback is KWin's *(unverified)* |
| Maximize and fullscreen | yes | KWin's own; the script leaves them be |

### 4.2 The dim (tide §6.2)

| Feature | Status | How |
|---|---|---|
| Dim inactive windows | yes | Dim Inactive, at tide's strength. tide §6.2 found KDE's dim looks weaker than Hyprland's at the same number |
| No dim with one window | partial | Dim Inactive has no such rule *(unverified)*; the script may toggle the effect over D-Bus as windows come and go |
| `nodim` for video and calls | partial | The same, or a window rule if Dim Inactive honors one *(unverified)* |

### 4.3 Workspaces and monitors (tide §6.5, §6.7)

| Feature | Status | How |
|---|---|---|
| Workspaces spanning every monitor | yes | KWin's virtual desktops |
| Named, made and removed on demand | yes | `createDesktop`, `removeDesktop`, and the desktop's name |
| `in`, `re`, `oc`, `me` standing | yes | Made at start if missing |
| A monitor's part, `@` | differs | KWin has no per-monitor desktop. Each monitor's windows are laid out on their own already |
| Minimize and restore (`Super+Z`) | yes | A window's `minimized` |
| Move a window to a monitor | yes | `sendToOutput` |

### 4.4 Focus and attention (tide §14)

| Feature | Status | How |
|---|---|---|
| New windows from other apps don't take focus | partial | KWin's focus stealing prevention at Medium or High covers most of tide §14.1. tide's rules for launches, terminals and polkit aren't KWin's |
| Mark such a window urgent | yes | KWin does it with the prevention on *(unverified)* |
| A launch from tide's launcher takes focus | partial | KWin trusts an activation token *(unverified)*; the launcher passes one if Quickshell does |

### 4.5 Keys (tide §6.6)

| Feature | Status | How |
|---|---|---|
| tide's window and workspace keys | yes | `registerShortcut`, under `Meta` |
| A key Plasma already has | differs | KGlobalAccel won't take a bound key; `setup` frees Plasma's first, as `setup-kde` does for `Meta+Space` |
| `keep_open`: an app's close key doesn't close it | no | A script can't take an app's own keys, or veto a close (§2) |

### 4.6 Launcher (tide §8)

| Feature | Status | How |
|---|---|---|
| Apps and Actions | yes | tide's Plasma launcher, as today |
| Workspaces and Windows | yes | The script answers the launcher over D-Bus: `callDBus` out, a D-Bus service of the script's own in *(unverified: a script owning a name)*, or a QML script's |
| Attention | partial | Urgent windows from the script; Plasma's notifications stay its own |

### 4.7 The rest

The bar, notifications, idle, lock, login, screenshots and the theme stay
Plasma's. Their tide versions (tide §7, §9 to §13, §15) need a session
Plasma doesn't share.

## 5. `tide-kde.service`

tide-kde supersedes tide's Plasma launcher, and takes over its unit's name.

- **Today,** tide's `tide-kde.service` runs `shell/kde.qml`, the launcher
  alone (tide §8.5). `setup` enables it, `tide-doctor` checks it, and
  scripts' `setup-kde` binds `Meta+Space` to it.
- **After,** tide-kde ships `tide-kde.service`: the launcher with every
  tab (§4.6), `PartOf=plasma-workspace.target` as now. The KWin script is
  enabled in `kwinrc`, not by the unit.
- **The handover.** The unit keeps its name, so a user who enabled it
  keeps it enabled. tide's `make install` stops installing it, and
  `tide-doctor`'s Plasma check moves here, in the same release as
  tide-kde's first install. Until then, tide's stays.
- **The launcher's code** is tide's: tide-kde runs tide's installed
  Quickshell config rather than copying it. Open question 1.

## 6. Testing

- **Geometry** is pure JavaScript, free of KWin's API, as tide's Lua is
  free of Hyprland's. `node --test` runs it here, against tide's layout
  numbers.
- **Against KWin.** `kwin_wayland --virtual` renders to a virtual
  framebuffer, so a headless KWin can load the script and open test
  windows *(unverified: whether it runs in CI's container)*. Ubuntu's
  devel release packages KWin 6.7.5; Debian testing has no
  `kwin-wayland` package now.
- **The launcher's** tests stay in tide.

## 7. Open questions

1. **The launcher's home.** Run tide's installed config (no copy, but
   tide-kde needs tide installed), or carry a copy checked against tide's,
   as tidemo's `make check-tide` does?
2. **JavaScript or QML.** A QML script can draw, and may own a D-Bus name
   more easily, for the launcher's Workspaces and Windows tabs. A
   JavaScript one is simpler to test.
3. **Krohnkite's code.** Its layouts are MIT-licensed *(unverified)*.
   Borrow its KWin glue, or write ours from tide's numbers?
4. **The focus guard.** Is KWin's prevention at Medium close enough to
   tide §14.1, or does the script need its own rules on `windowAdded`?
5. **`keep_open`.** Without it, `Ctrl+Q` closes a browser on Plasma. Say
   so, or ask KWin upstream for a veto?

## Sources

- KWin 6.7.5, Ubuntu devel's `kwin-wayland` and `libkwin6` packages:
  `strings` over `libkwin.so.6` and `kwin_diminactive_config.so`, and
  `kwin_wayland --help`.
- tide's `SPEC.md`: §3.1, §5.5, §6, §8.5, §14.
