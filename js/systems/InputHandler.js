// Owns the browser event listeners.
//
// Its only job: translate raw browser events into clean,
// framework-shaped events in virtual coordinates, and hand them to
// whatever callback was registered via onEvent(). It does not decide
// what the events mean - that's the EventRouter's job.
//
// Computes the exact inverse of Renderer's virtual -> device transform.
// The arithmetic is duplicated here rather than shared; see Renderer's
// header comment for why.
//
// Mouse events on the canvas so they're scoped to it. Keyboard events
// on window so focus quirks don't swallow them.

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

    canvas.addEventListener("mousedown", (e) => {
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

    canvas.addEventListener("mousemove", (e) => {
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

    canvas.addEventListener("mouseup", (e) => {
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

    // Keep clicks inside the canvas from opening the context menu.
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("mouseleave", () => {
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