// Circle. Box-based like every other Shape: the drawn geometry is an
// ellipse inscribed in the box. Non-square w/h draws an oval,
// deliberately, not a coerced circle.

import { Shape } from "./Shape.js";

export class Circle extends Shape {
  constructor(opts = {}) {
    super(opts);
  }

  draw(ctx, px, py, pw, ph) {
    const cx = px + pw / 2;
    const cy = py + ph / 2;
    const rx = pw / 2;
    const ry = ph / 2;

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    this.applyFillAndStroke(ctx);
  }
}