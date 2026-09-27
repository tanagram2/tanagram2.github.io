// Tetris.
//
// Structure: landing screen (Start / High Scores / Exit), a high
// scores screen (Return + up to 10 rows), and a play screen (score /
// level / lines readouts, the well, a next-piece preview, a Return
// button, and a game-over overlay).
//
// Board is 10 x 20 cells. Cell size is 30 virtual px, so the well is
// 300 x 600. The well sits left of center; the right column holds the
// score panel and the next-piece box.
//
// Tetrominoes are the 7 standard pieces. Each piece is defined as four
// rotation states, each a list of {x, y} cell offsets in a 4x4 box.
// No runtime rotation math: rotating means swapping to the next
// precomputed state and checking collision. This keeps the bug surface
// tiny and matches how Snake precomputes its direction deltas.
//
// Rotation is simple (no SRS wall kicks). A rotation that would collide
// does nothing. This is classic pre-SRS behavior, chosen deliberately.
//
// No Layer. The well is a fixed grid redrawn each frame from a small
// occupancy array, not a tree of per-cell Drawables. See _drawWell.

import { App }    from "./App.js";
import { Rect }   from "../primitives/Rect.js";
import { Text }   from "../primitives/Text.js";
import { Panel }  from "../composites/Panel.js";
import { Button } from "../composites/Button.js";
import { Label }  from "../composites/Label.js";

// ---- Board geometry ----
const COLS    = 10;
const ROWS    = 20;
const CELL    = 30;

const WELL_W  = COLS * CELL; // 300
const WELL_H  = ROWS * CELL; // 600
const WELL_X  = 200;
const WELL_Y  = 60;

// ---- Timing / scoring ----
const LINES_PER_LEVEL = 10;
const BASE_GRAVITY    = 0.8;   // seconds per cell at level 0
const GRAVITY_FLOOR   = 0.08;  // fastest interval
const SOFT_DROP_MULT  = 8;     // soft drop is 8x gravity speed

const LINE_SCORES = [0, 100, 300, 500, 800];

const MAX_SCORES = 10;

// ---- Tetromino definitions ----
//
// Each entry: color + four rotation states. A state is an array of
// four {x, y} cell offsets inside a 4x4 box (x right, y down).
// Rotation index 0 is the spawn orientation. States are listed in
// clockwise order.
//
// These are hand-written, not generated, so there is no rotation
// arithmetic to get wrong.

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
    // Session-only, on the instance.
    this.highScores = [];

    // Run state. Reset by _startRun.
    this.grid         = null;   // ROWS x COLS of color-or-null
    this.piece        = null;   // { key, rot, x, y }
    this.nextKey      = null;
    this.gravityTimer = 0;
    this.score        = 0;
    this.lines        = 0;
    this.level        = 0;
    this.alive        = false;
    this.over         = false;

    // The scene-tree pieces that change per frame. Built once, mutated.
    this.blockRects   = [];     // ROWS * COLS Rect views for the well
    this.activeRects  = [];     // 4 Rect views for the falling piece
    this.nextRects    = [];     // 4 Rect views for the next preview

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
    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#141020",
      stroke: null,
    });

    screen.add(new Label({
      x: 640, y: 200,
      text: "Tetris",
      textOptions: {
        font: "bold 56px sans-serif",
        color: "#d8cfee",
        align: "center",
        baseline: "middle",
      },
    }));

    const btnW = 260, btnH = 64, gap = 20;
    const btnX = (1280 - btnW) / 2;
    let   btnY = 320;

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
      x: 640, y: 90,
      text: "High Scores",
      textOptions: {
        font: "bold 40px sans-serif",
        color: "#d8cfee",
        align: "center",
        baseline: "middle",
      },
    }));

    this.scoreRows = [];
    const rowX = 440;
    const rowW = 400;
    const rowH = 40;
    const rowGap = 6;
    let   rowY = 170;

    for (let i = 0; i < MAX_SCORES; i++) {
      const y = rowY + i * (rowH + rowGap);
      const rank = new Text({
        x: rowX, y: y + rowH / 2,
        text: String(i + 1).padStart(2, " ") + ".",
        font: "20px monospace",
        color: "#8f88a8",
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
      screen.add(pts);
      this.scoreRows.push({ rank, pts });
    }

    return screen;
  }

  _buildPlayScreen() {
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

    // Well backdrop.
    screen.add(new Rect({
      x: WELL_X, y: WELL_Y, w: WELL_W, h: WELL_H,
      fill: "#0a0712",
      stroke: "#3f3560",
      strokeWidth: 2,
    }));

    // Locked cells. One Rect per cell, built once, repainted each
    // frame from the grid. Hidden when the cell is empty.
    this.blockRects = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        const rect = new Rect({
          x: WELL_X + c * CELL + 1,
          y: WELL_Y + r * CELL + 1,
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

    // Active falling piece. Four Rects, repositioned each frame.
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

    // Right column: score / level / lines readouts.
    const infoX = WELL_X + WELL_W + 60;
    const infoY = WELL_Y;

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

    // Next-piece preview box.
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
    this._nextBoxX = nextBoxX;
    this._nextBoxY = nextBoxY;

    // Controls hint.
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

    // Game-over overlay.
    this.overOverlay = this._buildOverOverlay();
    screen.add(this.overOverlay);

    return screen;
  }

  _buildOverOverlay() {
    const overlay = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      self: new Rect({ fill: "rgba(0, 0, 0, 0.6)", stroke: null }),
    });

    const panelW = 480;
    const panelH = 320;
    const panelX = (1280 - panelW) / 2;
    const panelY = (720 - panelH) / 2;

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
    title.text.y = 80;

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
    this.overScoreLabel.text.y = 140;

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
    return overlay;
  }

  // ---------- Screen switching ----------

  _showLanding() {
    this.landingScreen.visible = true;
    this.scoresScreen.visible  = false;
    this.playScreen.visible    = false;
    this.overOverlay.visible   = false;
    this.alive = false;
    this.over  = false;
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
  }

  _renderScores() {
    for (let i = 0; i < MAX_SCORES; i++) {
      const row = this.scoreRows[i];
      const s   = this.highScores[i];
      row.pts.text = s != null ? String(s) : "---";
    }
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

    this.nextKey = this._randomKey();
    this._spawnPiece();

    this._refreshReadouts();
    this._repaintGrid();
    this._repaintActive();
    this._repaintNext();
    this.overOverlay.visible = false;
    this._showPlay();
  }

  _randomKey() {
    return PIECE_KEYS[Math.floor(Math.random() * PIECE_KEYS.length)];
  }

  _spawnPiece() {
    const key = this.nextKey;
    this.nextKey = this._randomKey();

    // Spawn at x = 3 so the 4x4 box's filled columns land centered.
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

  _tryRotate() {
    const p = this.piece;
    if (!p) return false;
    const nr = (p.rot + 1) % 4;
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
        r++; // recheck the same index now that rows shifted down
      }
    }
    return cleared;
  }

  _gameOver() {
    this.alive = false;
    this.over  = true;

    this.highScores.push(this.score);
    this.highScores.sort((a, b) => b - a);
    if (this.highScores.length > MAX_SCORES) {
      this.highScores.length = MAX_SCORES;
    }

    this.overScoreLabel.setText("Score: " + this.score);
    this._repaintActive(); // will hide since piece is null
    this.overOverlay.visible = true;
  }

  // ---------- Gravity ----------

  _gravityInterval() {
    const interval = BASE_GRAVITY - this.level * 0.06;
    return Math.max(GRAVITY_FLOOR, interval);
  }

  // ---------- Input ----------

  onEvent(e) {
    if (e.type !== "keydown") return;
    if (!this.playScreen.visible) return;
    if (!this.alive) return;

    switch (e.key) {
      case "ArrowLeft":  case "a": case "A":
        if (this._tryMove(-1, 0)) this._repaintActive();
        return;
      case "ArrowRight": case "d": case "D":
        if (this._tryMove(1, 0)) this._repaintActive();
        return;
      case "ArrowDown":  case "s": case "S":
        // Soft drop: move down once. Score bonus per cell.
        if (this._tryMove(0, 1)) {
          this.score += 1;
          this._refreshReadouts();
          this.gravityTimer = 0;
          this._repaintActive();
        }
        return;
      case "ArrowUp":    case "w": case "W":
        if (this._tryRotate()) this._repaintActive();
        return;
      case " ":
        this._hardDrop();
        return;
    }
  }

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
    if (!this.piece) return;

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
      rect.x       = WELL_X + gx * CELL + 1;
      rect.y       = WELL_Y + gy * CELL + 1;
      rect.w       = CELL - 2;
      rect.h       = CELL - 2;
    }
  }

  _repaintNext() {
    const key   = this.nextKey;
    const color = PIECES[key].color;
    const cells = PIECES[key].states[0];

    // Center the 4x4 state inside the preview box.
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