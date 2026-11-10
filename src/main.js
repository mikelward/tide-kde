// The script KWin runs: tide, given what KWin's script engine provides.
import { Tide } from "./tide.js";

// eslint-disable-next-line no-undef
new Tide({ workspace, KWin, registerShortcut, readConfig, callDBus, print }).start();
