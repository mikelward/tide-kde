# TODO

## Next

1. **Done:** a KWin script that loads, built from `src/` by
   `scripts/bundle.mjs`, `make install` through `kpackagetool6`, and
   `make test-kwin` in a headless `kwin_wayland` in CI (SPEC.md §6).
2. **Done:** geometry, tide for Chrome's unchanged (`make check-tideco`),
   and tiling each desktop's windows per output as they come, go, move and
   resize, with drags (SPEC.md §4.1).
3. **Done:** keys through `registerShortcut` (README.md).
4. **Done:** workspaces: home, the standing ones made on demand, made ones
   removed when left empty, and their keys (SPEC.md §4.3).
5. **Done:** `Meta+Left` and `Meta+Right`: focus and move by side, across
   monitors, as tide's `direction.lua`.
6. **Done:** the dim: Dim Inactive, off with one window (SPEC.md §4.2).
   Its strength and `DimByGroup=false` go in setup (9).
7. **Done, in part:** the focus guard is KWin's prevention at Medium, set
   by setup (9). What tide §14.1 needs beyond it, launches and terminals,
   isn't done (SPEC.md §4.4).
8. **Done:** the layout widget: a plasmoid with each monitor's layout
   symbol (SPEC.md §4.7). Setup (9) adds it to the panel.
9. **Done:** `make setup`: frees Plasma's keys that tide's take, binds
   tide's, sets the dim and focus settings, and adds the layout widget.
   Still to do: scripts' `setup-kde` installs tide-kde and runs it.
10. **Done:** releases: each push to main is `v<commits>`, with
    `tide.kwinscript` and `tide-layout.plasmoid` attached.
11. The lock screen's look (SPEC.md §4.7). **Done:** setup gives it the
    desktop's wallpaper. To do: propose kscreenlocker a setting naming the
    package its lock screen comes from, apart from the shell's; then ship
    tide's face, the hostname over the date and time, in one.
12. **In tide:** the launcher's Workspaces and Windows tabs, from KWin's
    D-Bus (mikelward/tide#445, SPEC.md §4.6).
13. **Decided:** `tide-kde.service` stays tide's (SPEC.md §5).

## Decisions needing review

- The script's ID is `tide`, so its settings are kwinrc's `[Script-tide]`
  and it's `tideEnabled` under `[Plugins]`.
- Standing workspaces stay once made, even empty, so Plasma's Pager, the
  bar for now, always lists them. tide's Hyprland removes an empty one and
  its bar lists it anyway.
- Home is the first desktop, renamed `in` at start when no desktop has
  home's name.
- Settings live in kwinrc, as a KWin script can't read tide's
  `layouts.json`.
