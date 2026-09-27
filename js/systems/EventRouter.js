// Takes a clean event from InputHandler, asks HitTester what's under
// the pointer, walks up the tree to find the nearest Drawable with a
// handler for that event type, and calls it. If nothing handles it,
// passes the event to the current App's onEvent(). Standard DOM-style
// bubbling.
//
// EventRouter OWNS hover and press state. Composites stay dumb: a
// Button doesn't know it's being hovered; the router tracks the
// last-hit node and the press target and tells nodes when transitions
// happen.
//
// Press model:
//   - mousedown sets _pressedNode to the nearest node with onPress up
//     the tree from the hit. That node stays the press target until
//     mouseup, regardless of pointer movement.
//   - While _pressedNode is set, hover is SUPPRESSED. This is what
//     makes "hold and slide off the button" keep the button visually
//     pressed.
//   - mouseup: if the hit at release time is the press target or a
//     descendant of it, the press counts: onClick fires on the nearest
//     onClick node at the hit, then onRelease fires on the press
//     target. Otherwise onReleaseCancel fires on the press target.
//     Either way _pressedNode clears, then ONE hover pass runs at the
//     release point so nodes land in the correct visual state.
//
// mousemove: routes hover, and ALWAYS falls through to app.onEvent
// afterwards. Apps that care about drag/swipe read it there. While a
// press is active, hover routing is skipped but the fall-through
// still happens, so drags that started on a Button are still visible
// to the app.
//
// State owned here:
//   _lastHit     - node pointer was over as of the last hover pass.
//   _pressedNode - current press target.

export class EventRouter {
  constructor(hitTester) {
    this.hitTester = hitTester;

    this._lastHit     = null;
    this._pressedNode = null;
  }

  // Called by AppManager on every app swap. Fires onHoverOut and
  // onReleaseCancel on stale nodes before dropping references.
  clearHoverState() {
    if (this._lastHit && this._lastHit.onHoverOut) {
      this._lastHit.onHoverOut({ type: "hoverout" });
    }
    if (this._pressedNode && this._pressedNode.onReleaseCancel) {
      this._pressedNode.onReleaseCancel({ type: "releasecancel" });
    }
    this._lastHit     = null;
    this._pressedNode = null;
  }

  route(event, app) {
    if (event.type === "mouseleave") {
      // Pointer left the canvas. If a press is active, keep it active -
      // the user may release back over the canvas. Only hover clears.
      if (!this._pressedNode) {
        if (this._lastHit && this._lastHit.onHoverOut) {
          this._lastHit.onHoverOut({ type: "hoverout" });
        }
        this._lastHit = null;
      }
      return;
    }

    if (event.type === "mousemove") {
      // Hover is suppressed entirely while a press is active, but the
      // app still needs to see the move so drag/swipe can track.
      if (!this._pressedNode) {
        this._routeHover(event, app);
      }
      if (app && app.onEvent) {
        app.onEvent(event);
      }
      return;
    }

    if (event.type === "mousedown") {
      const hit  = this.hitTester.hitTest(app ? app.root : null, event.x, event.y);
      const node = this._findHandlerNode(hit, "onPress");
      if (node) {
        this._pressedNode = node;
        node.onPress(event);
        return;
      }
      // fall through to app
    }

    if (event.type === "mouseup") {
      const hit = this.hitTester.hitTest(app ? app.root : null, event.x, event.y);

      const pressed = this._pressedNode;
      this._pressedNode = null;

      if (pressed) {
        const onTarget = hit && this._isSelfOrDescendant(hit, pressed);

        if (onTarget) {
          const clickNode = this._findHandlerNode(hit, "onClick");
          if (clickNode) clickNode.onClick(event);
          if (pressed.onRelease) pressed.onRelease(event);
        } else {
          if (pressed.onReleaseCancel) pressed.onReleaseCancel(event);
        }

        // One hover pass so every node lands in the correct state.
        this._routeHover(event, app);
        return;
      }

      // No active press (mouseup with no matching mousedown). Fall back
      // to firing onClick on the nearest handler.
      const clickNode = this._findHandlerNode(hit, "onClick");
      if (clickNode) {
        clickNode.onClick(event);
        return;
      }
      // fall through to app
    }

    if (app && app.onEvent) {
      app.onEvent(event);
    }
  }

  // Hit-test, compare to last hit, fire leave on old and enter on new.
  // Bubbles hover handlers up the tree just like click.
  _routeHover(event, app) {
    const hit = this.hitTester.hitTest(app ? app.root : null, event.x, event.y);
    const hoverNode = this._findHandlerNode(hit, "onHover");

    if (hoverNode !== this._lastHit) {
      if (this._lastHit && this._lastHit.onHoverOut) {
        this._lastHit.onHoverOut({ type: "hoverout" });
      }
      if (hoverNode && hoverNode.onHover) {
        hoverNode.onHover(event);
      }
      this._lastHit = hoverNode;
    }
  }

  _isSelfOrDescendant(node, ancestor) {
    let n = node;
    while (n) {
      if (n === ancestor) return true;
      n = n.parent;
    }
    return false;
  }

  // Walk up from `node` via .parent until one has `handlerName` set.
  // Returns the node itself (not a bound fn) so callers can compare
  // identity.
  _findHandlerNode(node, handlerName) {
    let n = node;
    while (n) {
      if (n[handlerName]) return n;
      n = n.parent;
    }
    return null;
  }
}