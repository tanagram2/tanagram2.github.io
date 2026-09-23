// Walks a tree of Drawables and draws them to the canvas.
//
// The only place that touches the 2D context's transform, and the only
// place that converts virtual coords to real canvas pixels.
//
// Transform pipeline:
//   - Backing store sized to window * devicePixelRatio for crisp text.
//   - Uniform scale = min(canvasW / VIRTUAL_W, canvasH / VIRTUAL_H),
//     plus a letterbox offset (ox, oy) that centers the virtual
//     viewport in the real canvas.
//   - draw() sets this transform once, then recurses. Each Drawable is
//     drawn at its resolved absolute virtual position.
//
// InputHandler computes the inverse of this exact transform. The math
// is deliberately mirrored there rather than extracted into a shared
// Transform object - seven lines of arithmetic beats a speculative
// abstraction.

import { Drawable }  from "../primitives/Drawable.js";
import { Composite } from "../composites/Composite.js";

export class Renderer {
  constructor(canvas, ctx, virtualW, virtualH) {
    this.canvas   = canvas;
    this.ctx      = ctx;
    this.virtualW = virtualW;
    this.virtualH = virtualH;

    this.scale = 1;
    this.ox    = 0;
    this.oy    = 0;

    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize);
    this._resize();
  }

  _resize() {
    const dpr  = window.devicePixelRatio || 1;
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;

    this.canvas.width  = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.canvas.style.width  = cssW + "px";
    this.canvas.style.height = cssH + "px";

    // DPR is baked into scale so downstream math stays simple.
    this.scale = Math.min(cssW / this.virtualW, cssH / this.virtualH) * dpr;
    this.ox = (this.canvas.width  - this.virtualW * this.scale) / 2;
    this.oy = (this.canvas.height - this.virtualH * this.scale) / 2;
  }

  // Exposed so InputHandler can invert it. Maps virtual -> device px:
  //   dx = vx * scale + ox
  //   dy = vy * scale + oy
  getTransform() {
    return { scale: this.scale, ox: this.ox, oy: this.oy };
  }

  draw(root) {
    const ctx = this.ctx;

    // Clear in device pixels - no transform applied yet.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (!root) return;

    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    this._drawNode(root, 0, 0, this.virtualW, this.virtualH);
  }

  // px/py/pw/ph: the resolved absolute virtual box of this node.
  // The node's own x/y/w/h are relative to its parent, resolved here.
  _drawNode(node, parentPx, parentPy, parentPw, parentPh) {
    if (!node.visible) return;

    const px = parentPx + Drawable.resolve(node.x, parentPw);
    const py = parentPy + Drawable.resolve(node.y, parentPh);
    const pw = Drawable.resolve(node.w, parentPw);
    const ph = Drawable.resolve(node.h, parentPh);

    if (node instanceof Composite) {
      node.drawSelf(this.ctx, px, py, pw, ph);
      for (const child of node.children) {
        this._drawNode(child, px, py, pw, ph);
      }
    } else {
      node.draw(this.ctx, px, py, pw, ph);
    }
  }
}