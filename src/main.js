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

// print logs at debug level, which logging rules can hide (`*.debug=false`
// in a qtlogging.ini); console.info logs at info level (SPEC.md §4.9).
const info = (text) => console.info(text);

// eslint-disable-next-line no-undef
new Tide({ workspace, KWin, registerShortcut, readConfig, callDBus, print, info, later }).start();
