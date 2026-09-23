// Rectangle. The workhorse primitive.

import { Shape } from "./Shape.js";

export class Rect extends Shape {
  constructor(opts = {}) {
    super(opts);
    this.radius = opts.radius ?? 0;
  }

  draw(ctx, px, py, pw, ph) {
    ctx.beginPath();
    if (this.radius > 0) {
      roundRectPath(ctx, px, py, pw, ph, this.radius);
    } else {
      ctx.rect(px, py, pw, ph);
    }
    this.applyFillAndStroke(ctx);
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y,     x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x,     y + h, radius);
  ctx.arcTo(x,     y + h, x,     y,     radius);
  ctx.arcTo(x,     y,     x + w, y,     radius);
  ctx.closePath();
}