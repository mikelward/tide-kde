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
5. `Meta+Left` and `Meta+Right`: focus and move by side, across monitors,
   as tide's `direction.lua`.
6. The dim: Dim Inactive at tide's strength, off with one window
   (SPEC.md §4.2).
7. The focus guard: KWin's prevention level, and what tide §14.1 needs
   beyond it (SPEC.md §4.4).
8. The layout widget: a plasmoid with the focused monitor's layout symbol
   (SPEC.md §4.7).
9. Setup: free Plasma's keys that tide's take (README.md's Keys), set the
   dim and focus settings, and install tide-kde from scripts' `setup-kde`.
10. Releases: tag each push to main `v<commits>` and attach
    `tide.kwinscript`.
11. The lock screen's look: a tide look-and-feel package's `lockscreen/`
    with the hostname, the date and time and the wallpaper (SPEC.md §4.7).
12. The launcher's Workspaces and Windows tabs, served by the script
    (SPEC.md §4.6).
13. Take over `tide-kde.service` (SPEC.md §5), with tide in step: tide
    stops installing it, and its `tide-doctor` check moves here.

## Decisions needing review

- The name `tide-kde.service` moves from tide's launcher to tide-kde,
  which supersedes it (SPEC.md §5).
- The script's ID is `tide`, so its settings are kwinrc's `[Script-tide]`
  and it's `tideEnabled` under `[Plugins]`.
- Standing workspaces stay once made, even empty, so Plasma's Pager, the
  bar for now, always lists them. tide's Hyprland removes an empty one and
  its bar lists it anyway.
- Home is the first desktop, renamed `in` at start when no desktop has
  home's name.
- Settings live in kwinrc, as a KWin script can't read tide's
  `layouts.json`.
