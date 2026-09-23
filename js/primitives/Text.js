// Text rendering. A Drawable but not a Shape: no fill/stroke geometry
// to share with Rect/Circle/etc.
//
// font is the full CSS font shorthand string, same as ctx.font. color
// is the text fill, distinct from Shape.fill on purpose.
//
// Positioning: x/y is the anchor point. align/baseline decide where
// the text sits relative to that anchor. Defaults are left/top so
// behavior matches a Rect (top-left origin).
//
// Text does not wrap, measure, or shrink-to-fit.

import { Drawable } from "./Drawable.js";

export class Text extends Drawable {
  constructor(opts = {}) {
    super(opts);

    this.text     = opts.text     ?? "";
    this.font     = opts.font     ?? "16px sans-serif";
    this.color    = opts.color    ?? "#ffffff";
    this.align    = opts.align    ?? "left";
    this.baseline = opts.baseline ?? "top";
  }

  draw(ctx, px, py, pw, ph) {
    ctx.font         = this.font;
    ctx.fillStyle    = this.color;
    ctx.textAlign    = this.align;
    ctx.textBaseline = this.baseline;
    ctx.fillText(this.text, px, py);
  }
}