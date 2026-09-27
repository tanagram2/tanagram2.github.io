// Owns the browser event listeners.
//
// Its only job: translate raw browser events into clean,
// framework-shaped events in virtual coordinates, and hand them to
// whatever callback was registered via onEvent(). It does not decide
// what the events mean - that's the EventRouter's job.
//
// Uses Pointer Events (pointerdown/pointermove/pointerup/pointercancel)
// instead of Mouse Events. Pointer Events unify mouse, touch, and pen
// under one API, so the same listeners work on desktop and mobile.
//
// The emitted event shape is unchanged from the mouse version:
//   { type, x, y, ... } in virtual coordinates.
// Downstream code (EventRouter, HitTester, apps) does not change.
//
// Computes the exact inverse of Renderer's virtual -> device
// transform. The arithmetic is duplicated here rather than shared;
// see Renderer's header comment for why.
//
// Keyboard events are still on window so focus quirks don't swallow
// them. Touch is mouse-like enough that no separate keyboard path is
// needed for pointer input.

export class InputHandler {
  constructor(canvas, virtualW, virtualH) {
    this.canvas   = canvas;
    this.virtualW = virtualW;
    this.virtualH = virtualH;

    this._callback = null;

    // Latest known pointer position in virtual coords.
    this.pointerX = 0;
    this.pointerY = 0;

    this._bind();
  }

  onEvent(fn) {
    this._callback = fn;
  }

  _emit(event) {
    if (this._callback) this._callback(event);
  }

  // Inverse of Renderer's transform. Browser gives CSS pixels relative
  // to the canvas; convert to virtual.
  //
  //   devicePx = virtual * scale + offset
  //   virtual  = (cssPx * dpr - offset) / scale
  _toVirtual(clientX, clientY) {
    const rect  = this.canvas.getBoundingClientRect();
    const dpr   = window.devicePixelRatio || 1;
    const { scale, ox, oy } = this._getTransform();

    const deviceX = (clientX - rect.left) * dpr;
    const deviceY = (clientY - rect.top)  * dpr;

    return {
      x: (deviceX - ox) / scale,
      y: (deviceY - oy) / scale,
    };
  }

  // Set by main.js after Renderer exists. Avoids a circular import.
  setTransformProvider(fn) {
    this._getTransform = fn;
  }

  _bind() {
    // Default provider until main.js wires the real one.
    this._getTransform = () => ({ scale: 1, ox: 0, oy: 0 });

    const canvas = this.canvas;

    // Suppress the browser's default touch behaviors inside the
    // canvas: scrolling, pinch-zoom, double-tap zoom, and the
    // synthesized "click" event that fires 300ms after a tap. The
    // CSS touch-action: none already covers most of this; the
    // preventDefault here is a belt-and-braces for browsers that
    // still emit the synthetic mouse sequence.
    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener("pointerdown", (e) => {
      // Right-click should not start a press. Let contextmenu handle
      // it (which we still suppress below).
      if (e.button !== 0) return;

      const p = this._toVirtual(e.clientX, e.clientY);
      this.pointerX = p.x;
      this.pointerY = p.y;
      this._emit({
        type: "mousedown",
        button: e.button,
        x: p.x,
        y: p.y,
        raw: e,
      });
    });

    canvas.addEventListener("pointermove", (e) => {
      const p = this._toVirtual(e.clientX, e.clientY);
      this.pointerX = p.x;
      this.pointerY = p.y;
      this._emit({
        type: "mousemove",
        x: p.x,
        y: p.y,
        raw: e,
      });
    });

    canvas.addEventListener("pointerup", (e) => {
      if (e.button !== 0) return;

      const p = this._toVirtual(e.clientX, e.clientY);
      this.pointerX = p.x;
      this.pointerY = p.y;
      this._emit({
        type: "mouseup",
        button: e.button,
        x: p.x,
        y: p.y,
        raw: e,
      });
    });

    // pointercancel fires when the browser takes over the gesture
    // (e.g. a system swipe). Treat it as a release that did not
    // land on the press target, so any pressed Button visually
    // resets. The router's mouseup path handles this via hit-test;
    // a cancel has no meaningful coords, so emit at the last known
    // pointer position. If that lands off the press target, the
    // router fires onReleaseCancel. Good enough.
    canvas.addEventListener("pointercancel", (e) => {
      this._emit({
        type: "mouseup",
        button: 0,
        x: this.pointerX,
        y: this.pointerY,
        raw: e,
      });
    });

    // Keep clicks inside the canvas from opening the context menu.
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // Pointer left the canvas. Mouse-only concept; on touch there is
    // no equivalent because the finger's "presence" is the contact.
    // Fires for a mouse leaving the element, and for a pointer that
    // is cancelled by the browser. The router handles both.
    canvas.addEventListener("pointerleave", () => {
      this._emit({ type: "mouseleave" });
    });

    window.addEventListener("keydown", (e) => {
      this._emit({
        type: "keydown",
        key: e.key,
        code: e.code,
        repeat: e.repeat,
        raw: e,
      });
    });

    window.addEventListener("keyup", (e) => {
      this._emit({
        type: "keyup",
        key: e.key,
        code: e.code,
        raw: e,
      });
    });
  }
}