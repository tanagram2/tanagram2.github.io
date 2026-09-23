// Closed shape defined by an array of {x, y} points in local space
// (relative to the Polygon's origin, matching every other box-based
// Shape). The drawn shape is determined entirely by `points`, not by
// the inherited box. Points are absolute pixels within local space,
// not fractional - nothing needs percentages here.
//
// The path is always closed. Open polylines are what Line is for.

import { Shape } from "./Shape.js";

export class Polygon extends Shape {
  constructor(opts = {}) {
    super(opts);

    // Empty by default so a Polygon with no points draws nothing
    // rather than erroring.
    this.points = opts.points ?? [];
  }

  draw(ctx, px, py, pw, ph) {
    if (this.points.length === 0) return;

    ctx.beginPath();
    ctx.moveTo(px + this.points[0].x, py + this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(px + this.points[i].x, py + this.points[i].y);
    }
    ctx.closePath();

    this.applyFillAndStroke(ctx);
  }
}