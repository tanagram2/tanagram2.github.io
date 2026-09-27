// Tetris.
//
// Structure: landing screen (Start / High Scores / Exit), a high
// scores screen (Return + up to 10 rows), and a play screen (score /
// level / lines readouts, the well, a next-piece preview, a Return
// button, a Pause button, and a game-over overlay).
//
// Board is 10 x 20 cells. Cell size and well position come from
// Viewport so the same code lays out for desktop (1280x720) and
// mobile (720x1280).
//
// On desktop, the well + info column are treated as one block and
// centered horizontally. The block width is well + gap + preview-box
// width. The hint text lines extend a bit further right but are
// low-contrast and not counted as visual mass. Return and Pause sit
// at top-left and top-right, mirroring each other.
//
// Tetrominoes are the 7 standard pieces. Each piece is defined as four
// rotation states, each a list of {x, y} cell offsets in a 4x4 box.
// No runtime rotation math: rotating means swapping to the next
// precomputed state and checking collision.
//
// Rotation is simple (no SRS wall kicks). A rotation that would collide
// does nothing.
//
// Mobile gestures, on the play screen only, no overlay up:
//   - Tap in the well           -> rotate CW.
//   - Horizontal drag           -> move left/right, one cell per step.
//   - Vertical drag down        -> soft drop (same as holding Down).
//   - Classification is one-shot per gesture: whichever axis crosses
//     its threshold first wins, and stays. If ambiguous we favor
//     horizontal, so an uncertain gesture never drops the piece.
//   - No CCW, no hard drop via gesture.
//
// Mobile controls strip (hidden by default, Show/Hide toggle), below
// the well. Contains CCW / CW on top and a directional pad below
// (left, right, down, double-down). Hidden while an overlay is up.
//
// High score entry matches Snake: 3 initials via the shared Keyboard
// composite on mobile, physical keyboard on desktop.
//
// No Layer. The well is a fixed grid of Rect views repainted each
// frame from a small occupancy array.

import { App }      from "./App.js";
import { Rect }     from "../primitives/Rect.js";
import { Text }     from "../primitives/Text.js";
import { Panel }    from "../composites/Panel.js";
import { Button }   from "../composites/Button.js";
import { Label }    from "../composites/Label.js";
import { Keyboard } from "../composites/Keyboard.js";
import { Composite } from "../composites/Composite.js";
import { Viewport } from "../systems/Viewport.js";

// ---- Board geometry (desktop values; mobile overrides in init) ----
const COLS = 10;
const ROWS = 20;

// Desktop layout.
const D_CELL   = 30;
const D_WELL_W = COLS * D_CELL;   // 300
const D_WELL_H = ROWS * D_CELL;   // 600
const D_WELL_Y = 60;

// Desktop gap between well and info column. Info column width used
// for centering is derived from the preview box (4 * CELL), not a
// hand-guessed number.
const D_INFO_GAP = 60;

// Mobile layout. Smaller cell so the well fits the 720-wide box with
// margin, and the info column can live below it.
const M_CELL   = 26;
const M_WELL_W = COLS * M_CELL;   // 260
const M_WELL_H = ROWS * M_CELL;   // 520
const M_WELL_Y = 130;

// ---- Timing / scoring ----
const LINES_PER_LEVEL = 10;
const BASE_GRAVITY    = 0.8;
const GRAVITY_FLOOR   = 0.08;

const LINE_SCORES = [0, 100, 300, 500, 800];

const MAX_SCORES   = 10;
const INITIALS_LEN = 3;

// ---- Gesture tuning (virtual px) ----
const SWIPE_H_THRESHOLD = 20;   // horizontal lock-in distance
const SWIPE_V_THRESHOLD = 40;   // vertical lock-in distance (higher: err horizontal)
const SWIPE_STEP        = 24;   // finger travel per horizontal cell move
const TAP_MAX_MS        = 220;  // tap must be shorter than this
const TAP_MAX_DIST      = 8;    // and travel less than this

// ---- Tetromino definitions ----

const PIECES = {
  I: {
    color: "#3ac8d8",
    states: [
      [{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:3,y:1}],
      [{x:2,y:0},{x:2,y:1},{x:2,y:2},{x:2,y:3}],
      [{x:0,y:2},{x:1,y:2},{x:2,y:2},{x:3,y:2}],
      [{x:1,y:0},{x:1,y:1},{x:1,y:2},{x:1,y:3}],
    ],
  },
  O: {
    color: "#e8d04a",
    states: [
      [{x:1,y:0},{x:2,y:0},{x:1,y:1},{x:2,y:1}],
      [{x:1,y:0},{x:2,y:0},{x:1,y:1},{x:2,y:1}],
      [{x:1,y:0},{x:2,y:0},{x:1,y:1},{x:2,y:1}],
      [{x:1,y:0},{x:2,y:0},{x:1,y:1},{x:2,y:1}],
    ],
  },
  T: {
    color: "#b45ad8",
    states: [
      [{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:2,y:1}],
      [{x:1,y:0},{x:1,y:1},{x:2,y:1},{x:1,y:2}],
      [{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:1,y:2}],
      [{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:1,y:2}],
    ],
  },
  S: {
    color: "#5ad85a",
    states: [
      [{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:1,y:1}],
      [{x:1,y:0},{x:1,y:1},{x:2,y:1},{x:2,y:2}],
      [{x:1,y:1},{x:2,y:1},{x:0,y:2},{x:1,y:2}],
      [{x:0,y:0},{x:0,y:1},{x:1,y:1},{x:1,y:2}],
    ],
  },
  Z: {
    color: "#d85a5a",
    states: [
      [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:2,y:1}],
      [{x:2,y:0},{x:1,y:1},{x:2,y:1},{x:1,y:2}],
      [{x:0,y:1},{x:1,y:1},{x:1,y:2},{x:2,y:2}],
      [{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:0,y:2}],
    ],
  },
  J: {
    color: "#5a7fd8",
    states: [
      [{x:0,y:0},{x:0,y:1},{x:1,y:1},{x:2,y:1}],
      [{x:1,y:0},{x:2,y:0},{x:1,y:1},{x:1,y:2}],
      [{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:2,y:2}],
      [{x:1,y:0},{x:1,y:1},{x:0,y:2},{x:1,y:2}],
    ],
  },
  L: {
    color: "#e8963a",
    states: [
      [{x:2,y:0},{x:0,y:1},{x:1,y:1},{x:2,y:1}],
      [{x:1,y:0},{x:1,y:1},{x:1,y:2},{x:2,y:2}],
      [{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:0,y:2}],
      [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:1,y:2}],
    ],
  },
};

const PIECE_KEYS = ["I", "O", "T", "S", "Z", "J", "L"];

export class Tetris extends App {
  static displayName = "Tetris";

  init() {
    // Session-only high scores. Shape matches Snake: {initials, score}.
    this.highScores = [];

    // Run state. Reset by _startRun.
    this.grid         = null;
    this.piece        = null;
    this.nextKey      = null;
    this.gravityTimer = 0;
    this.score        = 0;
    this.lines        = 0;
    this.level        = 0;
    this.alive        = false;
    this.over         = false;
    this.paused       = false;

    // Death / initials state.
    this.initials    = "AAA";
    this.initialsIdx = 0;
    this.scoreSaved  = false;

    // Gesture state (mobile only).
    this._gActive       = false;
    this._gMode         = null;
    this._gStartX       = 0;
    this._gStartY       = 0;
    this._gStartTime    = 0;
    this._gLastCellX    = 0;
    this._gSoftDrop     = false;

    // Mobile controls visibility.
    this.controlsVisible = false;

    // Layout constants. Desktop: well + info column centered as one
    // block, with info width derived from the preview box.
    const mobile = Viewport.isMobile;
    const W = Viewport.width;

    this._cell  = mobile ? M_CELL  : D_CELL;
    this._wellW = mobile ? M_WELL_W : D_WELL_W;
    this._wellH = mobile ? M_WELL_H : D_WELL_H;
    this._wellY = mobile ? M_WELL_Y : D_WELL_Y;

    if (mobile) {
      this._wellX = (W - this._wellW) / 2;
    } else {
      const infoW  = 4 * this._cell;
      const blockW = this._wellW + D_INFO_GAP + infoW;
      const blockX = (W - blockW) / 2;
      this._wellX  = blockX;
    }

    this.blockRects  = [];
    this.activeRects = [];
    this.nextRects   = [];

    this.landingScreen = this._buildLanding();
    this.scoresScreen  = this._buildScoresScreen();
    this.playScreen    = this._buildPlayScreen();
    this.root.add(this.landingScreen);
    this.root.add(this.scoresScreen);
    this.root.add(this.playScreen);

    this._showLanding();
  }

  // ---------- Screens ----------

  _buildLanding() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mobile = Viewport.isMobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#141020",
      stroke: null,
    });

    const titleFont = mobile ? "bold 56px sans-serif" : "bold 56px sans-serif";
    const titleY    = mobile ? H * 0.35 : 200;

    screen.add(new Label({
      x: W / 2, y: titleY,
      text: "Tetris",
      textOptions: {
        font: titleFont,
        color: "#d8cfee",
        align: "center",
        baseline: "middle",
      },
    }));

    const btnW = mobile ? 380 : 260;
    const btnH = mobile ? 72 : 64;
    const gap  = 20;
    const btnX = (W - btnW) / 2;
    let   btnY = mobile ? H * 0.5 : 320;

    screen.add(new Button({
      x: btnX, y: btnY, w: btnW, h: btnH,
      text: "Start",
      fill: "#5a3f9f",
      stroke: "#9b7bdb",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 22px sans-serif", color: "#ffffff" },
      onClick: () => this._startRun(),
    }));

    btnY += btnH + gap;
    screen.add(new Button({
      x: btnX, y: btnY, w: btnW, h: btnH,
      text: "High Scores",
      fill: "#2a2440",
      stroke: "#5f5480",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 22px sans-serif", color: "#ffffff" },
      onClick: () => this._showScores(),
    }));

    btnY += btnH + gap;
    screen.add(new Button({
      x: btnX, y: btnY, w: btnW, h: btnH,
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

  _buildScoresScreen() {
    const W = Viewport.width;
    const mobile = Viewport.isMobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#141020",
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

    screen.add(new Label({
      x: W / 2, y: mobile ? 140 : 90,
      text: "High Scores",
      textOptions: {
        font: "bold 40px sans-serif",
        color: "#d8cfee",
        align: "center",
        baseline: "middle",
      },
    }));

    this.scoreRows = [];
    const rowW   = mobile ? 560 : 400;
    const rowH   = 40;
    const rowGap = 6;
    const rowX   = (W - rowW) / 2;
    const rowY0  = mobile ? 240 : 170;

    for (let i = 0; i < MAX_SCORES; i++) {
      const y = rowY0 + i * (rowH + rowGap);
      const rank = new Text({
        x: rowX, y: y + rowH / 2,
        text: String(i + 1).padStart(2, " ") + ".",
        font: "20px monospace",
        color: "#8f88a8",
        align: "left",
        baseline: "middle",
      });
      const who = new Text({
        x: rowX + 60, y: y + rowH / 2,
        text: "---",
        font: "bold 22px monospace",
        color: "#d8cfee",
        align: "left",
        baseline: "middle",
      });
      const pts = new Text({
        x: rowX + rowW, y: y + rowH / 2,
        text: "---",
        font: "bold 22px monospace",
        color: "#d8cfee",
        align: "right",
        baseline: "middle",
      });
      screen.add(rank);
      screen.add(who);
      screen.add(pts);
      this.scoreRows.push({ rank, who, pts });
    }

    return screen;
  }

  _buildPlayScreen() {
    const W = Viewport.width;
    const mobile = Viewport.isMobile;
    const CELL = this._cell;
    const WX = this._wellX;
    const WY = this._wellY;
    const WW = this._wellW;
    const WH = this._wellH;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#141020",
      stroke: null,
    });

    // Return, top-left. Pause mirrored to top-right.
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

    screen.add(new Button({
      x: W - 164, y: 24, w: 140, h: 48,
      text: "Pause",
      fill: "#2a3552",
      stroke: "#6a86b8",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._pause(),
    }));

    // Well backdrop.
    screen.add(new Rect({
      x: WX, y: WY, w: WW, h: WH,
      fill: "#0a0712",
      stroke: "#3f3560",
      strokeWidth: 2,
    }));

    // Locked cells.
    this.blockRects = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        const rect = new Rect({
          x: WX + c * CELL + 1,
          y: WY + r * CELL + 1,
          w: CELL - 2,
          h: CELL - 2,
          fill: "#000000",
          stroke: null,
          radius: 2,
          visible: false,
        });
        screen.add(rect);
        row.push(rect);
      }
      this.blockRects.push(row);
    }

    // Active piece.
    this.activeRects = [];
    for (let i = 0; i < 4; i++) {
      const rect = new Rect({
        x: 0, y: 0, w: CELL - 2, h: CELL - 2,
        fill: "#ffffff",
        stroke: null,
        radius: 2,
        visible: false,
      });
      screen.add(rect);
      this.activeRects.push(rect);
    }

    if (mobile) {
      this._buildMobileInfo(screen);
    } else {
      this._buildDesktopInfo(screen);
    }

    // Game-over overlay.
    this.overOverlay = this._buildOverOverlay();
    screen.add(this.overOverlay);

    // Pause overlay.
    this.pauseOverlay = this._buildPauseOverlay();
    screen.add(this.pauseOverlay);

    // Mobile controls strip.
    this.controlsStrip  = null;
    this.controlsToggle = null;
    this.dpadButtons    = [];

    if (mobile) {
      this._buildControlsStrip(screen);
    }

    return screen;
  }

  _buildDesktopInfo(screen) {
    const CELL = this._cell;
    const infoX = this._wellX + this._wellW + D_INFO_GAP;
    const infoY = this._wellY;

    this.scoreLabel = new Label({
      x: infoX, y: infoY,
      text: "Score: 0",
      textOptions: {
        font: "bold 24px monospace",
        color: "#d8cfee",
        align: "left",
        baseline: "top",
      },
    });
    screen.add(this.scoreLabel);

    this.levelLabel = new Label({
      x: infoX, y: infoY + 44,
      text: "Level: 0",
      textOptions: {
        font: "bold 20px monospace",
        color: "#a89cc8",
        align: "left",
        baseline: "top",
      },
    });
    screen.add(this.levelLabel);

    this.linesLabel = new Label({
      x: infoX, y: infoY + 80,
      text: "Lines: 0",
      textOptions: {
        font: "bold 20px monospace",
        color: "#a89cc8",
        align: "left",
        baseline: "top",
      },
    });
    screen.add(this.linesLabel);

    const nextBoxW = 4 * CELL;
    const nextBoxH = 4 * CELL;
    const nextBoxX = infoX;
    const nextBoxY = infoY + 140;

    screen.add(new Text({
      x: nextBoxX, y: nextBoxY - 26,
      text: "Next",
      font: "bold 18px sans-serif",
      color: "#a89cc8",
      align: "left",
      baseline: "top",
    }));

    screen.add(new Rect({
      x: nextBoxX, y: nextBoxY, w: nextBoxW, h: nextBoxH,
      fill: "#0a0712",
      stroke: "#3f3560",
      strokeWidth: 2,
    }));

    this.nextRects = [];
    for (let i = 0; i < 4; i++) {
      const rect = new Rect({
        x: 0, y: 0, w: CELL - 2, h: CELL - 2,
        fill: "#ffffff",
        stroke: null,
        radius: 2,
        visible: false,
      });
      screen.add(rect);
      this.nextRects.push(rect);
    }
    this._nextBoxX  = nextBoxX;
    this._nextBoxY  = nextBoxY;
    this._nextCell  = CELL;

    screen.add(new Text({
      x: infoX, y: nextBoxY + nextBoxH + 40,
      text: "Arrows: move/rotate",
      font: "14px monospace",
      color: "#6f6490",
      align: "left",
      baseline: "top",
    }));
    screen.add(new Text({
      x: infoX, y: nextBoxY + nextBoxH + 62,
      text: "Down: soft drop",
      font: "14px monospace",
      color: "#6f6490",
      align: "left",
      baseline: "top",
    }));
    screen.add(new Text({
      x: infoX, y: nextBoxY + nextBoxH + 84,
      text: "Space: hard drop",
      font: "14px monospace",
      color: "#6f6490",
      align: "left",
      baseline: "top",
    }));
  }

  _buildMobileInfo(screen) {
    const CELL = this._cell;
    const W = Viewport.width;

    const stripY = this._wellY + this._wellH + 14;
    const infoX  = 60;

    this.scoreLabel = new Label({
      x: infoX, y: stripY,
      text: "Score: 0",
      textOptions: {
        font: "bold 22px monospace",
        color: "#d8cfee",
        align: "left",
        baseline: "top",
      },
    });
    screen.add(this.scoreLabel);

    this.levelLabel = new Label({
      x: infoX, y: stripY + 32,
      text: "Level: 0",
      textOptions: {
        font: "bold 18px monospace",
        color: "#a89cc8",
        align: "left",
        baseline: "top",
      },
    });
    screen.add(this.levelLabel);

    this.linesLabel = new Label({
      x: infoX, y: stripY + 60,
      text: "Lines: 0",
      textOptions: {
        font: "bold 18px monospace",
        color: "#a89cc8",
        align: "left",
        baseline: "top",
      },
    });
    screen.add(this.linesLabel);

    const nextBoxW = 4 * CELL;
    const nextBoxH = 4 * CELL;
    const nextBoxX = W - nextBoxW - 40;
    const nextBoxY = stripY;

    screen.add(new Text({
      x: nextBoxX, y: nextBoxY - 26,
      text: "Next",
      font: "bold 16px sans-serif",
      color: "#a89cc8",
      align: "left",
      baseline: "top",
    }));

    screen.add(new Rect({
      x: nextBoxX, y: nextBoxY, w: nextBoxW, h: nextBoxH,
      fill: "#0a0712",
      stroke: "#3f3560",
      strokeWidth: 2,
    }));

    this.nextRects = [];
    for (let i = 0; i < 4; i++) {
      const rect = new Rect({
        x: 0, y: 0, w: CELL - 2, h: CELL - 2,
        fill: "#ffffff",
        stroke: null,
        radius: 2,
        visible: false,
      });
      screen.add(rect);
      this.nextRects.push(rect);
    }
    this._nextBoxX = nextBoxX;
    this._nextBoxY = nextBoxY;
    this._nextCell = CELL;
  }

  _buildControlsStrip(screen) {
    const stripY = this._wellY + this._wellH + 120;
    const stripW = Viewport.width;

    this.controlsStrip = new Composite({
      x: 0, y: stripY,
      w: stripW,
      h: Viewport.height - stripY,
    });
    screen.add(this.controlsStrip);

    const toggleW = 300;
    const toggleH = 56;
    const toggleX = (stripW - toggleW) / 2;
    const toggleY = 0;

    this.controlsToggle = new Button({
      x: toggleX, y: toggleY, w: toggleW, h: toggleH,
      text: "Show Controls",
      fill: "#2a2440",
      stroke: "#5f5480",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 22px sans-serif", color: "#d8cfee" },
      onClick: () => this._toggleControls(),
    });
    this.controlsStrip.add(this.controlsToggle);

    const btnSize = 90;
    const gap     = 10;
    const centerX = stripW / 2;
    const top     = toggleH + 20;

    const defs = [
      { text: "CCW", kind: "rotateCCW",
        x: centerX - btnSize - gap / 2 - btnSize,
        y: top },
      { text: "CW",  kind: "rotateCW",
        x: centerX + gap / 2 + btnSize,
        y: top },

      { text: "<",   kind: "left",
        x: centerX - btnSize - gap / 2,
        y: top + btnSize + gap },
      { text: ">",   kind: "right",
        x: centerX + gap / 2,
        y: top + btnSize + gap },

      { text: "v",   kind: "down",
        x: centerX - btnSize / 2,
        y: top + 2 * (btnSize + gap) },

      { text: "vv",  kind: "hardDrop",
        x: centerX - btnSize / 2,
        y: top + 3 * (btnSize + gap) },
    ];

    for (const d of defs) {
      const b = new Button({
        x: d.x, y: d.y, w: btnSize, h: btnSize,
        text: d.text,
        fill: "#2a2440",
        stroke: "#5f5480",
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 28px sans-serif", color: "#d8cfee" },
        onClick: () => this._onControlButton(d.kind),
      });
      b.visible = false;
      this.controlsStrip.add(b);
      this.dpadButtons.push(b);
    }
  }

  _onControlButton(kind) {
    if (!this.alive || this.paused) return;
    switch (kind) {
      case "rotateCW":
        if (this._tryRotateCW()) this._repaintActive();
        break;
      case "rotateCCW":
        if (this._tryRotateCCW()) this._repaintActive();
        break;
      case "left":
        if (this._tryMove(-1, 0)) this._repaintActive();
        break;
      case "right":
        if (this._tryMove(1, 0)) this._repaintActive();
        break;
      case "down":
        this._softDropStep();
        break;
      case "hardDrop":
        this._hardDrop();
        break;
    }
  }

  _toggleControls() {
    this.controlsVisible = !this.controlsVisible;
    this._applyControlsLayout();
  }

  _applyControlsLayout() {
    const show = this.controlsVisible;
    for (const b of this.dpadButtons) {
      b.visible = show;
    }
    if (this.controlsToggle) {
      this.controlsToggle.setText(show ? "Hide Controls" : "Show Controls");
    }
  }

  _setControlsStripVisible(on) {
    if (this.controlsStrip) {
      this.controlsStrip.visible = on;
    }
  }

  _buildOverOverlay() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mobile = Viewport.isMobile;

    const overlay = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      self: new Rect({ fill: "rgba(0, 0, 0, 0.6)", stroke: null }),
    });

    const panelW = mobile ? 620 : 520;
    const panelH = mobile ? 700 : 380;
    const panelX = (W - panelW) / 2;
    const panelY = (H - panelH) / 2;

    const panel = new Panel({
      x: panelX, y: panelY,
      w: panelW, h: panelH,
      fill: "#2a1840",
      stroke: "#9b7bdb",
      strokeWidth: 3,
      radius: 12,
    });
    overlay.add(panel);

    const title = new Label({
      x: 0, y: 0, w: "100%", h: 0,
      text: "Game Over",
      textOptions: {
        font: "bold 40px sans-serif",
        color: "#e8dff8",
        align: "center",
        baseline: "middle",
      },
    });
    panel.add(title);
    title.text.x = "50%";
    title.text.y = 70;

    this.overScoreLabel = new Label({
      x: 0, y: 0, w: "100%", h: 0,
      text: "Score: 0",
      textOptions: {
        font: "bold 26px monospace",
        color: "#d8cfee",
        align: "center",
        baseline: "middle",
      },
    });
    panel.add(this.overScoreLabel);
    this.overScoreLabel.text.x = "50%";
    this.overScoreLabel.text.y = 120;

    this.overPromptLabel = new Label({
      x: 0, y: 0, w: "100%", h: 0,
      text: "New high score! Type initials and hit Enter:",
      textOptions: {
        font: "18px sans-serif",
        color: "#c8b8e8",
        align: "center",
        baseline: "middle",
      },
    });
    panel.add(this.overPromptLabel);
    this.overPromptLabel.text.x = "50%";
    this.overPromptLabel.text.y = 165;

    this.initialsLabel = new Text({
      x: panelW / 2, y: 220,
      text: "A A A",
      font: "bold 44px monospace",
      color: "#ffffff",
      align: "center",
      baseline: "middle",
    });
    panel.add(this.initialsLabel);

    this.mobileKeyboard  = null;
    this.mobileBackspace = null;
    this.mobileEnter     = null;

    if (mobile) {
      const kbMargin = 40;
      const kbW      = panelW - kbMargin * 2;
      const kbX      = kbMargin;
      const kbY      = 270;

      this.mobileKeyboard = new Keyboard({
        x: kbX, y: kbY,
        w: kbW,
        onKey: (char) => this._handleInitialsKey(char),
      });
      panel.add(this.mobileKeyboard);

      const kbH  = this.mobileKeyboard.h;
      const rowY = kbY + kbH + 16;
      const btnW = (kbW - 16) / 2;
      const btnH = 56;

      this.mobileBackspace = new Button({
        x: kbX, y: rowY, w: btnW, h: btnH,
        text: "Backspace",
        fill: "#3a2a2a",
        stroke: "#8f6060",
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._handleInitialsKey("Backspace"),
      });
      panel.add(this.mobileBackspace);

      this.mobileEnter = new Button({
        x: kbX + btnW + 16, y: rowY, w: btnW, h: btnH,
        text: "Enter",
        fill: "#5a3f9f",
        stroke: "#9b7bdb",
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._handleInitialsKey("Enter"),
      });
      panel.add(this.mobileEnter);
    }

    const btnW = 160, btnH = 56, gap = 24;
    const totalW = btnW * 2 + gap;
    const startX = (panelW - totalW) / 2;
    const btnY   = panelH - 90;

    panel.add(new Button({
      x: startX, y: btnY, w: btnW, h: btnH,
      text: "Retry",
      fill: "#5a3f9f",
      stroke: "#9b7bdb",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
      onClick: () => this._startRun(),
    }));

    panel.add(new Button({
      x: startX + btnW + gap, y: btnY, w: btnW, h: btnH,
      text: "Exit",
      fill: "#3a3a3a",
      stroke: "#888888",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
      onClick: () => this._showLanding(),
    }));

    overlay.visible = false;
    this._setInitialsEntryVisible(false);
    return overlay;
  }

  _setInitialsEntryVisible(on) {
    this.initialsLabel.visible = on;
    if (this.mobileKeyboard)  this.mobileKeyboard.visible  = on;
    if (this.mobileBackspace) this.mobileBackspace.visible = on;
    if (this.mobileEnter)     this.mobileEnter.visible     = on;
  }

  _buildPauseOverlay() {
    const W = Viewport.width;
    const H = Viewport.height;

    const overlay = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      self: new Rect({ fill: "rgba(0, 0, 0, 0.5)", stroke: null }),
    });

    const panelW = 420;
    const panelH = 220;
    const panelX = (W - panelW) / 2;
    const panelY = (H - panelH) / 2;

    const panel = new Panel({
      x: panelX, y: panelY,
      w: panelW, h: panelH,
      fill: "#1a1838",
      stroke: "#6a86b8",
      strokeWidth: 3,
      radius: 12,
    });
    overlay.add(panel);

    const title = new Label({
      x: 0, y: 0, w: "100%", h: 0,
      text: "Paused",
      textOptions: {
        font: "bold 40px sans-serif",
        color: "#d8e4f7",
        align: "center",
        baseline: "middle",
      },
    });
    panel.add(title);
    title.text.x = "50%";
    title.text.y = 60;

    const btnW = 260, btnH = 64;
    const btnX = (panelW - btnW) / 2;
    const btnY = panelH - 90;

    panel.add(new Button({
      x: btnX, y: btnY, w: btnW, h: btnH,
      text: "Unpause",
      fill: "#2a3552",
      stroke: "#6a86b8",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 22px sans-serif", color: "#ffffff" },
      onClick: () => this._unpause(),
    }));

    overlay.visible = false;
    return overlay;
  }

  // ---------- Screen switching ----------

  _showLanding() {
    this.landingScreen.visible = true;
    this.scoresScreen.visible  = false;
    this.playScreen.visible    = false;
    this.overOverlay.visible   = false;
    this.pauseOverlay.visible  = false;
    this.alive  = false;
    this.over   = false;
    this.paused = false;
    this._clearGesture();
  }

  _showScores() {
    this._renderScores();
    this.landingScreen.visible = false;
    this.scoresScreen.visible  = true;
    this.playScreen.visible    = false;
  }

  _showPlay() {
    this.landingScreen.visible = false;
    this.scoresScreen.visible  = false;
    this.playScreen.visible    = true;
    this._setControlsStripVisible(true);
  }

  _renderScores() {
    for (let i = 0; i < MAX_SCORES; i++) {
      const row = this.scoreRows[i];
      const e   = this.highScores[i];
      if (e) {
        row.who.text = e.initials;
        row.pts.text = String(e.score);
      } else {
        row.who.text = "---";
        row.pts.text = "---";
      }
    }
  }

  // ---------- Pause ----------

  _pause() {
    if (!this.alive || this.over) return;
    this.paused = true;
    this.pauseOverlay.visible = true;
    this._setControlsStripVisible(false);
    this._clearGesture();
  }

  _unpause() {
    if (!this.paused) return;
    this.paused = false;
    this.pauseOverlay.visible = false;
    this._setControlsStripVisible(true);
  }

  // ---------- Run lifecycle ----------

  _startRun() {
    this.grid = [];
    for (let r = 0; r < ROWS; r++) {
      this.grid.push(new Array(COLS).fill(null));
    }

    this.score = 0;
    this.lines = 0;
    this.level = 0;
    this.gravityTimer = 0;
    this.alive = true;
    this.over  = false;
    this.paused = false;
    this.initials    = "AAA";
    this.initialsIdx = 0;
    this.scoreSaved  = false;

    this.nextKey = this._randomKey();
    this._spawnPiece();

    this._refreshReadouts();
    this._repaintGrid();
    this._repaintActive();
    this._repaintNext();
    this.overOverlay.visible  = false;
    this.pauseOverlay.visible = false;
    this._setInitialsEntryVisible(false);
    this._clearGesture();
    this._showPlay();
  }

  _randomKey() {
    return PIECE_KEYS[Math.floor(Math.random() * PIECE_KEYS.length)];
  }

  _spawnPiece() {
    const key = this.nextKey;
    this.nextKey = this._randomKey();

    const piece = { key, rot: 0, x: 3, y: 0 };

    if (this._collides(piece, piece.x, piece.y, piece.rot)) {
      this._gameOver();
      return;
    }
    this.piece = piece;
  }

  // ---------- Collision / rotation ----------

  _cellsOf(piece, rot) {
    return PIECES[piece.key].states[rot];
  }

  _collides(piece, px, py, rot) {
    const cells = this._cellsOf(piece, rot);
    for (const c of cells) {
      const gx = px + c.x;
      const gy = py + c.y;
      if (gx < 0 || gx >= COLS) return true;
      if (gy >= ROWS) return true;
      if (gy >= 0 && this.grid[gy][gx] != null) return true;
    }
    return false;
  }

  _tryMove(dx, dy) {
    const p = this.piece;
    if (!p) return false;
    if (this._collides(p, p.x + dx, p.y + dy, p.rot)) return false;
    p.x += dx;
    p.y += dy;
    return true;
  }

  _tryRotateCW() {
    const p = this.piece;
    if (!p) return false;
    const nr = (p.rot + 1) % 4;
    if (this._collides(p, p.x, p.y, nr)) return false;
    p.rot = nr;
    return true;
  }

  _tryRotateCCW() {
    const p = this.piece;
    if (!p) return false;
    const nr = (p.rot + 3) % 4;
    if (this._collides(p, p.x, p.y, nr)) return false;
    p.rot = nr;
    return true;
  }

  // ---------- Lock / clear ----------

  _lockPiece() {
    const p = this.piece;
    if (!p) return;
    const color = PIECES[p.key].color;
    const cells = this._cellsOf(p, p.rot);

    let topOut = false;
    for (const c of cells) {
      const gx = p.x + c.x;
      const gy = p.y + c.y;
      if (gy < 0) { topOut = true; continue; }
      this.grid[gy][gx] = color;
    }
    this.piece = null;

    if (topOut) {
      this._gameOver();
      return;
    }

    const cleared = this._clearLines();
    if (cleared > 0) {
      this.score += LINE_SCORES[cleared] * (this.level + 1);
      this.lines += cleared;
      const newLevel = Math.floor(this.lines / LINES_PER_LEVEL);
      if (newLevel > this.level) this.level = newLevel;
      this._refreshReadouts();
    }

    this._repaintGrid();
    this._spawnPiece();
    if (this.alive) this._repaintNext();
  }

  _clearLines() {
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.grid[r].every(c => c != null)) {
        this.grid.splice(r, 1);
        this.grid.unshift(new Array(COLS).fill(null));
        cleared++;
        r++;
      }
    }
    return cleared;
  }

  _gameOver() {
    this.alive = false;
    this.over  = true;
    this.paused = false;

    const isHigh = this._wouldMakeHighScore();
    this.scoreSaved  = false;
    this.initials    = "AAA";
    this.initialsIdx = 0;

    this.overScoreLabel.setText("Score: " + this.score);

    if (isHigh) {
      this.overPromptLabel.setText("New high score! Type initials and then press Enter:");
      this._refreshInitialsLabel();
      this._setInitialsEntryVisible(true);
    } else {
      this.overPromptLabel.setText("Press Retry or Exit.");
      this._setInitialsEntryVisible(false);
    }

    this._repaintActive();
    this.overOverlay.visible  = true;
    this.pauseOverlay.visible = false;
    this._setControlsStripVisible(false);
    this._clearGesture();
  }

  _wouldMakeHighScore() {
    if (this.highScores.length < MAX_SCORES) return true;
    return this.score > this.highScores[this.highScores.length - 1].score;
  }

  // ---------- Initials ----------

  _handleInitialsKey(key) {
    if (this.scoreSaved) return;

    if (key === "Backspace") {
      if (this.initialsIdx > 0) {
        this.initialsIdx--;
        this.initials = this._setChar(this.initials, this.initialsIdx, "A");
      }
    } else if (key === "Enter") {
      this._saveScore();
    } else if (key.length === 1) {
      const c = key.toUpperCase();
      if ((c >= "A" && c <= "Z") || (c >= "0" && c <= "9")) {
        this.initials = this._setChar(this.initials, this.initialsIdx, c);
        if (this.initialsIdx < INITIALS_LEN - 1) this.initialsIdx++;
      }
    }
    this._refreshInitialsLabel();
  }

  _setChar(str, i, c) {
    return str.slice(0, i) + c + str.slice(i + 1);
  }

  _refreshInitialsLabel() {
    let s = "";
    for (let i = 0; i < INITIALS_LEN; i++) {
      const ch = this.initials[i];
      if (i === this.initialsIdx && !this.scoreSaved) {
        s += "[" + ch + "]";
      } else {
        s += " " + ch + " ";
      }
    }
    this.initialsLabel.text = s;
  }

  _saveScore() {
    this.highScores.push({ initials: this.initials, score: this.score });
    this.highScores.sort((a, b) => b.score - a.score);
    if (this.highScores.length > MAX_SCORES) {
      this.highScores.length = MAX_SCORES;
    }
    this.scoreSaved = true;
    this.initialsLabel.text = "  " + this.initials + "  ";
    this.overPromptLabel.setText("Score saved.");
    this._setInitialsEntryVisible(false);
  }

  // ---------- Gravity ----------

  _gravityInterval() {
    const interval = BASE_GRAVITY - this.level * 0.06;
    return Math.max(GRAVITY_FLOOR, interval);
  }

  _softDropStep() {
    if (!this.alive || this.paused) return;
    if (this._tryMove(0, 1)) {
      this.score += 1;
      this._refreshReadouts();
      this.gravityTimer = 0;
      this._repaintActive();
    }
  }

  // ---------- Input ----------

  onEvent(e) {
    if (Viewport.isMobile
        && this.playScreen.visible
        && this.alive
        && !this.paused
        && !this.over) {
      if (e.type === "mousedown") {
        this._onGestureDown(e);
        return;
      }
      if (e.type === "mousemove") {
        if (this._gActive) {
          this._onGestureMove(e);
        }
        return;
      }
      if (e.type === "mouseup") {
        if (this._gActive) {
          this._onGestureUp(e);
        }
        return;
      }
    }

    if (e.type !== "keydown") return;
    if (!this.playScreen.visible) return;
    if (this.over) {
      this._handleInitialsKey(e.key);
      return;
    }
    if (this.paused) {
      if (e.key === " " || e.code === "Space") this._unpause();
      return;
    }
    if (!this.alive) return;

    switch (e.key) {
      case "ArrowLeft":  case "a": case "A":
        if (this._tryMove(-1, 0)) this._repaintActive();
        return;
      case "ArrowRight": case "d": case "D":
        if (this._tryMove(1, 0)) this._repaintActive();
        return;
      case "ArrowDown":  case "s": case "S":
        this._softDropStep();
        return;
      case "ArrowUp":    case "w": case "W":
        if (this._tryRotateCW()) this._repaintActive();
        return;
      case " ":
        this._hardDrop();
        return;
    }
  }

  // ---------- Gesture handling ----------

  _onGestureDown(e) {
    if (!this._inWell(e.x, e.y)) return;

    this._gActive    = true;
    this._gMode      = null;
    this._gStartX    = e.x;
    this._gStartY    = e.y;
    this._gStartTime = performance.now();
    this._gLastCellX = 0;
    this._gSoftDrop  = false;
  }

  _onGestureMove(e) {
    const dx = e.x - this._gStartX;
    const dy = e.y - this._gStartY;

    if (this._gMode === null) {
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      if (adx >= SWIPE_H_THRESHOLD && adx >= ady) {
        this._gMode = "h";
        this._gLastCellX = 0;
      } else if (ady >= SWIPE_V_THRESHOLD && ady > adx) {
        this._gMode = "v";
        this._gSoftDrop = true;
      }
      return;
    }

    if (this._gMode === "h") {
      const steps = Math.trunc(dx / SWIPE_STEP);
      const delta = steps - this._gLastCellX;
      if (delta !== 0) {
        const dir = delta > 0 ? 1 : -1;
        const n   = Math.abs(delta);
        for (let i = 0; i < n; i++) {
          if (!this._tryMove(dir, 0)) break;
        }
        this._gLastCellX = steps;
        this._repaintActive();
      }
      return;
    }
  }

  _onGestureUp(e) {
    if (this._gMode === null) {
      const dt = performance.now() - this._gStartTime;
      const dx = e.x - this._gStartX;
      const dy = e.y - this._gStartY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dt <= TAP_MAX_MS && dist <= TAP_MAX_DIST) {
        if (this._tryRotateCW()) this._repaintActive();
      }
    }
    this._clearGesture();
  }

  _clearGesture() {
    this._gActive    = false;
    this._gMode      = null;
    this._gSoftDrop  = false;
    this._gLastCellX = 0;
  }

  _inWell(x, y) {
    return x >= this._wellX && x < this._wellX + this._wellW
        && y >= this._wellY && y < this._wellY + this._wellH;
  }

  // ---------- Hard drop ----------

  _hardDrop() {
    const p = this.piece;
    if (!p) return;
    let dropped = 0;
    while (!this._collides(p, p.x, p.y + 1, p.rot)) {
      p.y += 1;
      dropped++;
    }
    this.score += dropped * 2;
    this._lockPiece();
    if (this.alive) {
      this._refreshReadouts();
      this._repaintActive();
    }
  }

  // ---------- Update ----------

  update(dt) {
    if (!this.playScreen.visible) return;
    if (!this.alive) return;
    if (this.paused) return;
    if (!this.piece) return;

    if (this._gSoftDrop) {
      this._softDropStep();
      if (!this.alive) return;
    }

    this.gravityTimer += dt;
    const interval = this._gravityInterval();

    while (this.gravityTimer >= interval) {
      this.gravityTimer -= interval;
      if (!this._tryMove(0, 1)) {
        this._lockPiece();
        if (!this.alive) return;
        break;
      }
    }

    this._repaintActive();
  }

  // ---------- Rendering helpers ----------

  _refreshReadouts() {
    this.scoreLabel.setText("Score: " + this.score);
    this.levelLabel.setText("Level: " + this.level);
    this.linesLabel.setText("Lines: " + this.lines);
  }

  _repaintGrid() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const rect = this.blockRects[r][c];
        const col  = this.grid[r][c];
        if (col == null) {
          rect.visible = false;
        } else {
          rect.visible = true;
          rect.fill    = col;
        }
      }
    }
  }

  _repaintActive() {
    const p = this.piece;
    if (!p) {
      for (const rect of this.activeRects) rect.visible = false;
      return;
    }

    const CELL  = this._cell;
    const color = PIECES[p.key].color;
    const cells = this._cellsOf(p, p.rot);

    for (let i = 0; i < 4; i++) {
      const rect = this.activeRects[i];
      const c    = cells[i];
      const gx   = p.x + c.x;
      const gy   = p.y + c.y;

      if (gy < 0) {
        rect.visible = false;
        continue;
      }

      rect.visible = true;
      rect.fill    = color;
      rect.x       = this._wellX + gx * CELL + 1;
      rect.y       = this._wellY + gy * CELL + 1;
      rect.w       = CELL - 2;
      rect.h       = CELL - 2;
    }
  }

  _repaintNext() {
    const CELL  = this._nextCell;
    const key   = this.nextKey;
    const color = PIECES[key].color;
    const cells = PIECES[key].states[0];

    const boxCX = this._nextBoxX + (4 * CELL) / 2;
    const boxCY = this._nextBoxY + (4 * CELL) / 2;
    const originX = boxCX - (4 * CELL) / 2;
    const originY = boxCY - (4 * CELL) / 2;

    for (let i = 0; i < 4; i++) {
      const rect = this.nextRects[i];
      const c    = cells[i];
      rect.visible = true;
      rect.fill    = color;
      rect.x       = originX + c.x * CELL + 1;
      rect.y       = originY + c.y * CELL + 1;
      rect.w       = CELL - 2;
      rect.h       = CELL - 2;
    }
  }
}