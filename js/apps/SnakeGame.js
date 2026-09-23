// Snake.
//
// Structure: a landing screen (Start / High Scores / Exit), a high
// scores screen (Return + up to 10 rows), and a play screen (score
// Label, board Panel, Return top-left, and a death overlay).
//
// Movement model: the snake's logical position is a grid of cells.
// The head advances one cell per tick; between ticks every segment
// interpolates from its previous cell to its current cell so motion
// looks smooth. Turns only take effect at cell boundaries.
//
// Board: 160 x 120 cells of 5 virtual px each. The outermost ring of
// cells is wall (grey). The playable area is cells 1..158 x 1..118.
//
// No Layer. Segment count stays small enough that Composite + Rect
// children are trivially fast.

import { App }    from "./App.js";
import { Rect }   from "../primitives/Rect.js";
import { Circle } from "../primitives/Circle.js";
import { Line }   from "../primitives/Line.js";
import { Text }   from "../primitives/Text.js";
import { Panel }  from "../composites/Panel.js";
import { Button } from "../composites/Button.js";
import { Label }  from "../composites/Label.js";

// Board geometry, in virtual pixels.
const CELL      = 5;
const BOARD_X   = 240;
const BOARD_Y   = 90;
const BOARD_W   = 800;
const BOARD_H   = 600;
const COLS      = BOARD_W / CELL; // 160
const ROWS      = BOARD_H / CELL; // 120

// Playable cell range (inside the 1-cell wall ring).
const MIN_X = 1;
const MIN_Y = 1;
const MAX_X = COLS - 2;
const MAX_Y = ROWS - 2;

// Directions as cell deltas.
const DIR = {
  up:    { x:  0, y: -1 },
  down:  { x:  0, y:  1 },
  left:  { x: -1, y:  0 },
  right: { x:  1, y:  0 },
};

// Counter-clockwise bounce rule the user specified:
//   left wall  -> up
//   top wall   -> right
//   right wall -> down
//   bottom wall-> left
const BOUNCE = {
  left:  "up",
  up:    "right",
  right: "down",
  down:  "left",
};

const MAX_SCORES   = 10;
const INITIALS_LEN = 3;

export class SnakeGame extends App {
  static displayName = "Snake";

  init() {
    // Persistent across runs, per-session only.
    this.highScores = [];

    // Run state. Populated by _startRun().
    this.snake       = null;
    this.food        = null;
    this.score       = 0;
    this.dir         = "right";
    this.queuedDir   = null;
    this.tickTimer   = 0;
    this.tickDur     = 0.1;
    this.alive       = false;
    this.started     = false;

    // Death / initials state.
    this.dead        = false;
    this.initials    = "AAA";
    this.initialsIdx = 0;
    this.scoreSaved  = false;

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
      fill: "#101a10",
      stroke: null,
    });

    screen.add(new Label({
      x: 640, y: 200,
      text: "Snake",
      textOptions: {
        font: "bold 56px sans-serif",
        color: "#cfe8cf",
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
      fill: "#3f7f3f",
      stroke: "#7bc07b",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 22px sans-serif", color: "#ffffff" },
      onClick: () => this._startRun(),
    }));

    btnY += btnH + gap;
    screen.add(new Button({
      x: btnX, y: btnY, w: btnW, h: btnH,
      text: "High Scores",
      fill: "#2a3a2a",
      stroke: "#5f7a5f",
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
      fill: "#101a10",
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
        color: "#cfe8cf",
        align: "center",
        baseline: "middle",
      },
    }));

    // Row labels are built once and mutated as the list changes.
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
        color: "#8fa98f",
        align: "left",
        baseline: "middle",
      });
      const who = new Text({
        x: rowX + 60, y: y + rowH / 2,
        text: "---",
        font: "bold 22px monospace",
        color: "#cfe8cf",
        align: "left",
        baseline: "middle",
      });
      const pts = new Text({
        x: rowX + rowW, y: y + rowH / 2,
        text: "---",
        font: "bold 22px monospace",
        color: "#cfe8cf",
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
    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#101a10",
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

    this.scoreLabel = new Label({
      x: 640, y: 60,
      w: 0, h: 0,
      text: "Score: 0",
      textOptions: {
        font: "bold 24px monospace",
        color: "#cfe8cf",
        align: "center",
        baseline: "middle",
      },
    });
    screen.add(this.scoreLabel);

    // Board. Wall ring (grey) with the playable interior on top.
    screen.add(new Rect({
      x: BOARD_X, y: BOARD_Y, w: BOARD_W, h: BOARD_H,
      fill: "#3a3a3a",
      stroke: null,
    }));

    screen.add(new Rect({
      x: BOARD_X + CELL, y: BOARD_Y + CELL,
      w: BOARD_W - CELL * 2, h: BOARD_H - CELL * 2,
      fill: "#0a120a",
      stroke: null,
    }));

    // The snake container lives in the playable interior's local space.
    // Its origin is the interior's top-left, and cell (cx, cy) maps to
    // local (cx - MIN_X, cy - MIN_Y) * CELL.
    this.snakeLayer = new Panel({
      x: BOARD_X + CELL, y: BOARD_Y + CELL,
      w: BOARD_W - CELL * 2, h: BOARD_H - CELL * 2,
      self: null,
    });
    screen.add(this.snakeLayer);

    this.foodView = new Circle({
      x: 0, y: 0, w: CELL, h: CELL,
      fill: "#e03030",
      stroke: null,
    });
    this.snakeLayer.add(this.foodView);

    // Segment views and head eye lines. Rebuilt each run in
    // _startRun().
    this.segmentViews = [];
    this.eyeLines     = [];

    // Death overlay. Sits above the board. Hidden until death.
    this.deathOverlay = this._buildDeathOverlay();
    screen.add(this.deathOverlay);

    return screen;
  }

  _buildDeathOverlay() {
    const overlay = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      self: new Rect({ fill: "rgba(0, 0, 0, 0.55)", stroke: null }),
    });

    const panelW = 520;
    const panelH = 380;
    const panelX = (1280 - panelW) / 2;
    const panelY = (720 - panelH) / 2;

    const panel = new Panel({
      x: panelX, y: panelY,
      w: panelW, h: panelH,
      fill: "#3a1010",
      stroke: "#e06060",
      strokeWidth: 3,
      radius: 12,
    });
    overlay.add(panel);

    const titleLabel = new Label({
      x: 0, y: 0, w: "100%", h: 0,
      text: "Game Over",
      textOptions: {
        font: "bold 40px sans-serif",
        color: "#ffd0d0",
        align: "center",
        baseline: "middle",
      },
    });
    panel.add(titleLabel);
    titleLabel.text.x = "50%";
    titleLabel.text.y = 70;

    this.deathScoreLabel = new Label({
      x: 0, y: 0, w: "100%", h: 0,
      text: "Score: 0",
      textOptions: {
        font: "bold 24px monospace",
        color: "#ffd0d0",
        align: "center",
        baseline: "middle",
      },
    });
    panel.add(this.deathScoreLabel);
    this.deathScoreLabel.text.x = "50%";
    this.deathScoreLabel.text.y = 120;

    this.deathPromptLabel = new Label({
      x: 0, y: 0, w: "100%", h: 0,
      text: "New high score! Type initials and hit Enter:",
      textOptions: {
        font: "18px sans-serif",
        color: "#ffb0b0",
        align: "center",
        baseline: "middle",
      },
    });
    panel.add(this.deathPromptLabel);
    this.deathPromptLabel.text.x = "50%";
    this.deathPromptLabel.text.y = 165;

    this.initialsLabel = new Text({
      x: panelW / 2, y: 220,
      text: "A A A",
      font: "bold 44px monospace",
      color: "#ffffff",
      align: "center",
      baseline: "middle",
    });
    panel.add(this.initialsLabel);

    const btnW = 160, btnH = 56, gap = 24;
    const totalW = btnW * 2 + gap;
    const startX = (panelW - totalW) / 2;
    const btnY   = panelH - 90;

    panel.add(new Button({
      x: startX, y: btnY, w: btnW, h: btnH,
      text: "Retry",
      fill: "#3f7f3f",
      stroke: "#7bc07b",
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
    this.deathOverlay.visible  = false;
    this._stopRun();
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

  // ---------- Run lifecycle ----------

  _startRun() {
    // Clear any previous segment views and eye lines.
    for (const s of this.segmentViews) this.snakeLayer.remove(s);
    for (const l of this.eyeLines)     this.snakeLayer.remove(l);
    this.segmentViews = [];
    this.eyeLines     = [];

    // Start cell: center of the grid. For even counts, top-left of the
    // two central cells - computing from COLS/ROWS so odd dimensions
    // would naturally land on the single center.
    const cx = Math.floor((COLS - 1) / 2);
    const cy = Math.floor((ROWS - 1) / 2);

    // Two segments, head at (cx, cy), tail one cell to the left
    // because the initial direction is right.
    this.snake = [];
    this.snake.push({ x: cx,     y: cy, px: cx,     py: cy });
    this.snake.push({ x: cx - 1, y: cy, px: cx - 1, py: cy });

    // Views, one per segment.
    //   index 0 -> head, rounded Rect + eyes
    //   everything else -> plain Rect
    for (let i = 0; i < this.snake.length; i++) {
      const isHead = i === 0;
      const view = new Rect({
        x: 0, y: 0, w: CELL, h: CELL,
        fill: "#e8e04a",
        stroke: null,
        radius: isHead ? 2 : 0,
      });
      this.snakeLayer.add(view);
      this.segmentViews.push(view);
    }

    // Head eyes: two short lines. Repositioned each frame based on
    // direction.
    this.eyeLines = [];
    for (let i = 0; i < 2; i++) {
      const l = new Line({
        x1: 0, y1: 0, x2: 0, y2: 0,
        stroke: "#101010",
        strokeWidth: 1,
      });
      this.snakeLayer.add(l);
      this.eyeLines.push(l);
    }

    // Food: place now.
    this._placeFood();

    // Reset run state. Snake starts moving right immediately.
    this.score      = 0;
    this.dir        = "right";
    this.queuedDir  = null;
    this.tickTimer  = 0;
    this.tickDur    = this._tickDurationFor(this.snake.length);
    this.alive      = true;
    this.started    = true;
    this.dead       = false;
    this.initials   = "AAA";
    this.initialsIdx = 0;
    this.scoreSaved = false;

    this._refreshScoreLabel();
    this._layoutSnake(0);
    this.deathOverlay.visible = false;
    this._showPlay();
  }

  _stopRun() {
    this.alive = false;
    this.dead  = false;
  }

  _refreshScoreLabel() {
    this.scoreLabel.setText("Score: " + this.score);
  }

  // ---------- Food ----------

  _placeFood() {
    // Build the set of free cells. Then pick uniformly from it. No
    // retry loop, and no bias toward low indices.
    const occupied = new Set();
    for (const s of this.snake) {
      occupied.add(s.x + "," + s.y);
    }

    const free = [];
    for (let y = MIN_Y; y <= MAX_Y; y++) {
      for (let x = MIN_X; x <= MAX_X; x++) {
        const key = x + "," + y;
        if (!occupied.has(key)) free.push({ x, y });
      }
    }

    if (free.length === 0) {
      // Board full: treat as a win condition; not handled specially.
      this.food = null;
      return;
    }

    const pick = free[Math.floor(Math.random() * free.length)];
    this.food = pick;

    this.foodView.x = (pick.x - MIN_X) * CELL;
    this.foodView.y = (pick.y - MIN_Y) * CELL;
  }

  // ---------- Speed curve ----------

  // Logistic S-curve. 10 cells/sec at length 2, approaching 30 cells/sec
  // as length grows. Midpoint around length ~22.
  _tickDurationFor(length) {
    const slow   = 10;  // cells/sec at the low end
    const fast   = 30;  // cells/sec at the high end
    const midLen = 22;
    const k      = 0.18;

    const cellsPerSec = fast - (fast - slow) / (1 + Math.exp(k * (length - midLen)));
    return 1 / cellsPerSec;
  }

  // ---------- Input ----------

  onEvent(e) {
    if (e.type !== "keydown") return;
    if (!this.playScreen.visible) return;

    if (this.dead) {
      this._handleInitialsKey(e.key);
      return;
    }

    const dir = this._keyToDir(e.key);
    if (!dir) return;

    // Latest-wins single-slot queue. Reversal is checked when the queue
    // would take effect, in _advance, not here.
    this.queuedDir = dir;
  }

  _keyToDir(key) {
    switch (key) {
      case "ArrowUp":    case "w": case "W": return "up";
      case "ArrowDown":  case "s": case "S": return "down";
      case "ArrowLeft":  case "a": case "A": return "left";
      case "ArrowRight": case "d": case "D": return "right";
    }
    return null;
  }

  _isReversal(a, b) {
    if (!a || !b) return false;
    return DIR[a].x + DIR[b].x === 0 && DIR[a].y + DIR[b].y === 0;
  }

  // ---------- Initials entry ----------

  _handleInitialsKey(key) {
    if (this.scoreSaved) {
      // Only Retry / Exit buttons do anything once saved.
      return;
    }

    if (key === "Backspace") {
      if (this.initialsIdx > 0) {
        this.initialsIdx--;
        this.initials = this._setChar(this.initials, this.initialsIdx, "A");
      }
    } else if (key === "Enter") {
      this._saveScore();
    } else if (key.length === 1) {
      const c = key.toUpperCase();
      if (c >= "A" && c <= "Z" || c >= "0" && c <= "9") {
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
    // Three visible slots, current slot highlighted in brackets.
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
    this.deathPromptLabel.setText("Score saved.");
  }

  _wouldMakeHighScore() {
    if (this.highScores.length < MAX_SCORES) return true;
    return this.score > this.highScores[this.highScores.length - 1].score;
  }

  // ---------- Tick ----------

  update(dt) {
    if (!this.playScreen.visible) return;
    if (this.dead) return;
    if (!this.alive) return;

    this.tickTimer += dt;
    while (this.tickTimer >= this.tickDur) {
      this.tickTimer -= this.tickDur;
      this._advance();
      if (this.dead) break;
    }

    if (!this.dead) {
      const t = this.tickDur > 0 ? this.tickTimer / this.tickDur : 0;
      this._layoutSnake(t);
    }
  }

  _advance() {
    // Apply the queued direction if it is legal at this boundary.
    if (this.queuedDir) {
      if (!this._isReversal(this.dir, this.queuedDir)) {
        this.dir = this.queuedDir;
      }
      this.queuedDir = null;
    }

    const head = this.snake[0];
    let d      = DIR[this.dir];

    let nx = head.x + d.x;
    let ny = head.y + d.y;

    // Wall bounce. Wins over whatever the player pressed this tick.
    // Rule: left->up, top->right, right->down, bottom->left.
    if (nx < MIN_X) {
      this.dir = BOUNCE.left;
      d        = DIR[this.dir];
      nx       = head.x + d.x;
      ny       = head.y + d.y;
    } else if (nx > MAX_X) {
      this.dir = BOUNCE.right;
      d        = DIR[this.dir];
      nx       = head.x + d.x;
      ny       = head.y + d.y;
    } else if (ny < MIN_Y) {
      this.dir = BOUNCE.up;
      d        = DIR[this.dir];
      nx       = head.x + d.x;
      ny       = head.y + d.y;
    } else if (ny > MAX_Y) {
      this.dir = BOUNCE.down;
      d        = DIR[this.dir];
      nx       = head.x + d.x;
      ny       = head.y + d.y;
    }

    // If the bounce itself lands us into a wall (extreme corner case
    // on a tiny board), just die to avoid an infinite loop.
    if (nx < MIN_X || nx > MAX_X || ny < MIN_Y || ny > MAX_Y) {
      this._die();
      return;
    }

    // Self-collision: the cell we are about to enter must not contain
    // a body segment, excluding the tail cell if it is about to vacate
    // this tick (i.e. we are not growing).
    const willGrow  = this.food && nx === this.food.x && ny === this.food.y;
    const ignoreIdx = willGrow ? -1 : this.snake.length - 1;
    for (let i = 0; i < this.snake.length; i++) {
      if (i === ignoreIdx) continue;
      if (this.snake[i].x === nx && this.snake[i].y === ny) {
        this._die();
        return;
      }
    }

    // Advance. For every segment except the head:
    //   px/py = this segment's OWN current cell (where it was last tick)
    //   x/y   = the previous segment's OLD cell (where it moves to)
    // The head is special: it moves into a brand new cell.
    const oldCells = this.snake.map(s => ({ x: s.x, y: s.y }));

    for (let i = 1; i < this.snake.length; i++) {
      const s = this.snake[i];
      s.px = s.x;
      s.py = s.y;
    }
    for (let i = 1; i < this.snake.length; i++) {
      this.snake[i].x = oldCells[i - 1].x;
      this.snake[i].y = oldCells[i - 1].y;
    }

    head.px = head.x;
    head.py = head.y;
    head.x  = nx;
    head.y  = ny;

    // Growth: add a new tail segment at the old tail position. The
    // new segment starts where the old tail was (visually contiguous).
    if (willGrow) {
      const tail = this.snake[this.snake.length - 1];
      const gx   = tail.x;
      const gy   = tail.y;
      const seg  = { x: gx, y: gy, px: gx, py: gy };
      this.snake.push(seg);

      const view = new Rect({
        x: 0, y: 0, w: CELL, h: CELL,
        fill: "#e8e04a",
        stroke: null,
        radius: 0,
      });
      this.snakeLayer.add(view);
      this.segmentViews.push(view);

      this.score += 1;
      this._refreshScoreLabel();
      this.tickDur = this._tickDurationFor(this.snake.length);
      this._placeFood();
    }
  }

  _die() {
    this.alive = false;
    this.dead  = true;

    // Freeze layout at t = 1 (fully in the last cell).
    this._layoutSnake(1);

    this.deathScoreLabel.setText("Score: " + this.score);
    const isHigh = this._wouldMakeHighScore();
    this.scoreSaved = false;
    this.initials   = "AAA";
    this.initialsIdx = 0;

    if (isHigh) {
      this.deathPromptLabel.setText("New high score! Enter initials:");
      this._refreshInitialsLabel();
      this.initialsLabel.visible = true;
    } else {
      this.deathPromptLabel.setText("Press Retry or Exit.");
      this.initialsLabel.visible = false;
    }

    this.deathOverlay.visible = true;
  }

  // ---------- Rendering ----------

  // t in [0,1] is how far through the current tick we are. Segments
  // lerp from their previous cell to their current cell.
  _layoutSnake(t) {
    const n = this.snake.length;
    if (n === 0) return;

    for (let i = 0; i < n; i++) {
      const s = this.snake[i];
      const x = (s.px + (s.x - s.px) * t - MIN_X) * CELL;
      const y = (s.py + (s.y - s.py) * t - MIN_Y) * CELL;

      const view = this.segmentViews[i];
      view.x = x;
      view.y = y;
      view.w = CELL;
      view.h = CELL;
    }

    // Head eyes: oriented to the current direction. Head view is [0].
    const head = this.snake[0];
    const hx   = (head.px + (head.x - head.px) * t - MIN_X) * CELL;
    const hy   = (head.py + (head.y - head.py) * t - MIN_Y) * CELL;
    this._layoutEyes(hx, hy, this.dir);
  }

  _layoutEyes(hx, hy, dir) {
    // Eyes sit on the leading face, inset slightly. Two short lines
    // perpendicular to travel. Coordinates are local to the head tile.
    let e1, e2;
    if (dir === "right") {
      e1 = [CELL - 2, 1,      CELL - 2, 2];
      e2 = [CELL - 2, CELL - 2, CELL - 2, CELL - 1];
    } else if (dir === "left") {
      e1 = [1, 1,      1, 2];
      e2 = [1, CELL - 2, 1, CELL - 1];
    } else if (dir === "up") {
      e1 = [1,      1, 2,      1];
      e2 = [CELL - 2, 1, CELL - 1, 1];
    } else { // down
      e1 = [1,      CELL - 2, 2,      CELL - 2];
      e2 = [CELL - 2, CELL - 2, CELL - 1, CELL - 2];
    }

    const l1 = this.eyeLines[0];
    const l2 = this.eyeLines[1];
    l1.x1 = hx + e1[0]; l1.y1 = hy + e1[1]; l1.x2 = hx + e1[2]; l1.y2 = hy + e1[3];
    l2.x1 = hx + e2[0]; l2.y1 = hy + e2[1]; l2.x2 = hx + e2[2]; l2.y2 = hy + e2[3];
  }
}