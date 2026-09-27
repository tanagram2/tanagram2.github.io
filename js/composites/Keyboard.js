// On-canvas keyboard composite.
//
// Reports keypresses to a caller-supplied onKey(char) callback. Owns
// no string, cursor, backspace, or enter state: the consumer does
// all of that. This is the shared "text entry primitive" for any app
// that wants short text input without pulling up the OS soft
// keyboard.
//
// Layout: three rows of letters (uppercase only) plus one row of
// digits. Fixed for now. QWERTY, shift, lowercase, and symbols are
// deliberate non-goals; extending is a one-file change here.
//
// Structure: a Composite full of Button children, one per key. Keys
// are hit-tested and dispatched by the existing router like any
// other Button, so no new systems are involved.
//
// Sizing: the caller supplies x, y, w. Key width is derived from w
// and the column count. Key height is keyW * 0.9. The composite's
// own h is computed from the rows; if the caller passes h anyway it
// is stored but not used for key layout.

import { Composite } from "./Composite.js";
import { Button }    from "./Button.js";

const ROWS = [
  ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
  ["K", "L", "M", "N", "O", "P", "Q", "R", "S", "T"],
  ["U", "V", "W", "X", "Y", "Z"],
  ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
];

const COLS     = 10;
const GAP      = 6;
const KEY_RATIO = 0.9;

const KEY_FILL        = "#1f2a1f";
const KEY_STROKE      = "#3f5a3f";
const KEY_STROKE_W    = 2;
const KEY_RADIUS      = 6;
const KEY_TEXT_COLOR  = "#e6efe6";
const KEY_FONT        = "bold 26px sans-serif";

export class Keyboard extends Composite {
  constructor(opts = {}) {
    super(opts);

    // The consumer's key sink. No-op fallback so Keyboard never
    // throws if the caller forgot it.
    const onKey = opts.onKey ?? (() => {});

    const w = typeof this.w === "number" ? this.w : 0;
    const keyW = (w - (COLS - 1) * GAP) / COLS;
    const keyH = keyW * KEY_RATIO;

    for (let r = 0; r < ROWS.length; r++) {
      const row = ROWS[r];
      for (let c = 0; c < row.length; c++) {
        const char = row[c];
        const btn = new Button({
          x: c * (keyW + GAP),
          y: r * (keyH + GAP),
          w: keyW,
          h: keyH,
          text: char,
          fill:        KEY_FILL,
          stroke:      KEY_STROKE,
          strokeWidth: KEY_STROKE_W,
          radius:      KEY_RADIUS,
          textOptions: { font: KEY_FONT, color: KEY_TEXT_COLOR },
          onClick:     () => onKey(char),
        });
        this.add(btn);
      }
    }

    // Composite's own h: informative for hit-testing and for callers
    // that want to position something below it. Not used for key
    // layout.
    if (typeof this.h !== "number" || this.h === 0) {
      this.h = ROWS.length * keyH + (ROWS.length - 1) * GAP;
    }
  }
}