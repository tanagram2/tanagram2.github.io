// Non-scientific calculator.
//
// Structure: a landing screen (Start / Exit) and a calculator screen
// (Return top-left, display, 4x5 keypad). Both screens are built once
// and toggled via `visible`.
//
// Layout constants come from Viewport so the same code lays out
// correctly at 1280x720 (desktop) and 720x1280 (mobile).
//
// Everything visible is a Composite. Layout is manual pixel
// arithmetic in the active virtual space.

import { App }      from "./App.js";
import { Panel }    from "../composites/Panel.js";
import { Button }   from "../composites/Button.js";
import { Label }    from "../composites/Label.js";
import { Viewport } from "../systems/Viewport.js";

export class Calculator extends App {
  static displayName = "Calculator";

  init() {
    this.entry  = "0";
    this.stored = null;
    this.op     = null;
    this.fresh  = true;

    this.landingScreen = this._buildLanding();
    this.calcScreen    = this._buildCalculator();
    this.root.add(this.landingScreen);
    this.root.add(this.calcScreen);

    this._showLanding();
  }

  _buildLanding() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mobile = Viewport.isMobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#1b2a1b",
      stroke: null,
    });

    const titleFont = mobile ? "bold 56px sans-serif" : "bold 44px sans-serif";
    const titleY    = mobile ? H * 0.35 : 240;

    screen.add(new Label({
      x: W / 2, y: titleY,
      text: "Calculator",
      textOptions: {
        font: titleFont,
        color: "#cfe8cf",
        align: "center",
        baseline: "middle",
      },
    }));

    const btnW = mobile ? 240 : 220;
    const btnH = mobile ? 80 : 64;
    const gap  = mobile ? 20 : 24;
    const totalW = btnW * 2 + gap;
    const startX = (W - totalW) / 2;
    const btnY   = mobile ? H * 0.55 : 380;
    const btnFont = mobile ? "bold 26px sans-serif" : "bold 22px sans-serif";

    screen.add(new Button({
      x: startX, y: btnY, w: btnW, h: btnH,
      text: "Start",
      fill: "#3f7f3f",
      stroke: "#7bc07b",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: btnFont, color: "#ffffff" },
      onClick: () => this._showCalculator(),
    }));

    screen.add(new Button({
      x: startX + btnW + gap, y: btnY, w: btnW, h: btnH,
      text: "Exit",
      fill: "#3a3a3a",
      stroke: "#888888",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: btnFont, color: "#ffffff" },
      onClick: () => this.exit(),
    }));

    return screen;
  }

  _buildCalculator() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mobile = Viewport.isMobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#1b2a1b",
      stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: "#3a3a3a",
      stroke: "#888888",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._showLanding(),
    }));

    // Body width: 420 on desktop, near-full-width on mobile with a
    // margin so keys stay comfortably tappable.
    const bodyW = mobile ? W - 80 : 420;
    const bodyX = (W - bodyW) / 2;
    const bodyY = mobile ? 130 : 110;

    const displayH = mobile ? 120 : 90;
    const display = new Panel({
      x: bodyX, y: bodyY,
      w: bodyW, h: displayH,
      fill: "#0e180e",
      stroke: "#3f7f3f",
      strokeWidth: 2,
      radius: 8,
    });
    screen.add(display);

    this.displayLabel = new Label({
      x: 0, y: 0,
      w: "100%", h: "100%",
      text: "0",
      textOptions: {
        font: mobile ? "bold 64px monospace" : "bold 48px monospace",
        color: "#cfe8cf",
        align: "right",
        baseline: "middle",
      },
    });
    display.add(this.displayLabel);

    this.displayLabel.text.x = "90%";
    this.displayLabel.text.y = "50%";

    const keypadY = bodyY + displayH + 20;
    const cols    = 4;
    const rows    = 5;
    const keyGap  = 10;
    const keyW    = (bodyW - (cols - 1) * keyGap) / cols;
    const keyH    = mobile ? 100 : 64;
    const keypadH = rows * keyH + (rows - 1) * keyGap;

    const keypad = new Panel({
      x: bodyX, y: keypadY,
      w: bodyW, h: keypadH,
      fill: "#162216",
      stroke: "#2f4a2f",
      strokeWidth: 2,
      radius: 8,
    });
    screen.add(keypad);

    const layout = [
      ["C", "/", "*", "-"],
      ["7", "8", "9", "+"],
      ["4", "5", "6", "="],
      ["1", "2", "3", ""],
      ["0", ".", "", ""],
    ];

    const keyFont = mobile ? "bold 36px sans-serif" : "bold 24px sans-serif";

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const label = layout[r][c];
        if (label === "") continue;

        const x = c * (keyW + keyGap);
        const y = r * (keyH + keyGap);

        keypad.add(new Button({
          x, y, w: keyW, h: keyH,
          text: label,
          fill:        this._keyFill(label),
          stroke:      this._keyStroke(label),
          strokeWidth: 2,
          radius:      6,
          textOptions: { font: keyFont, color: "#ffffff" },
          onClick:     () => this._onKey(label),
        }));
      }
    }

    return screen;
  }

  _keyFill(label) {
    if (label === "=") return "#3f7f3f";
    if ("/*-+".includes(label)) return "#2a4a2a";
    if (label === "C") return "#5a2a2a";
    return "#243024";
  }

  _keyStroke(label) {
    if (label === "=") return "#7bc07b";
    if ("/*-+".includes(label)) return "#4f8f4f";
    if (label === "C") return "#a06060";
    return "#3f5a3f";
  }

  _showLanding() {
    this.landingScreen.visible = true;
    this.calcScreen.visible    = false;
    this._reset();
  }

  _showCalculator() {
    this._reset();
    this.landingScreen.visible = false;
    this.calcScreen.visible    = true;
  }

  _reset() {
    this.entry  = "0";
    this.stored = null;
    this.op     = null;
    this.fresh  = true;
    this._updateDisplay();
  }

  _updateDisplay() {
    this.displayLabel.setText(this.entry);
  }

  _onKey(label) {
    if (label >= "0" && label <= "9") {
      this._inputDigit(label);
    } else if (label === ".") {
      this._inputDecimal();
    } else if (label === "C") {
      this._reset();
    } else if (label === "=") {
      this._equals(false);
    } else {
      this._operator(label);
    }
  }

  _inputDigit(d) {
    if (this.fresh) {
      this.entry = d;
      this.fresh = false;
    } else {
      this.entry = this.entry === "0" ? d : this.entry + d;
    }
    this._updateDisplay();
  }

  _inputDecimal() {
    if (this.fresh) {
      this.entry = "0.";
      this.fresh = false;
    } else if (!this.entry.includes(".")) {
      this.entry += ".";
    }
    this._updateDisplay();
  }

  _operator(op) {
    if (this.op !== null && !this.fresh) {
      this._equals(true);
    }
    this.stored = parseFloat(this.entry);
    this.op     = op;
    this.fresh  = true;
  }

  _equals(silent) {
    if (this.op === null || this.stored === null) return;

    const rhs = parseFloat(this.entry);
    let result;
    switch (this.op) {
      case "+": result = this.stored + rhs; break;
      case "-": result = this.stored - rhs; break;
      case "*": result = this.stored * rhs; break;
      case "/": result = rhs === 0 ? NaN : this.stored / rhs; break;
      default:  return;
    }

    const text = Number.isNaN(result) ? "Error" : this._format(result);

    this.entry  = text;
    this.stored = silent ? result : null;
    if (!silent) this.op = null;
    this.fresh  = true;
    this._updateDisplay();
  }

  _format(n) {
    if (!Number.isFinite(n)) return "Error";
    const s = parseFloat(n.toPrecision(12)).toString();
    return s.length > 14 ? n.toExponential(6) : s;
  }
}