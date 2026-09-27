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
// them.

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

    // touchstart / touchmove preventDefault are belt-and-braces.
    // Pointer Events already fire preventDefaultable events; the
    // real suppression that matters is on pointerdown below. But
    // some older browsers still gate gesture interpretation on the
    // touch events, so covering both is cheap.
    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener("pointerdown", (e) => {
      // Right-click should not start a press.
      if (e.button !== 0) return;

      // Suppress the browser's interpretation of this as the start
      // of a native gesture (scroll, pan, pinch, text selection).
      // Without this, mobile browsers often convert the pointer
      // stream to pointercancel after the first move, which kills
      // drag-based input like swipes.
      e.preventDefault();

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
      // Only preventDefault while a button is down. Passive pointer
      // movement (no button) has no default to suppress anyway, but
      // guarding keeps the intent clear.
      if (e.buttons !== 0) {
        e.preventDefault();
      }

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

    // pointercancel fires when the browser takes over the gesture.
    // With the preventDefault on pointerdown above this should be
    // rare, but keep it as a safety net so any pressed Button
    // visually resets.
    canvas.addEventListener("pointercancel", (e) => {
      this._emit({
        type: "mouseup",
        button: 0,
        x: this.pointerX,
        y: this.pointerY,
        raw: e,
      });
    });

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

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