// Composite that looks like a clickable region, fires onClick when
// clicked, and gives visual feedback on hover and press.
//
// Structure: a `self` shape (any Shape) plus a Text child.
//
// Feedback: the Button does NOT watch for the mouse. The EventRouter
// tells it "you were hovered" / "you were pressed" / etc. by calling
// the matching handlers. The Button's response is purely cosmetic.
//
// Busy: an app can call setBusy(true) to lock the button's visual
// style. While busy, the built-in hover / press / release handlers
// do not restyle the self shape, so a caller-applied "busy" look
// stays put regardless of what the pointer does over the button.
// setBusy(false) returns the button to normal hover/press behavior.
// The busy look itself is the caller's job (Button does not know
// what "busy" should look like); Button only refuses to overwrite
// it.
//
// Base style: _baseStyle is a snapshot of the self shape taken at
// construction time, and hover/press styles merge over it. If an
// app changes the button's RESTING color (for example, flipping a
// button from green "Ready" to red "Unready"), the app must call
// setBaseStyle with the new values. Otherwise the next hover will
// merge over the old snapshot and the old resting color will come
// back. setBaseStyle updates the snapshot and, if the button is not
// busy, re-applies it now.
//
// Style merging: hoverStyle and pressStyle are merged OVER the base
// style, same convention as textOptions merging over default text
// options. A caller passing hoverStyle: { fill: "#5aa85a" } overrides
// only the fill; stroke and radius carry over from the base. If no
// hoverStyle/pressStyle is given, a mild lighten/darken of the base
// fill is used.
//
// A caller-supplied onClick is respected and simply forwarded.

import { Composite } from "./Composite.js";
import { Rect }      from "../primitives/Rect.js";
import { Text }      from "../primitives/Text.js";

export class Button extends Composite {
  constructor(opts = {}) {
    super(opts);

    this.self = opts.self ?? new Rect({
      fill:        opts.fill        ?? "#888888",
      stroke:      opts.stroke      ?? "#000000",
      strokeWidth: opts.strokeWidth ?? 2,
      radius:      opts.radius      ?? 0,
    });

    // Snapshot of the fields Button itself mutates. Kept symmetric
    // with _applyStyle so capture/restore stay in lockstep. An app
    // that changes the resting color calls setBaseStyle to refresh
    // this snapshot.
    this._baseStyle = this._captureStyle();

    this._hoverStyle = opts.hoverStyle ?? null;
    this._pressStyle = opts.pressStyle ?? null;

    // Busy flag. When true, the handlers below do not restyle the
    // self shape. Toggled via setBusy.
    this._busy = false;

    const defaultTextOpts = {
      text:     opts.text     ?? "",
      x:        "50%",
      y:        "50%",
      align:    "center",
      baseline: "middle",
      color:    "#ffffff",
      font:     "16px sans-serif",
    };

    this.text = new Text(
      opts.textOptions
        ? { ...defaultTextOpts, ...opts.textOptions }
        : defaultTextOpts
    );

    this.add(this.text);

    // Handlers. These do not poll; they run only because the router
    // decided a transition happened. While _busy is true, they are
    // no-ops so the caller's busy look is not overwritten by a
    // hover or press.
    this.onHover         = () => { if (!this._busy) this._applyStyle(this._resolveHoverStyle()); };
    this.onHoverOut      = () => { if (!this._busy) this._applyStyle(this._baseStyle); };
    this.onPress         = () => { if (!this._busy) this._applyStyle(this._resolvePressStyle()); };
    this.onRelease       = () => { if (!this._busy) this._applyStyle(this._resolveHoverStyle()); };
    this.onReleaseCancel = () => { if (!this._busy) this._applyStyle(this._baseStyle); };

    const callerOnClick = opts.onClick ?? null;
    if (callerOnClick) {
      this.onClick = (e) => callerOnClick(e);
    }
  }

  // Lock or unlock the button's visual style. While busy, the
  // built-in handlers above will not restyle the self shape, so a
  // caller-applied "busy" look stays put. The caller is responsible
  // for setting and restoring the visual busy style; this method
  // only controls whether the button may restyle itself.
  setBusy(on) {
    this._busy = !!on;
    return this;
  }

  isBusy() {
    return this._busy;
  }

  // Change the button's RESTING style. Call this whenever the app
  // changes the button's base color (for example, flipping Ready
  // to Unready). Without it, the next hover would merge over the
  // stale snapshot and the old resting color would reappear.
  //
  // Accepts a partial style object with any of fill, stroke,
  // strokeWidth, radius. Missing fields keep their current snapshot
  // values.
  //
  // If the button is not busy, the new base style is applied to the
  // self shape now, so the button's resting look updates immediately
  // even without a hover.
  setBaseStyle(style) {
    if (!style) return this;

    if ("fill"        in style) this._baseStyle.fill        = style.fill;
    if ("stroke"      in style) this._baseStyle.stroke      = style.stroke;
    if ("strokeWidth" in style) this._baseStyle.strokeWidth = style.strokeWidth;
    if ("radius"      in style) this._baseStyle.radius      = style.radius;

    if (!this._busy) {
      this._applyStyle(this._baseStyle);
    }
    return this;
  }

  _captureStyle() {
    const s = this.self;
    return {
      fill:        s.fill,
      stroke:      s.stroke,
      strokeWidth: s.strokeWidth,
      radius:      s.radius,
    };
  }

  _applyStyle(style) {
    const s = this.self;
    if ("fill"        in style) s.fill        = style.fill;
    if ("stroke"      in style) s.stroke      = style.stroke;
    if ("strokeWidth" in style) s.strokeWidth = style.strokeWidth;
    if ("radius"      in style) s.radius      = style.radius;
  }

  _resolveHoverStyle() {
    if (this._hoverStyle) {
      return { ...this._baseStyle, ...this._hoverStyle };
    }
    return { ...this._baseStyle, fill: lighten(this._baseStyle.fill, 0.18) };
  }

  _resolvePressStyle() {
    if (this._pressStyle) {
      return { ...this._baseStyle, ...this._pressStyle };
    }
    return { ...this._baseStyle, fill: darken(this._baseStyle.fill, 0.18) };
  }

  setText(str) {
    this.text.text = str;
    return this;
  }

  getText() {
    return this.text.text;
  }
}

// Small color utility, module-private. Parses #rgb, #rrggbb, and
// rgb(...). Returns the input unchanged if it can't parse it, so an
// exotic color degrades to "no visible shift" rather than crashing.

function shiftColor(color, amount) {
  if (typeof color !== "string") return color;
  const rgb = parseColor(color);
  if (!rgb) return color;
  const [r, g, b] = rgb;
  const nr = clamp255(Math.round(r + 255 * amount));
  const ng = clamp255(Math.round(g + 255 * amount));
  const nb = clamp255(Math.round(b + 255 * amount));
  return `rgb(${nr}, ${ng}, ${nb})`;
}

function lighten(color, amount) { return shiftColor(color,  amount); }
function darken(color, amount)  { return shiftColor(color, -amount); }

function clamp255(n) { return Math.max(0, Math.min(255, n)); }

function parseColor(color) {
  const hex = color.trim();
  if (hex.startsWith("#")) {
    const h = hex.slice(1);
    if (h.length === 3) {
      return [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16),
      ];
    }
    if (h.length === 6) {
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
    }
    return null;
  }
  const m = hex.match(/^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  }
  return null;
}