# TODO

## Next

1. **Done:** a KWin script that loads, built from `src/` by
   `scripts/bundle.mjs`, `make install` through `kpackagetool6`, and
   `make test-kwin` in a headless `kwin_wayland` in CI (SPEC.md §6).
2. **Done:** geometry, tide for Chrome's unchanged (`make check-tideco`),
   and tiling each desktop's windows per output as they come, go, move and
   resize, with drags (SPEC.md §4.1).
3. **Done:** keys through `registerShortcut` (README.md).
4. **Done:** workspaces: every standing one made at start, made ones
   removed when left empty, and their keys (SPEC.md §4.3).
5. **Done:** `Meta` and the arrows: focus and move that way, across
   monitors, as tide's `direction.lua`.
6. **Done:** dimming inactive windows: Dim Inactive, off with one window
   (SPEC.md §4.2). Its strength and `DimByGroup=false` go in setup (9).
7. **Done, in part:** the focus guard is KWin's prevention at Medium, set
   by setup (9). What tide §14.1 needs beyond it, launches and terminals,
   isn't done (SPEC.md §4.4).
8. **Done:** the layout widget: a plasmoid with each monitor's layout
   symbol (SPEC.md §4.7). Setup (9) adds it to the panel.
9. **Done:** `make setup`: frees Plasma's keys that tide's take, binds
   tide's, sets dimming and focus settings, and adds the layout widget.
   scripts' `setup-kde` installs tide-kde and runs it.
10. **Done:** releases: each push to main is `v<commits>`, with
    `tide.kwinscript` and `tide-layout.plasmoid` attached.
11. The lock screen's look (SPEC.md §4.7). **Done:** setup gives it the
    desktop's wallpaper. To do: propose kscreenlocker a setting naming the
    package its lock screen comes from, apart from the shell's; then ship
    tide's face, the hostname over the date and time, in one.
12. **Done, in tide for Linux:** the launcher's Workspaces and Windows
    tabs, from KWin's D-Bus (mikelward/tide#445, SPEC.md §4.6).
    **Done:** its Attention tab: the script publishes the windows KWin
    marks as wanting attention, which tide's launcher reads (SPEC.md §4.6).
13. **Decided:** `tide-kde.service` stays tide's (SPEC.md §5).
14. An undo for `make setup`: give Plasma back the keys it took, and put
    back the dimming, focus stealing prevention, panel widget, lock
    screen wallpaper and window decoration settings it changed (SPEC.md §1).
15. **Done:** tide's window decoration (`decoration/`, SPEC.md §4.8): a
    window's shadow is its drag-to-resize zone, floating or tiled, with
    tide's shadow, border and corners, and the other tiles following a
    dragged edge. To do:
    - Look at it on a real Plasma session: the title bar, the buttons, the
      shadow, the corners and the resize cursor have only been drawn in a
      headless KWin, never seen. Check there too that KWin finds the
      plugin through `QT_PLUGIN_PATH`.
    - Have tide's shell write `[tide-decoration]` and reconfigure KWin as
      the Borders page changes, as it writes Hyprland's and tidewm's
      files (mikelward/tide), so a change applies at once.
    - Have scripts' `setup-kde` run `make install-decoration`
      (mikelward/scripts).
    - Raise the focused tile under a focus policy that doesn't, so its
      zone isn't under its neighbor.
    - Resize within a stack by dragging, with tide (tide's TODO.md).

## Decisions needing review

- **Should tide's windows lose their title bar on Plasma?** (2026-11-15)
  They have none on Hyprland, tidewm or tidesway. tide's decoration draws
  one, with Plasma's buttons, as nothing said to take it off; its
  `TitleBar=false` does. Without one, a window closes, maximizes and moves
  by tide's keys only.
- tide's decoration (2026-11-15) draws its own plain title bar, not
  Breeze's: a decoration is one plugin, so tide's shadow and zone can't be
  added to Breeze's. Its buttons are close, maximize, minimize, the menu
  and on all desktops; any other in Plasma's button settings is left out.
- A tile's zone with no shadow is 4 px outside the window, not tide's
  4 px either side of the edge: KWin gives a decoration no input inside
  the frame (SPEC.md §4.8).
- The decoration installs for the user alone, with no root, and reaches
  KWin through `QT_PLUGIN_PATH`, set by a script in
  `~/.config/plasma-workspace/env`. `make install` doesn't build it, as it
  needs a compiler and headers: `make install-decoration` does.
- `make setup` copies tide's Borders settings into `kwinrc` once. Until
  tide's shell does it (item 15), a change needs `make setup` again.
- A border is dark or light by Plasma's color scheme, not tide's schedule.
- Dragging a tile's edge now moves the tiles beside it as you drag, not
  only as you let go, as on tide's other compositors.

- Minimizing the window you're in (2026-11-15) focuses the window under
  the pointer once the script has re-tiled, else the one you were in
  before on that output (SPEC.md §4.4). With neither, KWin's own pick
  stays. `make setup` leaves `NextFocusPrefersMouse` off, as it would
  send a minimized dialog's focus to the window under the pointer rather
  than its parent.
- Closing the window you're in (2026-11-15) focuses the window under the
  pointer on any output, as tide §14.2's `focus_on_close cursor` does,
  but not one wanting attention. With none, KWin's own pick stays, which
  is the window used last on that output.

- Going to the next window wanting attention (`tide-next-attention`,
  2026-11-15) takes the launcher's Attention windows (SPEC.md §4.6),
  newest first by when the script saw `demandsAttention` change. Windows
  already wanting attention as tide starts count in KWin's window order,
  as KWin gives a script no times.
- The script's ID is `tide`, so its settings are kwinrc's `[Script-tide]`
  and it's `tideEnabled` under `[Plugins]`.
- Standing workspaces are made at start and stay, even empty, so Plasma's
  Pager, the bar for now, always lists them. tide for Linux makes them on
  demand and removes an empty one, and its bar lists it anyway.
- Home is the first desktop, renamed `in` at start when no desktop has
  home's name.
- Settings live in kwinrc, as a KWin script can't read tide's
  `layouts.json`.
- Maximize and fullscreen are `Meta+X` and `Meta+Shift+X`, and
  `Meta+Up` and `Meta+Down` focus up and down, with `Meta+Shift` moving,
  as tide for Linux's keys are. They were `Meta+Up`, `Meta+Shift+Up` and
  `Meta+Down` (restore), copied from tide for Chrome, where chromeOS
  forces them; KWin doesn't. Restore has no key, as in tide.
- The README's table of keys is gone: tide for Linux's SPEC.md §6.6 has
  one table for every platform, with a KDE column, so the README keeps
  how the keys are bound and the Plasma keys `make setup` frees.
