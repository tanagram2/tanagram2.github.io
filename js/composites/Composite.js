// A Drawable that holds children, positioned relative to itself.
//
// An optional `self` shape (a Rect, Circle, etc.) is drawn first, in
// the Composite's own resolved box, before children. A bare grouping
// Composite leaves `self` null and is invisible except for its children.
//
// `clip` is off by default; scrolling containers can opt in later.

import { Drawable } from "../primitives/Drawable.js";

export class Composite extends Drawable {
  constructor(opts = {}) {
    super(opts);

    this.children = [];
    this.self     = opts.self ?? null;
    this.clip     = opts.clip ?? false;
  }

  add(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(child) {
    const i = this.children.indexOf(child);
    if (i !== -1) {
      this.children.splice(i, 1);
      child.parent = null;
    }
    return child;
  }

  // Called by the Renderer before it recurses into children. Sizes the
  // self shape to the Composite's resolved box and draws it there.
  drawSelf(ctx, px, py, pw, ph) {
    if (!this.self) return;
    this.self.x = 0;
    this.self.y = 0;
    this.self.w = pw;
    this.self.h = ph;
    this.self.draw(ctx, px, py, pw, ph);
  }
}