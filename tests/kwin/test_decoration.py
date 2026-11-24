"""tide's decoration in a real KWin (harness.py): a window's shadow is where
a drag resizes it, floating or tiled (SPEC.md §4.8). The pointer is the
tests' own (pointer.c)."""

import os
import subprocess
import unittest

from harness import ROOT, KWinTest

# Qt::WindowFrameSection, which KDecoration picks from where the pointer is
NONE, LEFT, TOP_LEFT, RIGHT, BOTTOM_RIGHT = 0, 1, 2, 5, 6


class Decorated(KWinTest):
    DECORATION = True

    def frame(self, app):
        return self.box(self.state(), app)

    def bar(self, app):
        """The title bar's height"""
        return self.decoration(app)["borders"][1]


class FloatingTest(Decorated):
    """Without tide's script, every window floats"""

    LOAD = None

    def test_the_zone_is_the_shadow_all_around(self):
        self.open("one")
        d = self.decoration("one")
        self.assertEqual(d["zone"], [16, 16, 16, 16])
        self.assertEqual(d["shadow"], 16)
        self.assertEqual(d["radius"], 6)
        self.assertEqual(d["edges"], -1)
        # A title bar, and no border
        self.assertEqual(d["borders"][0::2] + d["borders"][3:], [0, 0, 0])
        self.assertGreater(d["borders"][1], 0)

    def test_with_light_colors_the_shadow_is_black(self):
        self.open("one")
        self.assertEqual(self.decoration("one")["shadowColor"], "00000044")

    def test_dragging_the_shadow_moves_that_side(self):
        self.open("one")
        x, y, w, h = self.frame("one")
        self.pointer("move", x - 10, y + 100, "press", "move", x - 110, y + 100)
        self.settled({"one": (x - 100, y, w + 100, h)})
        self.pointer("release")
        self.assertEqual(self.frame("one"), (x - 100, y, w + 100, h))

    def test_dragging_the_shadows_corner_moves_both_sides(self):
        self.open("one")
        x, y, w, h = self.frame("one")
        self.pointer("move", x + w + 10, y + h + 10)
        self.assertEqual(self.decoration("one")["section"], BOTTOM_RIGHT)
        self.pointer("press", "move", x + w + 60, y + h + 40)
        self.settled({"one": (x, y, w + 50, h + 30)})
        self.pointer("release")

    def test_past_the_shadow_nothing_drags(self):
        self.open("one")
        x, y, w, h = self.frame("one")
        mark = self.log.mark()
        self.pointer("move", x - 20, y + 100)
        self.assertEqual(self.decoration("one")["section"], NONE)
        self.pointer("press", "move", x - 120, y + 100, "release")
        self.assertEqual(self.frame("one"), (x, y, w, h))
        self.assertEqual(self.drags(mark), [])

    def test_a_press_inside_the_window_drags_nothing(self):
        self.open("one")
        x, y, w, h = self.frame("one")
        mark = self.log.mark()
        self.pointer("move", x + 5, y + 100, "press", "move", x - 95, y + 100, "release")
        self.assertEqual(self.frame("one"), (x, y, w, h))
        self.assertEqual(self.drags(mark), [])

    def test_a_window_that_casts_no_shadow_has_the_same_zone(self):
        self.open("one")
        self.open("two")
        s = self.state()
        self.assertTrue(s["windows"]["two"]["active"])
        d = self.decoration("one")
        self.assertEqual((d["shadow"], d["zone"]), (0, [16, 16, 16, 16]))
        self.assertEqual(self.decoration("two")["shadow"], 16)

    def test_a_press_on_an_unfocused_windows_shadow_focuses_and_resizes_it(self):
        self.open("one")
        self.open("two")
        x, y, w, h = self.frame("one")
        tx, ty, tw, th = self.frame("two")
        # A spot in one's zone that two doesn't cover
        self.assertFalse(tx <= x - 10 < tx + tw and ty <= y + 10 < ty + th, "KWin put two over one's left side")
        self.pointer("move", x - 10, y + 10 + self.bar("one"), "press", "move", x - 60, y + 10 + self.bar("one"))
        s = self.settled({"one": (x - 50, y, w + 50, h)})
        self.assertTrue(s["windows"]["one"]["active"])
        self.pointer("release")
        self.assertEqual(self.decoration("one")["shadow"], 16)
        self.assertEqual(self.decoration("two")["shadow"], 0)


class DarkTest(Decorated):
    """With a dark color scheme's title bar, Breeze Dark's, set as KWin
    reads it: the Header colors where a scheme has them, else [WM]'s."""

    LOAD = None
    KDEGLOBALS = {
        "Colors:Header": {"BackgroundNormal": "41,44,48", "ForegroundNormal": "252,252,252"},
        "WM": {"activeBackground": "41,44,48", "inactiveBackground": "32,35,38"},
    }

    def test_with_dark_colors_the_shadow_is_a_light_glow(self):
        self.open("one")
        d = self.decoration("one")
        self.assertEqual((d["shadow"], d["shadowColor"]), (16, "ededf155"))


class SettingsTest(Decorated):
    LOAD = None
    DECORATION_CONFIG = {"Shadows": "none", "BorderWidth": "2", "RoundedCorners": "false"}

    def test_with_shadows_off_the_zone_is_8_px(self):
        self.open("one")
        d = self.decoration("one")
        self.assertEqual((d["shadow"], d["zone"]), (0, [8, 8, 8, 8]))
        x, y, w, h = self.frame("one")
        self.pointer("move", x + w + 6, y + 100, "press", "move", x + w + 56, y + 100)
        self.settled({"one": (x, y, w + 50, h)})
        self.pointer("release")

    def test_a_border_and_square_corners(self):
        self.open("one")
        d = self.decoration("one")
        self.assertEqual(d["borders"][0::2] + d["borders"][3:], [2, 2, 2])
        self.assertEqual(d["radius"], 0)

    def set(self, key, value):
        r = subprocess.run(["kwriteconfig6", "--file", "kwinrc", "--group", "tide-decoration", "--key", key, value],
                           env=self.env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_a_setting_changed_takes_effect_as_kwin_reconfigures(self):
        self.open("one")
        self.set("Shadows", "all")
        self.set("ShadowSize", "24")
        self.set("BorderWidth", "0")
        self.set("TitleBar", "false")
        self.qdbus("org.kde.KWin", "/KWin", "org.kde.KWin.reconfigure")
        self.log.wait(lambda l: "settings: shadows all, 24 px; border 0 px; corners square; title bar off" in l,
                      "the decoration read its settings")
        d = self.decoration("one")
        self.assertEqual((d["shadow"], d["zone"], d["borders"]), (24, [24, 24, 24, 24], [0, 0, 0, 0]))

    def test_a_bad_setting_is_named_and_keeps_its_default(self):
        self.open("one")
        self.set("ShadowSize", "99")
        self.set("Shadows", "focused")
        self.qdbus("org.kde.KWin", "/KWin", "org.kde.KWin.reconfigure")
        self.log.wait(lambda l: "ShadowSize must be a whole number from 0 to 32" in l, "the decoration named ShadowSize")
        self.log.wait(lambda l: "settings: shadows focused, 16 px" in l, "the decoration read its settings")
        self.assertEqual(self.decoration("one")["zone"], [16, 16, 16, 16])


class TileTest(Decorated):
    """With tide's script, on a 1920x1080 monitor, which starts in tile"""

    def three(self):
        for app in ("one", "two", "three"):
            self.open(app)
        return self.settled({
            "one": (0, 0, 1056, 1080),
            "two": (1056, 0, 864, 540),
            "three": (1056, 540, 864, 540),
        })

    def zones(self):
        return {app: self.decoration(app)["zone"] for app in ("one", "two", "three")}

    def test_the_zone_is_on_the_edge_between_the_master_and_the_stack(self):
        s = self.three()
        self.assertTrue(s["windows"]["three"]["active"])
        # The focused tile's shadow, and 4 px for the rest
        self.assertEqual(self.zones(), {"one": [0, 0, 4, 0], "two": [4, 0, 0, 0], "three": [16, 0, 0, 0]})
        self.assertEqual([self.decoration(a)["shadow"] for a in ("one", "two", "three")], [0, 0, 16])
        self.key("tide-focus-down")
        self.assertEqual(self.zones(), {"one": [0, 0, 16, 0], "two": [4, 0, 0, 0], "three": [4, 0, 0, 0]})

    def test_dragging_the_focused_tiles_shadow_moves_the_edge_and_the_rest_follow(self):
        self.three()
        # In three's shadow, which lies over the master
        self.pointer("move", 1046, 800, "press", "move", 946, 800)
        self.settled({"one": (0, 0, 956, 1080), "two": (956, 0, 964, 540), "three": (956, 540, 964, 540)})
        self.pointer("move", 1146, 800)
        self.settled({"one": (0, 0, 1156, 1080), "two": (1156, 0, 764, 540), "three": (1156, 540, 764, 540)})
        self.pointer("release")
        s = self.settled({"one": (0, 0, 1156, 1080), "two": (1156, 0, 764, 540), "three": (1156, 540, 764, 540)})
        self.assertTrue(s["windows"]["three"]["active"], "the focus stayed where it was")

    def test_an_edge_dragged_away_and_back_leaves_the_tiles_as_they_were(self):
        self.three()
        self.pointer("move", 1046, 800, "press", "move", 946, 800)
        self.settled({"one": (0, 0, 956, 1080), "two": (956, 0, 964, 540), "three": (956, 540, 964, 540)})
        self.pointer("move", 1046, 800)
        self.settled({"one": (0, 0, 1056, 1080), "two": (1056, 0, 864, 540), "three": (1056, 540, 864, 540)})
        self.pointer("release")
        self.settled({"one": (0, 0, 1056, 1080), "two": (1056, 0, 864, 540), "three": (1056, 540, 864, 540)})
        self.key("tide-grow")
        self.settled({"one": (0, 0, 1104, 1080)})

    def test_escape_cancels_the_drag_and_the_tiles_go_back(self):
        self.three()
        mark = self.log.mark()
        self.pointer("move", 1046, 800, "press", "move", 946, 800)
        self.settled({"one": (0, 0, 956, 1080), "two": (956, 0, 964, 540), "three": (956, 540, 964, 540)})
        self.pointer("escape")
        self.log.wait(lambda l: "probe: drag finished three" in l, "the drag ended", since=mark)
        self.settled({"one": (0, 0, 1056, 1080), "two": (1056, 0, 864, 540), "three": (1056, 540, 864, 540)})
        self.pointer("release")
        # The share is the one it had: a step from it is a step from 55%
        self.key("tide-grow")
        self.settled({"one": (0, 0, 1104, 1080), "two": (1104, 0, 816, 540), "three": (1104, 540, 816, 540)})

    def test_dragging_the_masters_shadow_moves_the_edge(self):
        self.three()
        self.key("tide-focus-down")
        # In the master's shadow, which lies over the stack
        self.pointer("move", 1066, 300, "press", "move", 1166, 300)
        self.settled({"one": (0, 0, 1156, 1080), "two": (1156, 0, 764, 540), "three": (1156, 540, 764, 540)})
        self.pointer("release")
        self.settled({"one": (0, 0, 1156, 1080), "two": (1156, 0, 764, 540), "three": (1156, 540, 764, 540)})

    def test_a_tiles_side_drags_whole_with_no_corner(self):
        self.three()
        # By the top of three's left side, where a floating window's corner is
        self.pointer("move", 1046, 545)
        self.assertEqual(self.decoration("three")["section"], LEFT)
        self.pointer("press", "move", 946, 445)
        self.settled({"one": (0, 0, 956, 1080), "two": (956, 0, 964, 540)})
        self.pointer("release")
        self.settled({"three": (956, 540, 964, 540)})

    def test_a_stacks_rows_dont_drag(self):
        self.three()
        mark = self.log.mark()
        # Just above three, where its shadow falls on two
        self.pointer("move", 1500, 530, "press", "move", 1500, 430, "release")
        self.assertEqual(self.drags(mark), [])
        self.settled({"two": (1056, 0, 864, 540), "three": (1056, 540, 864, 540)})

    def test_monocle_has_no_zone(self):
        self.three()
        self.key("tide-monocle")
        self.settled({"three": (0, 0, 1920, 1080)})
        self.assertEqual(self.zones(), {"one": [0, 0, 0, 0], "two": [0, 0, 0, 0], "three": [0, 0, 0, 0]})

    def test_a_window_floated_gets_the_zone_all_around(self):
        self.three()
        self.key("tide-float")
        self.settled({"one": (0, 0, 1056, 1080), "two": (1056, 0, 864, 1080)})
        self.assertEqual(self.decoration("three")["zone"], [16, 16, 16, 16])
        self.assertEqual(self.decoration("two")["zone"], [4, 0, 0, 0])
        self.key("tide-float")
        self.settled({"three": (1056, 540, 864, 540)})
        self.assertEqual(self.decoration("three")["zone"], [16, 0, 0, 0])

    def test_with_the_script_stopped_every_window_floats_again(self):
        self.three()
        self.key("tide-monocle")
        self.settled({"three": (0, 0, 1920, 1080)})
        self.assertEqual(self.decoration("three")["zone"], [0, 0, 0, 0])
        self.assertEqual(self.qdbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", "tide"), "true")
        self.log.wait(lambda l: "tide's script stopped" in l, "the decoration saw the script stop")
        for app in ("one", "two", "three"):
            d = self.decoration(app)
            self.assertEqual((d["zone"], d["edges"]), ([16, 16, 16, 16], -1))
        # And it drags as one
        x, y, w, h = self.frame("three")
        self.assertEqual((x, y, w, h), (0, 0, 1920, 1080))
        self.pointer("move", 960, 5, "press", "move", 960, 105)
        self.log.wait(lambda l: "probe: drag started three" in l, "KWin began a drag")
        self.pointer("release")

    def test_another_script_stopping_leaves_the_tiles_theirs(self):
        self.three()
        other = os.path.join(self.home, "other.js")
        with open(other, "w", encoding="utf-8") as f:
            f.write('print("other: ready");\n')
        self.load(other, "other")
        self.qdbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.start")
        self.log.wait(lambda l: "other: ready" in l, "the other script started")
        # tide speaks to the decoration again, which then knows of the other
        self.key("tide-monocle")
        self.key("tide-monocle")
        self.settled({"one": (0, 0, 1056, 1080)})
        self.assertEqual(self.qdbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", "other"), "true")
        self.key("tide-grow")
        self.settled({"one": (0, 0, 1104, 1080)})
        self.assertEqual(self.zones(), {"one": [0, 0, 4, 0], "two": [4, 0, 0, 0], "three": [16, 0, 0, 0]})

    def test_a_lone_window_as_wide_as_the_monitor_has_no_zone(self):
        self.open("one")
        self.settled({"one": (0, 0, 1920, 1080)})
        d = self.decoration("one")
        self.assertEqual((d["zone"], d["shadow"], d["edges"]), ([0, 0, 0, 0], 16, 0))


class ShadowsAllTest(Decorated):
    DECORATION_CONFIG = {"Shadows": "all", "ShadowSize": "12"}

    def test_every_tile_has_its_shadows_zone(self):
        for app in ("one", "two"):
            self.open(app)
        self.settled({"one": (0, 0, 1056, 1080), "two": (1056, 0, 864, 1080)})
        self.assertEqual(self.decoration("one")["zone"], [0, 0, 12, 0])
        self.assertEqual(self.decoration("two")["zone"], [12, 0, 0, 0])
        self.assertEqual([self.decoration(a)["shadow"] for a in ("one", "two")], [12, 12])


class UltrawideTest(Decorated):
    WIDTH = 3440
    HEIGHT = 1440

    def test_a_lone_windows_shadow_drags_its_width(self):
        self.open("one")
        self.settled({"one": (344, 0, 2752, 1440)})
        self.assertEqual(self.decoration("one")["zone"], [16, 0, 16, 0])
        self.pointer("move", 3106, 700, "press", "move", 3206, 700)
        self.settled({"one": (344, 0, 2852, 1440)})
        self.pointer("release")
        # It stays centered
        self.settled({"one": (244, 0, 2952, 1440)})

    def test_escape_cancels_a_lone_windows_drag(self):
        self.open("one")
        self.settled({"one": (344, 0, 2752, 1440)})
        mark = self.log.mark()
        self.pointer("move", 3106, 700, "press", "move", 3206, 700)
        self.settled({"one": (344, 0, 2852, 1440)})
        self.pointer("escape")
        self.log.wait(lambda l: "probe: drag finished one" in l, "the drag ended", since=mark)
        self.settled({"one": (344, 0, 2752, 1440)})
        self.pointer("release")


class LaterTest(KWinTest):
    """tide's decoration chosen while tide is already tiling"""

    DECORATION_LATER = True

    def test_tiles_already_there_get_their_zones(self):
        for app in ("one", "two"):
            self.open(app)
        self.settled({"one": (0, 0, 1056, 1080), "two": (1056, 0, 864, 1080)})
        r = subprocess.run(["kwriteconfig6", "--file", "kwinrc", "--group", "org.kde.kdecoration2", "--key", "library", "org.tide.decoration"],
                           env=self.env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.qdbus("org.kde.KWin", "/KWin", "org.kde.KWin.reconfigure")
        self.log.wait(lambda l: "tide.decoration: settings:" in l, "KWin loaded tide's decoration")
        # The decoration has asked tide by now, with a shortcut pressed
        # before the probe's, so tide has said the sides again
        self.settled({"one": (0, 0, 1056, 1080), "two": (1056, 0, 864, 1080)})
        self.assertEqual(self.decoration("one")["zone"], [0, 0, 4, 0])
        self.assertEqual(self.decoration("two")["zone"], [16, 0, 0, 0])


class InstallTest(KWinTest):
    """`make install-decoration` and `make setup`, as a user runs them"""

    LOAD = None

    def test_installed_and_set_up_kwin_gives_windows_tides_decoration(self):
        self.stop()
        plugins = os.path.join(self.home, ".local", "lib", "qt6", "plugins")
        r = subprocess.run(["make", "-C", ROOT, "install-decoration", f"PLUGIN_DIR={plugins}"], env=self.env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        tide = os.path.join(self.home, ".config", "tide")
        os.makedirs(tide)
        with open(os.path.join(tide, "appearance.json"), "w", encoding="utf-8") as f:
            f.write('{"shadows": "all", "shadowSize": 24, "borderWidth": 3}')
        with open(os.path.join(tide, "appearance.local.json"), "w", encoding="utf-8") as f:
            f.write('{"shadowSize": 20}')
        r = subprocess.run(["node", os.path.join(ROOT, "scripts", "setup.mjs")], env=self.env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        # What Plasma's session takes from the script as it starts
        script = os.path.join(self.home, ".config", "plasma-workspace", "env", "tide-kde.sh")
        r = subprocess.run(["sh", "-c", '. "$1" && printf %s "$QT_PLUGIN_PATH"', "sh", script], env=self.env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, plugins)
        self.env["QT_PLUGIN_PATH"] = r.stdout
        self.start_kwin()
        self.open("one")
        d = self.decoration("one")
        self.assertEqual((d["shadow"], d["zone"]), (20, [20, 20, 20, 20]))
        self.assertEqual(d["borders"][0], 3)


if __name__ == "__main__":
    unittest.main()
