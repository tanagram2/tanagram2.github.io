// Boxed container. A Composite whose `self` is a shape (a Rect by
// default), used to group other things: a menu background, a keypad
// area, a poker table, a HUD bar.
//
// Panel does not lay out its children. Positioning is manual, same as
// everywhere else. It does not clip, pad, scroll, or arrange.
//
// A Panel with no `self` is a valid but invisible container, though a
// bare Composite does that too - in practice, pass a shape.

import { Composite } from "./Composite.js";
import { Rect }      from "../primitives/Rect.js";

export class Panel extends Composite {
  constructor(opts = {}) {
    super(opts);

    this.self = opts.self ?? new Rect({
      fill:        opts.fill        ?? "#222222",
      stroke:      opts.stroke      ?? "#444444",
      strokeWidth: opts.strokeWidth ?? 2,
      radius:      opts.radius      ?? 0,
    });
  }
}