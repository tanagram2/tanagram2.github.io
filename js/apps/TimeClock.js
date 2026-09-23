// Analog + digital clock.
//
// Structure: a landing screen (Start / Exit, same shape as Calculator)
// and a running screen containing a clock face and a Digital/Analog
// toggle. Both built once, toggled via visible.
//
// The running screen has two faces in the same spot: an analog face
// (Circle rim, tick marks, 1-12 numbers, three hands) and a digital
// face (rounded panel, HH:MM:SS, AM/PM, milliseconds). Only one is
// visible at a time. The toggle button and Return button stay put
// across the swap.
//
// Hands are Line + Polygon (an equilateral arrowhead at the line's
// end). The Line's tip is set to the base midpoint of the triangle so
// the shaft does not poke through the apex. Both objects reposition
// each frame from the same angle.

import { App }    from "./App.js";
import { Rect }   from "../primitives/Rect.js";
import { Circle } from "../primitives/Circle.js";
import { Line }   from "../primitives/Line.js";
import { Polygon } from "../primitives/Polygon.js";
import { Text }   from "../primitives/Text.js";
import { Panel }  from "../composites/Panel.js";
import { Button } from "../composites/Button.js";
import { Label }  from "../composites/Label.js";

export class TimeClock extends App {
  static displayName = "TimeClock";

  init() {
    this.mode = "analog"; // "analog" | "digital"

    this.landingScreen = this._buildLanding();
    this.clockScreen   = this._buildClockScreen();
    this.root.add(this.landingScreen);
    this.root.add(this.clockScreen);

    this._showLanding();
  }

  // ---- Landing screen (mirrors Calculator) ----

  _buildLanding() {
    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#151b2a",
      stroke: null,
    });

    screen.add(new Label({
      x: 640, y: 240,
      text: "TimeClock",
      textOptions: {
        font: "bold 44px sans-serif",
        color: "#c8d6ee",
        align: "center",
        baseline: "middle",
      },
    }));

    const btnW = 220, btnH = 64, gap = 24;
    const totalW = btnW * 2 + gap;
    const startX = (1280 - totalW) / 2;
    const btnY = 380;

    screen.add(new Button({
      x: startX, y: btnY, w: btnW, h: btnH,
      text: "Start",
      fill: "#2a3552",
      stroke: "#6a86b8",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 22px sans-serif", color: "#ffffff" },
      onClick: () => this._showClock(),
    }));

    screen.add(new Button({
      x: startX + btnW + gap, y: btnY, w: btnW, h: btnH,
      text: "Exit",
      fill: "#3a3a3a",
      stroke: "#888888",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 22px sans-serif", color: "#ffffff" },
      onClick: () => this.exit(),
    }));

    return screen;
  }

  // ---- Clock screen ----

  _buildClockScreen() {
    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#151b2a",
      stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: "#2a3552",
      stroke: "#6a86b8",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._showLanding(),
    }));

    const cx  = 640;
    const cy  = 320;
    const r   = 240;
    const rim = 8;

    this._cx  = cx;
    this._cy  = cy;
    this._r   = r;
    this._rim = rim;

    this.analogFace  = this._buildAnalogFace(cx, cy, r, rim);
    this.digitalFace = this._buildDigitalFace(cx, cy, r);

    screen.add(this.analogFace);
    screen.add(this.digitalFace);

    this.toggleButton = new Button({
      x: 640 - 110, y: 620,
      w: 220, h: 56,
      text: "Digital",
      fill: "#2a3552",
      stroke: "#6a86b8",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
      onClick: () => this._toggleMode(),
    });
    screen.add(this.toggleButton);

    return screen;
  }

  _buildAnalogFace(cx, cy, r, rim) {
    const outer = r + rim;
    const faceX = cx - outer;
    const faceY = cy - outer;
    const faceW = outer * 2;
    const faceH = outer * 2;

    const face = new Panel({
      x: faceX, y: faceY,
      w: faceW, h: faceH,
      self: null,
    });

    face.add(new Circle({
      x: 0, y: 0,
      w: faceW, h: faceH,
      fill: "#000000",
      stroke: null,
    }));

    face.add(new Circle({
      x: rim, y: rim,
      w: r * 2, h: r * 2,
      fill: "#eef2f7",
      stroke: "#0b0f16",
      strokeWidth: 2,
    }));

    const fx = outer;
    const fy = outer;

    const thickLen   = 22;
    const thinLen    = 12;
    const thickWidth = 4;
    const thinWidth  = 1.5;
    const tickOuter  = r - 10;

    for (let i = 0; i < 60; i++) {
      const isHour = i % 5 === 0;
      const len    = isHour ? thickLen : thinLen;
      const width  = isHour ? thickWidth : thinWidth;

      const ang = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const sin = Math.sin(ang);
      const cos = Math.cos(ang);

      const x1 = fx + cos * tickOuter;
      const y1 = fy + sin * tickOuter;
      const x2 = fx + cos * (tickOuter - len);
      const y2 = fy + sin * (tickOuter - len);

      face.add(new Line({
        x1, y1, x2, y2,
        stroke: "#0b0f16",
        strokeWidth: width,
      }));
    }

    const numberRadius = tickOuter - thickLen - 22;
    for (let n = 1; n <= 12; n++) {
      const ang = (n / 12) * Math.PI * 2 - Math.PI / 2;
      const nx  = fx + Math.cos(ang) * numberRadius;
      const ny  = fy + Math.sin(ang) * numberRadius;

      face.add(new Text({
        x: nx, y: ny,
        text: String(n),
        font: "bold 26px sans-serif",
        color: "#0b0f16",
        align: "center",
        baseline: "middle",
      }));
    }

    // Hand geometry. Lengths are from the pivot; arrowSize is the
    // equilateral triangle's side length.
    const hourLen    = r * 0.50;
    const hourTail   = r * 0.08;
    const hourWidth  = 8;
    const hourArrow  = 26;

    const minLen     = r * 0.78;
    const minTail    = r * 0.08;
    const minWidth   = 5;
    const minArrow   = 20;

    const secLen     = r * 0.90;
    const secTail    = r * 0.15;
    const secWidth   = 2;

    this.hourLine  = new Line({
      x1: 0, y1: 0, x2: 0, y2: 0,
      stroke: "#0b0f16", strokeWidth: hourWidth,
    });
    this.hourArrow = new Polygon({
      x: 0, y: 0,
      points: [],
      fill: "#0b0f16",
      stroke: null,
    });

    this.minLine  = new Line({
      x1: 0, y1: 0, x2: 0, y2: 0,
      stroke: "#0b0f16", strokeWidth: minWidth,
    });
    this.minArrow = new Polygon({
      x: 0, y: 0,
      points: [],
      fill: "#0b0f16",
      stroke: null,
    });

    this.secLine = new Line({
      x1: 0, y1: 0, x2: 0, y2: 0,
      stroke: "#cc2222", strokeWidth: secWidth,
    });

    face.add(this.hourLine);
    face.add(this.minLine);
    face.add(this.secLine);
    face.add(this.hourArrow);
    face.add(this.minArrow);

    face.add(new Circle({
      x: fx - 7, y: fy - 7,
      w: 14, h: 14,
      fill: "#0b0f16",
      stroke: null,
    }));

    this._fx        = fx;
    this._fy        = fy;
    this._hourLen   = hourLen;
    this._hourTail  = hourTail;
    this._hourArrow = hourArrow;
    this._minLen    = minLen;
    this._minTail   = minTail;
    this._minArrow  = minArrow;
    this._secLen    = secLen;
    this._secTail   = secTail;

    return face;
  }

  _buildDigitalFace(cx, cy, r) {
    const panelW = 520;
    const panelH = 160;
    const panelX = cx - panelW / 2;
    const panelY = cy - panelH / 2;

    const panel = new Panel({
      x: panelX, y: panelY,
      w: panelW, h: panelH,
      fill: "#0a0d14",
      stroke: "#3a4d70",
      strokeWidth: 3,
      radius: 18,
    });

    this.digitalMain = new Label({
      x: 0, y: 0,
      w: "100%", h: "100%",
      text: "00:00:00",
      textOptions: {
        font: "bold 64px monospace",
        color: "#d8e4f7",
        align: "center",
        baseline: "middle",
      },
    });
    this.digitalMain.text.x = "50%";
    this.digitalMain.text.y = "50%";
    panel.add(this.digitalMain);

    this.digitalAmPm = new Text({
      x: 0, y: 0,
      text: "AM",
      font: "bold 18px monospace",
      color: "#8fa9d0",
      align: "left",
      baseline: "middle",
    });
    panel.add(this.digitalAmPm);

    this.digitalMs = new Text({
      x: 0, y: 0,
      text: "000",
      font: "14px monospace",
      color: "#5f7a95",
      align: "left",
      baseline: "middle",
    });
    panel.add(this.digitalMs);

    this.digitalAmPm.x = panelW - 78;
    this.digitalAmPm.y = panelH / 2 - 18;
    this.digitalMs.x    = panelW - 78;
    this.digitalMs.y    = panelH / 2 + 14;

    return panel;
  }

  _showLanding() {
    this.landingScreen.visible = true;
    this.clockScreen.visible   = false;
  }

  _showClock() {
    this.mode = "analog";
    this._applyMode();
    this.landingScreen.visible = false;
    this.clockScreen.visible   = true;
  }

  _toggleMode() {
    this.mode = this.mode === "analog" ? "digital" : "analog";
    this._applyMode();
  }

  _applyMode() {
    const analog = this.mode === "analog";
    this.analogFace.visible  = analog;
    this.digitalFace.visible = !analog;
    this.toggleButton.setText(analog ? "Digital" : "Analog");
  }

  update(dt) {
    if (!this.clockScreen.visible) return;

    const now = new Date();

    if (this.mode === "analog") {
      this._updateAnalog(now);
    } else {
      this._updateDigital(now);
    }
  }

  _updateAnalog(now) {
    const sec = now.getSeconds() + now.getMilliseconds() / 1000;
    const min = now.getMinutes() + sec / 60;
    const hr  = (now.getHours() % 12) + min / 60;

    const secAng = (sec / 60) * Math.PI * 2;
    const minAng = (min / 60) * Math.PI * 2;
    const hrAng  = (hr  / 12) * Math.PI * 2;

    this._setHand(this.hourLine, this.hourArrow, hrAng,
                  this._hourLen, this._hourTail, this._hourArrow);
    this._setHand(this.minLine, this.minArrow, minAng,
                  this._minLen, this._minTail, this._minArrow);
    this._setHand(this.secLine, null, secAng,
                  this._secLen, this._secTail, 0);
  }

  // Position a hand Line and (optionally) its arrowhead Polygon.
  //
  // Arrowhead is an equilateral triangle symmetric about the hand
  // axis:
  //
  //      apex  <- points outward along the hand direction
  //      /\
  //     /  \
  //    /____\  <- base, perpendicular to the axis, centered on it
  //
  // side = the triangle's side length. Height for an equilateral is
  // side * sqrt(3)/2; the base sits that far back from the apex.
  //
  // The Line's x2/y2 is set to the base midpoint (not the apex), so
  // the shaft doesn't poke through the tip of the triangle.
  _setHand(line, arrow, ang, len, tail, side) {
    const fx = this._fx;
    const fy = this._fy;

    const sin = Math.sin(ang);
    const cos = Math.cos(ang);
    const dx  = sin;
    const dy  = -cos;

    const tipX  = fx + dx * len;
    const tipY  = fy + dy * len;
    const tailX = fx - dx * tail;
    const tailY = fy - dy * tail;

    if (!arrow) {
      line.x1 = tailX;
      line.y1 = tailY;
      line.x2 = tipX;
      line.y2 = tipY;
      return;
    }

    // Equilateral: height = side * sqrt(3) / 2.
    const height    = side * Math.sqrt(3) / 2;
    const halfWidth = side / 2;

    const baseMidX = tipX - dx * height;
    const baseMidY = tipY - dy * height;

    // Perpendicular unit vector.
    const pdx = -dy;
    const pdy =  dx;

    const bLx = baseMidX + pdx * halfWidth;
    const bLy = baseMidY + pdy * halfWidth;
    const bRx = baseMidX - pdx * halfWidth;
    const bRy = baseMidY - pdy * halfWidth;

    // Shaft ends at the base midpoint so it does not show through.
    line.x1 = tailX;
    line.y1 = tailY;
    line.x2 = baseMidX;
    line.y2 = baseMidY;

    // Polygon-local coords: shift by tip so Polygon.x/y = apex.
    arrow.x = tipX;
    arrow.y = tipY;
    arrow.points = [
      { x: 0,           y: 0           }, // apex
      { x: bLx - tipX,  y: bLy - tipY  }, // base left
      { x: bRx - tipX,  y: bRy - tipY  }, // base right
    ];
  }

  _updateDigital(now) {
    const h24 = now.getHours();
    const ampm = h24 < 12 ? "AM" : "PM";
    let h12 = h24 % 12;
    if (h12 === 0) h12 = 12;

    const hh = String(h12).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const ms = String(now.getMilliseconds()).padStart(3, "0");

    this.digitalMain.setText(hh + ":" + mm + ":" + ss);
    this.digitalAmPm.text = ampm;
    this.digitalMs.text   = ms;
  }
}