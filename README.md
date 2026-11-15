# tide-kde

tide on KDE Plasma: [tide](https://github.com/mikelward/tide)'s tiling
layouts, workspaces and keys as a KWin 6 script. Plasma's panel,
notifications, lock and settings stay its own.

[SPEC.md](SPEC.md) says what KWin allows and how each of tide's features
maps onto it; [TODO.md](TODO.md) is the plan. `Meta+Space` stays tide's
launcher on Plasma, with its Workspaces and Windows tabs, from tide
(SPEC.md §4.6, §5), and its Attention tab, the windows wanting attention,
which this script tells it.

## What it does

- **Layouts.** Each monitor's part of a desktop tiles in tide's layouts:
  tile (master left at 55%), three columns (the default at an aspect of 2.1
  or wider), two columns plus a stack, and monocle. A lone window is 80%
  wide, centered, on an ultrawide, and 60% from an aspect of 3.2.
- **Mouse.** Drag a tiled window onto another to swap them. Drag the edge
  between the master and the stack to set the split, or a lone window's
  edge to set its width.
- **Floating.** Dialogs, windows of a fixed size and windows on every
  desktop float, as do those you float with the key.
- **Dimming inactive windows.** Plasma's Dim Inactive effect dims every
  window but the active one, and tide has it on only while a monitor shows
  two windows or more. Its strength is Plasma's setting, under Desktop
  Effects.
- **The layout widget**, "tide Layout" in Add Widgets, shows the layout
  of the workspace on its panel's monitor as tide's bar does: `[]=`,
  `|M|`, `||=`, or `[n]` in monocle with n windows hidden. A click is the
  next layout.
- **Workspaces** are Plasma's virtual desktops, which span every monitor.
  The standing ones, `in`, `re`, `oc` and `me` by default, are made at
  start, in their order, and stay. The first is home, and takes the first
  desktop's name. Any other desktop goes once you leave it empty.

## Install

Each push to main is a release, v<the commit count>, with the script,
`tide.kwinscript`, and the layout widget, `tide-layout.plasmoid`. Install
the script in System Settings → Window Management → KWin Scripts →
Install from File, and turn it on there; install the widget from Add
Widgets → Get New → Install Widget From Local File. Then run
`make setup` from a checkout of the same tag (Setup, below).

Or from a checkout, with Node for the build:

    make install

That builds the script, installs it and the layout widget with
`kpackagetool6`, turns the script on in `kwinrc` and has KWin load it.
`make uninstall` takes them out again. `make dist` makes
`dist/tide.kwinscript`, for System Settings → Window Management → KWin
Scripts → Install from File, and `dist/tide-layout.plasmoid`, for Add
Widgets → Get New → Install Widget From Local File.

## Keys

tide for Linux's window and workspace keys, with `Meta` for Super. Its
[SPEC.md §6.6](https://github.com/mikelward/tide/blob/main/SPEC.md#66-keys)
lists them in one table with every platform's, and its KDE column is this
script's. None differs from tide for Linux's, but `Meta+Backspace` closes
a pinned window too (SPEC.md §4.5).

They're KWin global shortcuts, under "KWin" in System Settings →
Keyboard → Shortcuts, each starting `tide:`, where you can change them.
The layout used last and restore are there with no key, as in tide for
Linux. tide's other keys, such as the picker or lock, are Plasma's own
here, or have none.

Plasma holds some of these keys too: `Alt+Tab` and `Meta+Tab` (the task
switcher), ``Meta+` `` (its windows of one app), `Meta+1…9` (the task
manager's entries), `Meta+Left`, `Meta+Right`, `Meta+Up` and `Meta+Down`
(quick tiling), `Meta+Shift+Left` and `Meta+Shift+Right` (window to
screen), `Meta+PgUp` and `Meta+PgDown` (maximize and minimize),
`Meta+Backspace` (restore), `Meta+0`, `Meta+=` and `Meta+-` (zoom) and
`Meta+.` (emoji). `make setup` frees them, and tide's take over at the
next login.

Maximize and fullscreen were `Meta+Up` and `Meta+Shift+Up`, with restore
on `Meta+Down`. They're now tide for Linux's keys, so the arrows move
focus up and down as they do there, and restore has no key. `make setup`
moves a key still on its old default.

## Setup

    make setup

After `make install`, this sets Plasma up as tide has it:

- frees the Plasma keys above, keeping their others (`Alt+Shift+Tab`
  still walks back through windows), and binds tide's, but leaves one
  you've bound yourself;
- turns on Dim Inactive at 15%, for every inactive app window but not
  panels, the desktop, keep-above or fullscreen ones, nor a group's
  windows together;
- sets KWin's focus stealing prevention to Medium, so a new window from
  another app opens behind the one you're in;
- puts the layout widget just after the Pager, as tide's bar has it after
  the workspaces, adding it to that panel if no panel has it;
- has the panels' Pagers show the workspaces' names;
- gives the lock screen the desktop's wallpaper, as it is then.

`make uninstall` leaves these as they are, and there's no undo for them
yet (TODO.md). `node scripts/setup.mjs --dry-run` says what it would
change. Plasma reads its shortcuts as the session starts; `--batch FILE`
also adds them to FILE for scripts' `kdeshortcut.py` (mikelward/scripts),
which applies them to the running session, as its `setup-kde` does.

## Settings

In `kwinrc`, under `[Script-tide]`; `kwriteconfig6 --file kwinrc --group
Script-tide --key tileMfact 0.6` sets one, and KWin reads them as the
script starts. A bad one is a notification naming it, and keeps its
default.

| Setting | Default | What it does |
|---|---|---|
| `standing` | `in, re, oc, me` | the standing workspaces; the first is home |
| `normalMode` | `tile` | the layout a monitor starts in |
| `ultrawideMode` | `threecol` | the same, on an ultrawide |
| `ultrawideAspect` | `2.1` | where ultrawide starts |
| `tileMfact`, `threecolMfact`, `twocolMfact` | `0.55`, `0.5`, `0.72` | the master's share |
| `tileNmaster`, `threecolNmaster`, `twocolNmaster` | `1`, `1`, `2` | how many masters |
| `single` | `2.1:0.8, 3.2:0.6` | a lone window's width from each aspect up; empty to fill |
| `dim` | `true` | turn Dim Inactive on only while a monitor shows two windows or more; `false` leaves it as Plasma's settings have it |
| `newWindow` | `end` | where a new window goes: `end`, `top` of the stack, `next` to the focused one, or `master` |

## Login and lock

Log in with tide's greeter ([tide](https://github.com/mikelward/tide)'s
`make install-session`), which lists Plasma's session beside tide's. The
lock screen is Plasma's, with the desktop's wallpaper after `make setup`;
tide's face on it needs a change to Plasma (SPEC.md §4.7).

## Development

    make lint test        # Node: the layouts, workspaces and settings, and tide.js on a fake KWin
    make test-kwin        # the script in a headless KWin
    make check-tideco     # the geometry and defaults check are tide for Chrome's, unchanged
    make check-tide-defaults  # the layout defaults and standing workspaces are tide's

`make test-kwin` needs `kwin_wayland`, KWin's package structures
(Debian's and Ubuntu's `kwin-common`), `kpackagetool6`, `kreadconfig6`
and `kwriteconfig6`, `foot`, `qdbus6`, `dbus-run-session`, Python 3 and
Node; CI runs it on Ubuntu's devel release. It also runs the layout
widget in a real plasmashell when there's one (Ubuntu's
`plasma-desktop`), as CI's `plasma` job does. KWin's script engine lacks
some of what Node runs, which `scripts/bundle.mjs` refuses (SPEC.md §2).

## License

Apache 2.0; see [LICENSE](LICENSE).
