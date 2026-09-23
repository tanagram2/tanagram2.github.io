// Stateless helper. Answers "what's under this point?"
//
// Given a root Drawable and a point in virtual coords, returns the
// deepest visible Drawable whose resolved box contains the point, or
// null.
//
// Kept separate from EventRouter because games will call it directly
// (e.g. "which grid cell was clicked?").

import { Drawable }  from "../primitives/Drawable.js";
import { Composite } from "../composites/Composite.js";

export class HitTester {
  hitTest(root, vx, vy) {
    if (!root) return null;
    return this._walk(root, 0, 0, root.w, root.h, vx, vy);
  }

  // px/py/pw/ph: the resolved absolute virtual box of `node`. Mirrors
  // Renderer._drawNode's resolution so the two always agree.
  _walk(node, parentPx, parentPy, parentPw, parentPh, vx, vy) {
    if (!node.visible) return null;

    const px = parentPx + Drawable.resolve(node.x, parentPw);
    const py = parentPy + Drawable.resolve(node.y, parentPh);
    const pw = Drawable.resolve(node.w, parentPw);
    const ph = Drawable.resolve(node.h, parentPh);

    // Children drawn after (on top of) parent, so check children first
    // and in reverse order so later-added (visually on top) wins.
    if (node instanceof Composite) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const hit = this._walk(node.children[i], px, py, pw, ph, vx, vy);
        if (hit) return hit;
      }
      // Only a Composite with its own shape absorbs hits. A bare
      // grouping Composite should not.
      if (node.self && this._contains(px, py, pw, ph, vx, vy)) {
        return node;
      }
      return null;
    }

    if (this._contains(px, py, pw, ph, vx, vy)) {
      return node;
    }
    return null;
  }

  _contains(px, py, pw, ph, vx, vy) {
    return vx >= px && vx < px + pw && vy >= py && vy < py + ph;
  }
}