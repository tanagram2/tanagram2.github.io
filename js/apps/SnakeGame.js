// Snake.
//
// Structure: a landing screen (Start / High Scores / Exit), a high
// scores screen (Return + up to 10 rows), and a play screen (score
// Label, board Panel, Return top-left, death overlay, pause overlay,
// mobile-only Pause button, mobile-only Show/Hide Controls button,
// mobile-only D-pad).
//
// Movement model: the snake's logical position is a grid of cells.
// The head advances one cell per tick; between ticks every segment
// interpolates from its previous cell to its current cell so motion
// looks smooth. Turns only take effect at cell boundaries.
//
// Board geometry is computed at init() time from Viewport.width and
// Viewport.height so the same game works on both virtual
// resolutions. Desktop is 32 x 24 cells; mobile is 22 x 22 cells.
// Cell size is 25px on both.
//
// Mobile controls: the D-pad and the Pause button are built at init
// but the D-pad starts hidden. A "Show Controls" / "Hide Controls"
// button toggles D-pad visibility and repositions the board between
// its centered resting spot and a raised spot that leaves room for
// the pad. Board size does not change.
//
// Initials entry: on desktop, the physical keyboard is used (the
// existing keydown path). On mobile, an on-canvas Keyboard composite
// is shown inside the death overlay, with Backspace and Enter
// buttons beneath it. Both paths feed the same _handleInitialsKey.
//
// No Layer. Segment count stays small enough that Composite + Rect
// children are trivially fast.

import { App }      from "./App.js";
import { Rect }     from "../primitives/Rect.js";
import { Circle }   from "../primitives/Circle.js";
import { Line }     from "../primitives/Line.js";
import { Text }     from "../primitives/Text.js";
import { Panel }    from "../composites/Panel.js";
import { Button }   from "../composites/Button.js";
import { Label }    from "../composites/Label.js";
import { Keyboard } from "../composites/Keyboard.js";
import { Viewport } from "../systems/Viewport.js";

// Cell size is shared. Board dimensions differ per device.
const CELL = 25;

// Playable cell range (inside the 1-cell wall ring). Filled in by
// _computeLayout().
let MIN_X = 1;
let MIN_Y = 1;
let MAX_X = 1;
let MAX_Y = 1;

// Directions as cell deltas.
const DIR = {
  up:    { x:  0, y: -1 },
  down:  { x:  0, y:  1 },
  left:  { x: -1, y:  0 },
  right: { x:  1, y:  0 },
};

// Perpendicular candidates for a wall bounce, in the order they are
// tried. On a wall hit, try the two perpendicular directions; take
// the first that lands in-bounds and off the body. If both are
// blocked, die.
const PERPENDICULAR = {
  left:  ["up",   "down"],
  right: ["up",   "down"],
  up:    ["right", "left"],
  down:  ["right", "left"],
};

const MAX_SCORES   = 10;
const INITIALS_LEN = 3;
const START_LENGTH = 5;

// Swipe threshold, virtual pixels. A drag shorter than this is not a
// swipe.
const SWIPE_MIN = 30;

export class SnakeGame extends App {
  static displayName = "Snake";

  init() {
    // Board geometry, computed once from the active virtual box.
    this._computeLayout();

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

    // Modal states. Not both true at once.
    this.dead        = false;
    this.paused      = false;

    // Death / initials state.
    this.initials    = "AAA";
    this.initialsIdx = 0;
    this.scoreSaved  = false;

    // Swipe tracking. Only active while play screen is visible and
    // the pointer is down.
    this._swipeStart    = null;
    this._swipeConsumed = false;

    // Mobile control pad visibility. Default hidden so the game
    // opens clean; the toggle button reveals it and raises the
    // board to make room.
    this.controlsVisible = false;

    this.landingScreen = this._buildLanding();
    this.scoresScreen  = this._buildScoresScreen();
    this.playScreen    = this._buildPlayScreen();
    this.root.add(this.landingScreen);
    this.root.add(this.scoresScreen);
    this.root.add(this.playScreen);

    this._showLanding();
  }

  // Decide board rectangle and grid size from the active virtual box.
  // Desktop: 800x600 board, 32 x 24 cells (matches the old values).
  // Mobile:  550x550 board, 22 x 22 cells, offset from top so it can
  //          shift between centered and raised as controls show/hide.
  _computeLayout() {
    if (Viewport.isMobile) {
      this._cols    = 22;
      this._rows    = 22;
      this._boardW  = this._cols * CELL;
      this._boardH  = this._rows * CELL;
      this._boardX  = (Viewport.width - this._boardW) / 2;
      // Two Y positions. The active one is chosen in
      // _applyControlsLayout() based on controlsVisible.
      this._boardYHidden  = 240;
      this._boardYVisible = 130;
      this._boardY        = this._boardYHidden;
    } else {
      this._cols    = 32;
      this._rows    = 24;
      this._boardW  = this._cols * CELL;
      this._boardH  = this._rows * CELL;
      this._boardX  = 240;
      this._boardY  = 90;
    }

    MIN_X = 1;
    MIN_Y = 1;
    MAX_X = this._cols - 2;
    MAX_Y = this._rows - 2;
  }

  // ---------- Screens ----------

  _buildLanding() {
    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#101a10",
      stroke: null,
    });

    const cx = Viewport.width / 2;
    const titleY = Viewport.isMobile ? 280 : 200;

    screen.add(new Label({
      x: cx, y: titleY,
      text: "Snake",
      textOptions: {
        font: "bold 56px sans-serif",
        color: "#cfe8cf",
        align: "center",
        baseline: "middle",
      },
    }));

    const btnW = Viewport.isMobile ? 380 : 260;
    const btnH = 64;
    const gap  = 20;
    const btnX = (Viewport.width - btnW) / 2;
    let   btnY = Viewport.isMobile ? 420 : 320;

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

    const cx = Viewport.width / 2;
    const titleY = Viewport.isMobile ? 140 : 90;

    screen.add(new Label({
      x: cx, y: titleY,
      text: "High Scores",
      textOptions: {
        font: "bold 40px sans-serif",
        color: "#cfe8cf",
        align: "center",
        baseline: "middle",
      },
    }));

    this.scoreRows = [];
    const rowW   = Viewport.isMobile ? 560 : 400;
    const rowH   = 40;
    const rowGap = 6;
    const rowX   = (Viewport.width - rowW) / 2;
    const rowY0  = Viewport.isMobile ? 240 : 170;

    for (let i = 0; i < MAX_SCORES; i++) {
      const y = rowY0 + i * (rowH + rowGap);
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

    // Mobile-only Pause button in the top-right corner.
    if (Viewport.isMobile) {
      screen.add(new Button({
        x: Viewport.width - 164, y: 24, w: 140, h: 48,
        text: "Pause",
        fill: "#2a3552",
        stroke: "#6a86b8",
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
        onClick: () => this._pause(),
      }));
    }

    const cx = Viewport.width / 2;
    const scoreY = 60;

    this.scoreLabel = new Label({
      x: cx, y: scoreY,
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

    // Board background, wall ring, and playfield. These are created
    // once and repositioned when the controls toggle moves the board.
    this.boardBg = new Rect({
      x: this._boardX, y: this._boardY,
      w: this._boardW, h: this._boardH,
      fill: "#3a3a3a",
      stroke: null,
    });
    screen.add(this.boardBg);

    this.boardWall = new Rect({
      x: this._boardX + CELL, y: this._boardY + CELL,
      w: this._boardW - CELL * 2,
      h: this._boardH - CELL * 2,
      fill: "#0a120a",
      stroke: null,
    });
    screen.add(this.boardWall);

    this.snakeLayer = new Panel({
      x: this._boardX + CELL,
      y: this._boardY + CELL,
      w: this._boardW - CELL * 2,
      h: this._boardH - CELL * 2,
      self: null,
    });
    screen.add(this.snakeLayer);

    this.foodView = new Circle({
      x: 0, y: 0, w: CELL, h: CELL,
      fill: "#e03030",
      stroke: null,
    });
    this.snakeLayer.add(this.foodView);

    this.segmentViews = [];
    this.eyeLines     = [];

    this.deathOverlay = this._buildDeathOverlay();
    screen.add(this.deathOverlay);

    this.pauseOverlay = this._buildPauseOverlay();
    screen.add(this.pauseOverlay);

    // Mobile-only controls: a Show/Hide Controls toggle just below
    // the board, and a D-pad below that. Both start hidden; the
    // toggle button is always visible on mobile. The D-pad is built
    // now so its geometry is fixed; visibility alone changes.
    this.controlsToggle = null;
    this.dpadButtons    = [];

    if (Viewport.isMobile) {
      this._buildControlsToggle(screen);
      this._buildDpad(screen);
      this._applyControlsLayout();
    }

    return screen;
  }

  _buildControlsToggle(screen) {
    const btnW = 300;
    const btnH = 56;
    const btnX = (Viewport.width - btnW) / 2;
    // Placed just below the board in its raised (controls-visible)
    // position; that is the spot that reads as "controls live here."
    const btnY = this._boardYVisible + this._boardH + 20;

    this.controlsToggle = new Button({
      x: btnX, y: btnY, w: btnW, h: btnH,
      text: "Show Controls",
      fill: "#2a3a2a",
      stroke: "#5f7a5f",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 22px sans-serif", color: "#cfe8cf" },
      onClick: () => this._toggleControls(),
    });
    screen.add(this.controlsToggle);
  }

  _buildDpad(screen) {
    const btnSize = 90;
    const gap     = 10;

    const centerX = Viewport.width / 2;
    // D-pad sits below the controls toggle. Compute its anchor from
    // the toggle position so the pair move together if either moves.
    const toggleY = this._boardYVisible + this._boardH + 20;
    const dpadTop = toggleY + 56 + 24;
    const centerY = dpadTop + btnSize + gap / 2;

    const defs = [
      { text: "^", dir: "up",
        x: centerX - btnSize / 2,
        y: centerY - btnSize - gap / 2 },
      { text: "v", dir: "down",
        x: centerX - btnSize / 2,
        y: centerY + gap / 2 },
      { text: "<", dir: "left",
        x: centerX - btnSize - gap / 2 - btnSize / 2,
        y: centerY - btnSize / 2 },
      { text: ">", dir: "right",
        x: centerX + gap / 2 + btnSize / 2,
        y: centerY - btnSize / 2 },
    ];

    for (const d of defs) {
      const b = new Button({
        x: d.x, y: d.y, w: btnSize, h: btnSize,
        text: d.text,
        fill: "#2a3a2a",
        stroke: "#5f7a5f",
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 32px sans-serif", color: "#cfe8cf" },
        onClick: () => { this.queuedDir = d.dir; },
      });
      b.visible = false;
      screen.add(b);
      this.dpadButtons.push(b);
    }
  }

  _toggleControls() {
    this.controlsVisible = !this.controlsVisible;
    this._applyControlsLayout();
  }

  // Apply the current controlsVisible state: show/hide the D-pad,
  // update the toggle button's label, and shift the board between
  // its hidden (centered) and visible (raised) Y positions.
  _applyControlsLayout() {
    const show = this.controlsVisible;

    for (const b of this.dpadButtons) {
      b.visible = show;
    }

    if (this.controlsToggle) {
      this.controlsToggle.setText(show ? "Hide Controls" : "Show Controls");
    }

    this._boardY = show ? this._boardYVisible : this._boardYHidden;
    this._repositionBoard();
  }

  // Move the board background, wall, and snake layer to match
  // _boardY. Called whenever the board position changes. Board size
  // is never altered.
  _repositionBoard() {
    if (!this.boardBg) return;
    this.boardBg.y   = this._boardY;
    this.boardWall.y = this._boardY + CELL;
    this.snakeLayer.y = this._boardY + CELL;
  }

  _buildDeathOverlay() {
    const overlay = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      self: new Rect({ fill: "rgba(0, 0, 0, 0.55)", stroke: null }),
    });

    const panelW = Viewport.isMobile ? 620 : 520;
    const panelH = Viewport.isMobile ? 680 : 380;
    const panelX = (Viewport.width  - panelW) / 2;
    const panelY = (Viewport.height - panelH) / 2;

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

    // Mobile-only on-canvas keyboard, plus Backspace and Enter.
    // Built now, hidden until a qualifying score appears. The
    // keyboard fills most of the panel width; backspace/enter sit
    // below it.
    this.mobileKeyboard   = null;
    this.mobileBackspace  = null;
    this.mobileEnter      = null;

    if (Viewport.isMobile) {
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

      const kbH   = this.mobileKeyboard.h;
      const rowY  = kbY + kbH + 16;
      const btnW  = (kbW - 16) / 2;
      const btnH  = 56;

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
        fill: "#3f7f3f",
        stroke: "#7bc07b",
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._handleInitialsKey("Enter"),
      });
      panel.add(this.mobileEnter);
    }

    // Desktop action buttons. On mobile these sit far below the
    // keyboard and are still used for Retry / Exit; the panel is
    // taller so there is room for both the keyboard block and them.
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

    // Start with the mobile initials UI hidden.
    this._setInitialsEntryVisible(false);

    return overlay;
  }

  // Show or hide the initials-entry UI: the initials label, and on
  // mobile the keyboard plus Backspace/Enter. One place to toggle
  // them together so _die() and _saveScore paths stay in sync.
  _setInitialsEntryVisible(on) {
    this.initialsLabel.visible = on;
    if (this.mobileKeyboard)  this.mobileKeyboard.visible  = on;
    if (this.mobileBackspace) this.mobileBackspace.visible = on;
    if (this.mobileEnter)     this.mobileEnter.visible     = on;
  }

  _buildPauseOverlay() {
    const overlay = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      self: new Rect({ fill: "rgba(0, 0, 0, 0.45)", stroke: null }),
    });

    const panelW = 420;
    const panelH = 220;
    const panelX = (Viewport.width  - panelW) / 2;
    const panelY = (Viewport.height - panelH) / 2;

    const panel = new Panel({
      x: panelX, y: panelY,
      w: panelW, h: panelH,
      fill: "#1a2434",
      stroke: "#5a7ea8",
      strokeWidth: 3,
      radius: 12,
    });
    overlay.add(panel);

    const titleLabel = new Label({
      x: 0, y: 0, w: "100%", h: 0,
      text: "Paused",
      textOptions: {
        font: "bold 40px sans-serif",
        color: "#d8e4f7",
        align: "center",
        baseline: "middle",
      },
    });
    panel.add(titleLabel);
    titleLabel.text.x = "50%";
    titleLabel.text.y = 60;

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
    this.deathOverlay.visible  = false;
    this.pauseOverlay.visible  = false;
    this.paused                = false;
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

  // ---------- Pause ----------

  _pause() {
    if (this.dead) return;
    if (!this.alive) return;
    this.paused = true;
    this.pauseOverlay.visible = true;
  }

  _unpause() {
    if (!this.paused) return;
    this.paused = false;
    this.pauseOverlay.visible = false;
  }

  // ---------- Run lifecycle ----------

  _startRun() {
    for (const s of this.segmentViews) this.snakeLayer.remove(s);
    for (const l of this.eyeLines)     this.snakeLayer.remove(l);
    this.segmentViews = [];
    this.eyeLines     = [];

    const cx = Math.floor((this._cols - 1) / 2);
    const cy = Math.floor((this._rows - 1) / 2);

    this.snake = [];
    for (let i = 0; i < START_LENGTH; i++) {
      const sx = cx - i;
      this.snake.push({ x: sx, y: cy, px: sx, py: cy });
    }

    for (let i = 0; i < this.snake.length; i++) {
      const isHead = i === 0;
      const view = new Rect({
        x: 0, y: 0, w: CELL, h: CELL,
        fill: "#e8e04a",
        stroke: null,
        radius: isHead ? 5 : 0,
      });
      this.snakeLayer.add(view);
      this.segmentViews.push(view);
    }

    this.eyeLines = [];
    for (let i = 0; i < 2; i++) {
      const l = new Line({
        x1: 0, y1: 0, x2: 0, y2: 0,
        stroke: "#101010",
        strokeWidth: 3,
      });
      this.snakeLayer.add(l);
      this.eyeLines.push(l);
    }

    this._placeFood();

    this.score       = 0;
    this.dir         = "right";
    this.queuedDir   = null;
    this.tickTimer   = 0;
    this.tickDur     = this._tickDurationFor(this.snake.length);
    this.alive       = true;
    this.started     = true;
    this.dead        = false;
    this.paused      = false;
    this.initials    = "AAA";
    this.initialsIdx = 0;
    this.scoreSaved  = false;

    this._refreshScoreLabel();
    this._layoutSnake(0);
    this.deathOverlay.visible = false;
    this.pauseOverlay.visible = false;
    this._setInitialsEntryVisible(false);
    this._showPlay();
  }

  _stopRun() {
    this.alive  = false;
    this.dead   = false;
    this.paused = false;
  }

  _refreshScoreLabel() {
    this.scoreLabel.setText("Score: " + this.score);
  }

  // ---------- Food ----------

  _placeFood() {
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
      this.food = null;
      return;
    }

    const pick = free[Math.floor(Math.random() * free.length)];
    this.food = pick;

    this.foodView.x = (pick.x - MIN_X) * CELL;
    this.foodView.y = (pick.y - MIN_Y) * CELL;
  }

  // ---------- Speed curve ----------

  _tickDurationFor(length) {
    const slow   = 4.5;
    const fast   = 9.0;
    const midLen = 25;
    const k      = 0.10;

    const cellsPerSec = fast - (fast - slow) / (1 + Math.exp(k * (length - midLen)));
    return 1 / cellsPerSec;
  }

  // ---------- Input ----------

  onEvent(e) {
    // Swipe tracking runs on the play screen on mobile. We watch
    // mousedown/mousemove/mouseup and decide during the move whether
    // the gesture has crossed the swipe threshold.
    if (Viewport.isMobile && this.playScreen.visible) {
      if (e.type === "mousedown") {
        this._swipeStart    = { x: e.x, y: e.y };
        this._swipeConsumed = false;
        return;
      }
      if (e.type === "mousemove" && this._swipeStart && !this._swipeConsumed) {
        const dx = e.x - this._swipeStart.x;
        const dy = e.y - this._swipeStart.y;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        if (adx >= SWIPE_MIN || ady >= SWIPE_MIN) {
          if (adx > ady) {
            this.queuedDir = dx > 0 ? "right" : "left";
          } else {
            this.queuedDir = dy > 0 ? "down" : "up";
          }
          this._swipeConsumed = true;
        }
        return;
      }
      if (e.type === "mouseup") {
        this._swipeStart    = null;
        this._swipeConsumed = false;
        return;
      }
    }

    if (e.type !== "keydown") return;
    if (!this.playScreen.visible) return;
    if (e.repeat) return;

    if (e.key === " " || e.code === "Space") {
      if (this.dead) return;
      if (!this.alive) return;
      if (this.paused) {
        this._unpause();
      } else {
        this._pause();
      }
      return;
    }

    if (this.dead) {
      this._handleInitialsKey(e.key);
      return;
    }

    if (this.paused) return;

    const dir = this._keyToDir(e.key);
    if (!dir) return;

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
    this._setInitialsEntryVisible(false);
  }

  _wouldMakeHighScore() {
    if (this.highScores.length < MAX_SCORES) return true;
    return this.score > this.highScores[this.highScores.length - 1].score;
  }

  // ---------- Tick ----------

  update(dt) {
    if (!this.playScreen.visible) return;
    if (this.dead) return;
    if (this.paused) return;
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

    const hitWall =
      nx < MIN_X || nx > MAX_X || ny < MIN_Y || ny > MAX_Y;

    if (hitWall) {
      const bounceDir = this._pickBounceDir(head);
      if (!bounceDir) {
        this._die();
        return;
      }
      this.dir = bounceDir;
      d        = DIR[this.dir];
      nx       = head.x + d.x;
      ny       = head.y + d.y;

      if (nx < MIN_X || nx > MAX_X || ny < MIN_Y || ny > MAX_Y) {
        this._die();
        return;
      }
    }

    const willGrow  = this.food && nx === this.food.x && ny === this.food.y;
    const ignoreIdx = willGrow ? -1 : this.snake.length - 1;
    for (let i = 0; i < this.snake.length; i++) {
      if (i === ignoreIdx) continue;
      if (this.snake[i].x === nx && this.snake[i].y === ny) {
        this._die();
        return;
      }
    }

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

  _pickBounceDir(head) {
    const candidates = PERPENDICULAR[this.dir];
    if (!candidates) return null;

    for (const dirName of candidates) {
      const d  = DIR[dirName];
      const cx = head.x + d.x;
      const cy = head.y + d.y;

      if (cx < MIN_X || cx > MAX_X || cy < MIN_Y || cy > MAX_Y) {
        continue;
      }

      let blocked = false;
      for (const s of this.snake) {
        if (s.x === cx && s.y === cy) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      return dirName;
    }

    return null;
  }

  _die() {
    this.alive  = false;
    this.dead   = true;
    this.paused = false;

    this._layoutSnake(1);

    this.deathScoreLabel.setText("Score: " + this.score);
    const isHigh = this._wouldMakeHighScore();
    this.scoreSaved  = false;
    this.initials    = "AAA";
    this.initialsIdx = 0;

    if (isHigh) {
      this.deathPromptLabel.setText("New high score! Type initials and then press Enter:");
      this._refreshInitialsLabel();
      this._setInitialsEntryVisible(true);
    } else {
      this.deathPromptLabel.setText("Press Retry or Exit.");
      this._setInitialsEntryVisible(false);
    }

    this.deathOverlay.visible = true;
    this.pauseOverlay.visible = false;
  }

  // ---------- Rendering ----------

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

    const head = this.snake[0];
    const hx   = (head.px + (head.x - head.px) * t - MIN_X) * CELL;
    const hy   = (head.py + (head.y - head.py) * t - MIN_Y) * CELL;
    this._layoutEyes(hx, hy, this.dir);
  }

  _layoutEyes(hx, hy, dir) {
    const inset = Math.round(CELL * 0.25);
    const len   = Math.round(CELL * 0.25);
    const far   = CELL - inset;

    let e1, e2;
    if (dir === "right") {
      e1 = [far, inset,       far, inset + len];
      e2 = [far, CELL - inset - len, far, CELL - inset];
    } else if (dir === "left") {
      e1 = [inset, inset,       inset, inset + len];
      e2 = [inset, CELL - inset - len, inset, CELL - inset];
    } else if (dir === "up") {
      e1 = [inset,       inset, inset + len, inset];
      e2 = [CELL - inset - len, inset, CELL - inset, inset];
    } else {
      e1 = [inset,       far, inset + len, far];
      e2 = [CELL - inset - len, far, CELL - inset, far];
    }

    const l1 = this.eyeLines[0];
    const l2 = this.eyeLines[1];
    l1.x1 = hx + e1[0]; l1.y1 = hy + e1[1]; l1.x2 = hx + e1[2]; l1.y2 = hy + e1[3];
    l2.x1 = hx + e2[0]; l2.y1 = hy + e2[1]; l2.x2 = hx + e2[2]; l2.y2 = hy + e2[3];
  }
}