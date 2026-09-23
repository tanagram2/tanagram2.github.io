// Root base class for everything the Renderer can draw.
//
// x, y, w, h are relative to the PARENT's origin (top-left). Values are
// pixels (number) or percentage strings ("50%"). Percentages resolve
// against the parent's resolved w/h at draw time.
//
// Drawables are dumb. They don't poll, listen, or self-update. The
// Renderer calls draw(); the EventRouter calls handlers.

export class Drawable {
  constructor(opts = {}) {
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.w = opts.w ?? 0;
    this.h = opts.h ?? 0;

    // Set by the parent Composite (or by AppManager for an app root).
    this.parent = null;

    // All optional. Absent = this Drawable doesn't care.
    //   onClick         - pointer went down AND up on this node.
    //   onHover         - pointer entered this node (no press active).
    //   onHoverOut      - pointer left this node (no press active).
    //   onPress         - pointer went down on this node.
    //   onRelease       - pointer came up on this node while it was the
    //                     press target.
    //   onReleaseCancel - this node was the press target but the pointer
    //                     came up elsewhere. The click did not count.
    this.onClick         = opts.onClick         ?? null;
    this.onHover         = opts.onHover         ?? null;
    this.onHoverOut      = opts.onHoverOut      ?? null;
    this.onPress         = opts.onPress         ?? null;
    this.onRelease       = opts.onRelease       ?? null;
    this.onReleaseCancel = opts.onReleaseCancel ?? null;

    this.visible = opts.visible ?? true;
  }

  // Resolve a value that may be a pixel number or a "NN%" string against
  // a parent's resolved pixel size. The only place this logic lives.
  static resolve(value, parentPixels) {
    if (typeof value === "string" && value.endsWith("%")) {
      return parentPixels * (parseFloat(value) / 100);
    }
    return value;
  }

  // Subclasses override. px/py are this Drawable's resolved absolute
  // position in virtual coords. Subclasses do NOT apply their own
  // transform; the Renderer has already positioned things.
  draw(ctx, px, py, pw, ph) {
    // no-op
  }
}