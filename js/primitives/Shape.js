// Common base for geometric primitives (Rect, Circle, Line, Polygon).
// Adds fill / stroke / strokeWidth. Still abstract: it doesn't know how
// to draw itself, only what colors to draw with.

import { Drawable } from "./Drawable.js";

export class Shape extends Drawable {
  constructor(opts = {}) {
    super(opts);

    this.fill        = opts.fill        ?? "#ffffff";
    this.stroke      = opts.stroke      ?? null;
    this.strokeWidth = opts.strokeWidth ?? 1;
  }

  // Shared so every Shape applies fill and stroke identically.
  applyFillAndStroke(ctx) {
    if (this.fill != null) {
      ctx.fillStyle = this.fill;
      ctx.fill();
    }
    if (this.stroke != null) {
      ctx.strokeStyle = this.stroke;
      ctx.lineWidth   = this.strokeWidth;
      ctx.stroke();
    }
  }
}