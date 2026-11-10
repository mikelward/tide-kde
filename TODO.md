# TODO

## Next

In the order SPEC.md's feature map suggests:

1. Answer SPEC.md §7's open questions, the launcher's home first.
2. A KWin script that loads: `metadata.json`, `contents/code/main.js`,
   `make install` through `kpackagetool6`, and a headless `kwin_wayland`
   check that it loads (SPEC.md §6).
3. Geometry: tide's tile, three-column, two-column and monocle layouts and
   the single-window rule, as pure functions under `node --test`
   (SPEC.md §4.1).
4. Tiling: lay out each desktop's windows per output as they come, go,
   move and resize.
5. Keys: tide's window and workspace keys through `registerShortcut`, and
   what Plasma must free first (SPEC.md §4.5).
6. Workspaces: tide's named desktops and its standing ones (SPEC.md §4.3).
7. The dim: Dim Inactive at tide's strength, off with one window
   (SPEC.md §4.2).
8. The focus guard: KWin's prevention level, and what tide §14.1 needs
   beyond it (SPEC.md §4.4).
9. The launcher's Workspaces and Windows tabs, served by the script
   (SPEC.md §4.6).
10. Take over `tide-kde.service` (SPEC.md §5), with tide in step: tide
    stops installing it, and its `tide-doctor` check moves here. scripts'
    `setup-kde` and `setup` install tide-kde.

## Decisions needing review

- The name `tide-kde.service` moves from tide's launcher to tide-kde,
  which supersedes it (SPEC.md §5).
