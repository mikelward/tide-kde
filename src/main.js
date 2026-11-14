// The script KWin runs: tide, given what KWin's script engine provides.
import { Tide } from "./tide.js";

// Runs `f` once KWin is done with what it's doing. The timers are held
// until they fire, so they aren't collected first.
const timers = new Set();
function later(f) {
  // eslint-disable-next-line no-undef
  const t = new QTimer();
  t.singleShot = true;
  t.interval = 0;
  t.timeout.connect(() => {
    timers.delete(t);
    f();
  });
  timers.add(t);
  t.start();
}

// eslint-disable-next-line no-undef
new Tide({ workspace, KWin, registerShortcut, readConfig, callDBus, print, later }).start();
