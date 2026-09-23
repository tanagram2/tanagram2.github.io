// Straight segment between two points.
//
// The exception to the box convention. Endpoints x1/y1/x2/y2 are
// relative to the parent's origin, same space as every other Drawable's
// x/y. Inherited x/y/w/h are unused by draw().
//
// Inherits stroke/strokeWidth from Shape. fill is meaningless (no
// interior to fill). If stroke is null, nothing draws - that's the
// Shape default and it's the correct behavior for a line with no color.

import { Shape } from "./Shape.js";

export class Line extends Shape {
  constructor(opts = {}) {
    super(opts);

    this.x1 = opts.x1 ?? 0;
    this.y1 = opts.y1 ?? 0;
    this.x2 = opts.x2 ?? 0;
    this.y2 = opts.y2 ?? 0;
  }

  draw(ctx, px, py, pw, ph) {
    if (this.stroke == null) return;

    ctx.beginPath();
    ctx.moveTo(px + this.x1, py + this.y1);
    ctx.lineTo(px + this.x2, py + this.y2);

    ctx.strokeStyle = this.stroke;
    ctx.lineWidth   = this.strokeWidth;
    ctx.stroke();
  }
}