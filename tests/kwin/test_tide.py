"""tide's layouts, keys and workspaces in a real KWin (harness.py)."""

import unittest

from harness import KWinTest


class TileTest(KWinTest):
    """On a 1920x1080 monitor, which starts in tile"""

    def three(self):
        for app in ("one", "two", "three"):
            self.open(app)

    def test_windows_tile_with_the_master_left_at_55_percent(self):
        self.three()
        self.settled({
            "one": (0, 0, 1056, 1080),
            "two": (1056, 0, 864, 540),
            "three": (1056, 540, 864, 540),
        })

    def test_a_lone_window_fills_a_16_9_monitor(self):
        self.open("one")
        self.settled({"one": (0, 0, 1920, 1080)})

    def test_the_next_layout_is_three_columns(self):
        self.three()
        self.settled({"one": (0, 0, 1056, 1080)})
        self.key("tide-next-layout")
        self.settled({
            "one": (480, 0, 960, 1080),
            "two": (1440, 0, 480, 1080),
            "three": (0, 0, 480, 1080),
        })

    def test_monocle_gives_every_window_the_whole_monitor(self):
        self.three()
        self.settled({"one": (0, 0, 1056, 1080)})
        self.key("tide-monocle")
        whole = (0, 0, 1920, 1080)
        self.settled({"one": whole, "two": whole, "three": whole})
        self.key("tide-monocle")
        self.settled({"one": (0, 0, 1056, 1080)})

    def test_grow_master_takes_a_step_of_the_width(self):
        self.open("one")
        self.open("two")
        self.settled({"one": (0, 0, 1056, 1080)})
        self.key("tide-grow")
        self.settled({"one": (0, 0, 1104, 1080), "two": (1104, 0, 816, 1080)})

    def test_another_master_shares_the_left(self):
        self.three()
        self.settled({"one": (0, 0, 1056, 1080)})
        self.key("tide-add-master")
        self.settled({
            "one": (0, 0, 1056, 540),
            "two": (0, 540, 1056, 540),
            "three": (1056, 0, 864, 1080),
        })

    def test_focus_moves_down_the_stack_and_wraps(self):
        self.three()
        s = self.settled({"one": (0, 0, 1056, 1080)})
        self.assertTrue(s["windows"]["three"]["active"])
        s = self.key("tide-focus-down")
        self.assertTrue(s["windows"]["one"]["active"], s)
        s = self.key("tide-focus-up")
        self.assertTrue(s["windows"]["three"]["active"], s)

    def test_zoom_makes_the_window_the_master_and_back(self):
        self.three()
        self.settled({"one": (0, 0, 1056, 1080)})
        self.key("tide-zoom")
        self.settled({"three": (0, 0, 1056, 1080), "one": (1056, 540, 864, 540)})
        # On the master, it swaps with the master before it
        self.key("tide-zoom")
        self.settled({"one": (0, 0, 1056, 1080), "three": (1056, 540, 864, 540)})

    def test_moving_a_window_up_the_stack_swaps_it(self):
        self.three()
        self.settled({"three": (1056, 540, 864, 540)})
        self.key("tide-move-up")
        self.settled({"three": (1056, 0, 864, 540), "two": (1056, 540, 864, 540)})

    def test_a_closed_window_gives_its_tile_back(self):
        self.open("one")
        two = self.open("two")
        self.settled({"one": (0, 0, 1056, 1080)})
        two.kill()
        self.settled({"one": (0, 0, 1920, 1080)})

    def test_a_floating_window_leaves_the_layout(self):
        self.open("one")
        self.open("two")
        self.settled({"one": (0, 0, 1056, 1080)})
        self.key("tide-float")
        self.settled({"one": (0, 0, 1920, 1080)})

    def test_a_minimized_window_leaves_the_layout_and_comes_back(self):
        self.open("one")
        self.open("two")
        self.settled({"one": (0, 0, 1056, 1080)})
        s = self.key("tide-minimize")
        self.assertTrue(s["windows"]["two"]["minimized"])
        self.settled({"one": (0, 0, 1920, 1080)})


class UltrawideTest(KWinTest):
    """On a 3440x1440 monitor, past the ultrawide aspect of 2.1"""
    WIDTH = 3440
    HEIGHT = 1440

    def test_a_lone_window_is_80_percent_and_centered(self):
        self.open("one")
        self.settled({"one": (344, 0, 2752, 1440)})

    def test_it_starts_in_three_columns(self):
        for app in ("one", "two", "three"):
            self.open(app)
        self.settled({"one": (860, 0, 1720, 1440), "two": (2580, 0, 860, 1440), "three": (0, 0, 860, 1440)})


class WorkspaceTest(KWinTest):
    def test_the_first_desktop_is_home(self):
        self.assertEqual(self.state()["desktops"], ["in"])

    def test_going_to_a_standing_workspace_makes_it_in_its_place(self):
        s = self.key("tide-go-3")
        self.assertEqual((s["desktops"], s["current"]), (["in", "oc"], "oc"))
        s = self.key("tide-go-2")
        self.assertEqual((s["desktops"], s["current"]), (["in", "re", "oc"], "re"))
        s = self.key("tide-home")
        self.assertEqual(s["current"], "in")
        # Standing ones stay, empty
        self.assertEqual(s["desktops"], ["in", "re", "oc"])

    def test_sending_a_window_leaves_you_where_you_are(self):
        self.open("one")
        s = self.key("tide-send-2")
        self.assertEqual((s["current"], s["windows"]["one"]["desktops"]), ("in", ["re"]))

    def test_moving_a_window_to_the_next_workspace_follows_it(self):
        self.open("one")
        s = self.key("tide-move-next-workspace")
        self.assertEqual((s["current"], s["windows"]["one"]["desktops"]), ("re", ["re"]))

    def test_home_or_back_flips_between_home_and_the_last(self):
        self.key("tide-go-4")
        s = self.key("tide-home-or-back")
        self.assertEqual(s["current"], "in")
        s = self.key("tide-home-or-back")
        self.assertEqual(s["current"], "me")

    def test_a_made_workspace_left_empty_goes(self):
        self.qdbus("org.kde.KWin", "/VirtualDesktopManager", "org.kde.KWin.VirtualDesktopManager.createDesktop", "1", "scratch")
        s = self.key("tide-go-0")
        self.assertEqual(s["current"], "scratch")
        s = self.key("tide-home")
        self.assertEqual(s["desktops"], ["in"])

    def test_next_workspace_passes_over_empty_ones(self):
        self.key("tide-go-2")
        self.open("one")
        self.key("tide-go-4")
        s = self.key("tide-next-workspace")
        self.assertEqual(s["current"], "re")


class TwoMonitorTest(KWinTest):
    """Two 1920x1080 monitors side by side"""
    OUTPUTS = 2

    def test_moving_right_lands_on_the_next_monitor(self):
        self.open("one")
        self.open("two")
        self.settled({"one": (0, 0, 1056, 1080), "two": (1056, 0, 864, 1080)})
        s = self.key("tide-move-right")
        self.assertEqual(s["windows"]["two"]["output"], "Virtual-1", s)
        self.settled({"one": (0, 0, 1920, 1080), "two": (1920, 0, 1920, 1080)})
        s = self.key("tide-focus-left")
        self.assertTrue(s["windows"]["one"]["active"], s)


class InstallTest(KWinTest):
    """Installed as a user does: kpackagetool6, then on in kwinrc"""
    LOAD = "install"

    def test_kwin_runs_the_installed_script(self):
        self.open("one")
        self.open("two")
        self.settled({"one": (0, 0, 1056, 1080), "two": (1056, 0, 864, 1080)})


class SettingsTest(KWinTest):
    CONFIG = {"tileMfact": "2", "normalMode": "monocle"}

    def test_a_bad_setting_is_named_and_the_rest_apply(self):
        # The harness has read past tide's start, so look for it from the top
        with open(self.log.file.name, encoding="utf-8", errors="replace") as f:
            log = f.read()
        self.assertIn("setting tileMfact must be a number from 0.1 to 0.9", log)
        self.open("one")
        self.open("two")
        whole = (0, 0, 1920, 1080)
        self.settled({"one": whole, "two": whole})


if __name__ == "__main__":
    unittest.main()
