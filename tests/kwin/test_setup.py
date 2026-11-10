"""scripts/setup.mjs over a real KWin's own shortcuts: after it, and a new
session, tide's keys are bound where Plasma's were."""

import os
import re
import subprocess
import unittest

from harness import ROOT, KWinTest

# Qt's key codes, as KGlobalAccel gives them over D-Bus
ALT, META, SHIFT = 0x08000000, 0x10000000, 0x02000000
TAB, LEFT, PAGE_UP = 0x01000001, 0x01000012, 0x01000016


class SetupTest(KWinTest):
    LOAD = "install"

    def keys(self):
        """Each KWin shortcut's active keys, by name"""
        out = self.qdbus("--literal", "org.kde.kglobalaccel", "/component/kwin",
                         "org.kde.kglobalaccel.Component.allShortcutInfos")
        found = {}
        for m in re.finditer(r'\(ssssssaiai\) "([^"]*)", .*?\[Argument: ai \{([^}]*)\}\], \[Argument: ai \{([^}]*)\}\]\]', out):
            found[m.group(1)] = [int(k) for k in m.group(2).split(", ") if k.strip() not in ("", "0")]
        return found

    def test_tide_takes_plasmas_keys_at_the_next_session(self):
        # KGlobalAccel gives both the key, and a press reaches one of them
        before = self.keys()
        self.assertIn(ALT | TAB, before["Walk Through Windows"])
        self.assertIn(ALT | TAB, before["tide-zoom"])
        self.stop()
        r = subprocess.run(["node", os.path.join(ROOT, "scripts", "setup.mjs")], env=self.env,
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.start_kwin()
        after = self.keys()
        self.assertEqual(after["tide-zoom"], [ALT | TAB])
        self.assertEqual(after["tide-focus-left"], [META | LEFT])
        self.assertEqual(after["tide-previous-workspace"], [META | PAGE_UP])
        self.assertNotIn(ALT | TAB, after["Walk Through Windows"])
        self.assertIn(ALT | SHIFT | TAB, after["Walk Through Windows (Reverse)"], "what tide doesn't take stays")
        # And the dim's settings are in
        self.assertEqual(self.qdbus("org.kde.KWin", "/Effects", "org.kde.kwin.Effects.isEffectSupported", "diminactive"), "true")


if __name__ == "__main__":
    unittest.main()
