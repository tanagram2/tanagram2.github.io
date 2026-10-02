// Battleship.
//
// Second multiplayer app. Modeled on ChatRoom.
//
// All app data lives under a per-app subfolder of data/, named after
// the app's .js file. Battleship's data root is data/Battleship/.
// Rooms are nested inside it: data/Battleship/roomN/...
//
// Per room, three files:
//   presence.txt  - two lines, one per slot. Same format as ChatRoom.
//   game.txt      - single shared game state, read-modify-written by
//                   whichever player has the turn. See the format
//                   comment above _encodeGame.
//   chat.txt      - append-only chat log, separate from game state so
//                   a chat message does not force a full game rewrite.
//
// All three files are checked in as zero-byte files.
//
// The game.txt format is load-bearing. If FLEET changes, the encoder
// and decoder in _encodeGame / _decodeGame must change together.
//
// Turn model: standard Battleship. Fire one shot. A hit keeps the
// turn. A miss passes it. The shooter gets a persistent feedback line
// ("HIT - fire again") so it is clear the turn did not pass.
//
// turnCount is a monotonically increasing counter in #META. It
// increments only on writes that flip the turn: the start commit and
// any miss. A hit does not flip the turn, so it does not increment.
// The counter lets a client detect that the turn has moved since it
// last read, independent of the turn value itself. It is redundant
// with the turn line for correctness, but it makes drift visible
// without reasoning about whether two clients could have read the
// same value.
//
// First-turn selection is a vote-plus-ready handshake. Once two
// players are present, each independently chooses Me or Defer, then
// presses Ready. A vote is required before Ready becomes available.
// When both players are ready, the next writer resolves the outcome:
//   Me vs Me      -> coinflip
//   Me vs Defer   -> the Me player goes first
//   Defer vs Defer-> coinflip
// The resolution and the two votes are committed in the same write
// that flips started to 1, so both clients see the same outcome.
//
// All writes to game.txt that come from a single player's action
// (vote, ready, lock in, fire) are shaped as:
//
//     (currentContent) => { decode; apply only my change; encode; }
//
// currentContent is the freshest content _writeWithRetry has, which
// on a conflict retry is the freshly re-read file. The callback
// decodes that, changes only the field(s) this client owns, and
// re-encodes. Every other player's field passes through byte-by-
// byte from the fresh read. This is the same shape as the presence
// splice and is what keeps two concurrent writers from stomping
// each other's lines.
//
// Mobile pass: the layout branches on Viewport.isMobile. Boards
// stack vertically. Placement and firing use tap+drag on the board
// plus an optional on-screen D-pad for firing. Chat opens as a full
// overlay that covers the game screen, with the shared Keyboard
// composite at the bottom.
//
// Shared-file trust model: both players read and write the same
// game.txt. There is no attempt to hide fleet positions from the
// client. This is a fun project, not a competitive one.

import { App }       from "./App.js";
import { Rect }      from "../primitives/Rect.js";
import { Text }      from "../primitives/Text.js";
import { Line }      from "../primitives/Line.js";
import { Panel }     from "../composites/Panel.js";
import { Button }    from "../composites/Button.js";
import { Label }     from "../composites/Label.js";
import { Keyboard }  from "../composites/Keyboard.js";
import { Viewport }  from "../systems/Viewport.js";

// Repo config.

const OWNER  = "tanagram2";
const REPO   = "tanagram2.github.io";
const BRANCH = "main";

// App data root. All paths this app reads or writes are built from
// this prefix. Matches the app's .js file basename.

const DATA_ROOT = "data/Battleship/";

// Tunables. Mirrored from ChatRoom where the concern is the same.

const ROOMS = ["room1", "room2", "room3"];
const ROOM_LABELS = { room1: "Room1", room2: "Room2", room3: "Room3" };
const SLOTS = 2;

const STALE_MS          = 2 * 60 * 1000;
const CYCLE_MS          = 30 * 1000;
const UPDATE_THROTTLE   = 10 * 1000;
const CHAT_COOLDOWN     = 8 * 1000;
const PUT_MAX_RETRIES   = 6;
const PUT_BACKOFF_MS    = 250;
const DEAD_CONFIRM_MS   = 1000;

const STAGGER_MIN_MS    = 500;
const STAGGER_MAX_MS    = 3000;
const PRESTAGGER_MAX_MS = 2000;

const LEAVE_TIMESTAMP = "1970-01-01T00:00:00.000Z";

const CURSOR_MS = 500;

const SESSION_KEY = "canvasos.session.id";

const API = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/";

// Fleet. Order is fixed; placement walks this list top to bottom.

const FLEET = [
  { name: "Carrier",    len: 5 },
  { name: "Battleship", len: 4 },
  { name: "Cruiser",    len: 3 },
  { name: "Submarine",  len: 3 },
  { name: "Destroyer",  len: 2 },
];

const BOARD_W = 10;
const BOARD_H = 10;

// Busy-button colors. The helper swaps the self shape's fill and
// stroke to the busy pair while a git request is in flight, and
// locks the Button's own hover/press styling so a pointer wandering
// over the button cannot undo the busy look. On completion the
// Button re-applies its CURRENT base style, which is kept fresh by
// _renderButtons via setBaseStyle.

const BUSY_FILL   = "#4a4a4a";
const BUSY_STROKE = "#9a9a9a";

// Named resting colors for buttons whose base color changes with
// state (vote, ready/unready, lock in, fire). Applied via
// setBaseStyle so hover and press merge over the CURRENT resting
// color instead of a stale snapshot from construction time.

const BTN_BLUE_FILL    = "#2a3552";
const BTN_BLUE_STROKE  = "#6a86b8";
const BTN_GREEN_FILL   = "#2a6a3a";
const BTN_GREEN_STROKE = "#6aaa7a";
const BTN_RED_FILL     = "#8a2020";
const BTN_RED_STROKE   = "#e06060";
const BTN_DARK_FILL    = "#2a2a3a";
const BTN_DARK_STROKE  = "#5a5a7a";

// base64 helpers. The browser's btoa/atob mishandle non-ASCII.

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64) {
  const clean = b64.replace(/\s/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function nowIso() {
  return new Date().toISOString();
}

function isPresent(isoStr) {
  if (!isoStr) return false;
  const t = Date.parse(isoStr);
  if (Number.isNaN(t)) return false;
  return (Date.now() - t) < STALE_MS;
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n);
}

// Format an ISO timestamp as 24-hour HH:MM:SS. Local time, no date.
function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "??:??:??";
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return h + ":" + m + ":" + s;
}

export class Battleship extends App {
  static displayName = "Battleship";

  init() {
    this.mobile = Viewport.isMobile;

    this.session  = this._loadSession();
    this.username = "";

    this.room = null;
    this.slot = null;

    // Parsed state.
    this.presenceEntries = [null, null];
    this.game            = null;
    this.chatLines       = [];

    // Placement state (local until Lock In).
    this.placing   = false;
    this.placeIdx  = 0;
    this.placeRot  = false;
    this.hoverCell = { x: 0, y: 0 };
    this.myFleet   = null;
    this._dragPlace = false;
    this._placePreview = null;   // { x, y, horiz } or null

    // Fire state.
    this.fireCursor = { x: 0, y: 0 };
    this.lockedShot = null;         // { x, y } or null - desktop only
    this.lastFeedback = "";
    this._awaitingFire = false;
    this._dragFire = false;

    // First-turn vote state (local mirror of the shared values).
    this.myVote   = null;           // "me" | "defer" | null
    this.myReady  = false;

    // Chat UI.
    this.chatOpen = false;
    this.unread   = 0;
    this._seenChatCount = 0;

    // Mobile controls visibility (fire phase only).
    this.controlsVisible = false;

    // Cycle scheduler.
    this._cycleTimer  = null;
    this._cycleDelay  = CYCLE_MS;
    this._nextCycleAt = 0;

    this._lastUpdate = 0;
    this._lastSend   = 0;

    this._sending  = false;
    this._updating = false;
    this._placingWrite = false;
    this._votingWrite  = false;
    this._firing       = false;

    this._cursorOn    = true;
    this._cursorTimer = 0;

    this._usernameBuffer = "";
    this.inputText       = "";

    this._joining = false;

    this._opChain = Promise.resolve();

    this.stack = ["username"];

    this.usernameScreen = this._buildUsernameScreen();
    this.roomScreen     = this._buildRoomScreen();
    this.gameScreen     = this._buildGameScreen();

    this.root.add(this.usernameScreen);
    this.root.add(this.roomScreen);
    this.root.add(this.gameScreen);

    this._applyScreen("username");
    this._refreshUsernameField();
    this._refreshChatInput();
    this._refreshCountdown();
  }

  // ---------- Session ----------

  _loadSession() {
    try {
      return localStorage.getItem(SESSION_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  // ---------- Serialized op runner ----------

  _serialize(fn) {
    const next = this._opChain.then(fn, fn);
    this._opChain = next.catch(() => {});
    return next;
  }

  // ---------- Busy-button helper ----------

  _busyStart(btn) {
    if (!btn || !btn.self) return;
    btn.setBusy(true);
    btn.self.fill   = BUSY_FILL;
    btn.self.stroke = BUSY_STROKE;
  }

  _busyEnd(btn) {
    if (!btn || !btn.self) return;
    btn.setBusy(false);
    btn.setBaseStyle({});
  }

  // ---------- Field rendering ----------

  _renderField(label, buffer) {
    if (!label) return;
    label.setText(buffer + (this._cursorOn ? "|" : " "));
  }

  _refreshUsernameField() { this._renderField(this.usernameFieldLabel, this._usernameBuffer); }
  _refreshChatInput()     { this._renderField(this.inputLabel,         this.inputText); }

  _refreshCountdown() {
    if (!this.cycleCountdownLabel) return;

    if (this.room === null || !this._nextCycleAt) {
      this.cycleCountdownLabel.text = "";
      return;
    }

    const remainMs  = this._nextCycleAt - Date.now();
    const remainSec = remainMs > 0 ? Math.ceil(remainMs / 1000) : 0;
    this.cycleCountdownLabel.text = "auto: " + remainSec + "s";
  }

  // ---------- Screens ----------

  _buildUsernameScreen() {
    const W = Viewport.width;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#101820",
      stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: "#2a2a3a",
      stroke: "#5a5a7a",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this.exit(),
    }));

    const cx = W / 2;
    const titleY = this.mobile ? 140 : 200;

    screen.add(new Text({
      x: cx, y: titleY,
      text: "Battleship - Username:",
      font: this.mobile ? "bold 40px sans-serif" : "bold 36px sans-serif",
      color: "#d8e4f7",
      align: "center",
      baseline: "middle",
    }));

    const fieldW = this.mobile ? W - 80 : 720;
    const fieldH = this.mobile ? 72 : 56;
    const fieldX = cx - fieldW / 2;
    const fieldY = this.mobile ? titleY + 60 : 260;

    const field = new Panel({
      x: fieldX, y: fieldY, w: fieldW, h: fieldH,
      fill: "#0a1018",
      stroke: "#3a4d70",
      strokeWidth: 2,
      radius: 6,
    });
    screen.add(field);

    this.usernameFieldLabel = new Label({
      x: 0, y: 0, w: "100%", h: "100%",
      text: "",
      textOptions: {
        font: this.mobile ? "22px monospace" : "18px monospace",
        color: "#d8e4f7",
        align: "left",
        baseline: "middle",
      },
    });
    this.usernameFieldLabel.text.x = 14;
    this.usernameFieldLabel.text.y = "50%";
    field.add(this.usernameFieldLabel);

    this.usernameErrorLabel = new Text({
      x: cx, y: fieldY + fieldH + 24,
      text: "",
      font: "16px monospace",
      color: "#e06060",
      align: "center",
      baseline: "middle",
    });
    screen.add(this.usernameErrorLabel);

    if (this.mobile) {
      const kbMargin = 40;
      const kbW      = W - kbMargin * 2;
      const kbX      = kbMargin;
      const kbY      = fieldY + fieldH + 60;

      this.usernameKeyboard = new Keyboard({
        x: kbX, y: kbY,
        w: kbW,
        onKey: (char) => this._handleUsernameKey({ key: char, length: 1 }),
      });
      screen.add(this.usernameKeyboard);

      const kbH  = this.usernameKeyboard.h;
      const btnW = kbW;
      const btnH = 72;
      const btnX = kbX;
      const btnY = kbY + kbH + 20;

      screen.add(new Button({
        x: btnX, y: btnY, w: btnW, h: btnH,
        text: "Enter",
        fill: "#2a3552",
        stroke: "#6a86b8",
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 26px sans-serif", color: "#ffffff" },
        onClick: () => this._submitUsername(),
      }));
    } else {
      this.usernameKeyboard = null;

      screen.add(new Button({
        x: cx - 110, y: fieldY + fieldH + 70,
        w: 220, h: 56,
        text: "Enter",
        fill: "#2a3552",
        stroke: "#6a86b8",
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._submitUsername(),
      }));
    }

    return screen;
  }

  _buildRoomScreen() {
    const W = Viewport.width;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#101820",
      stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: "#2a2a3a",
      stroke: "#5a5a7a",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._goBack(),
    }));

    const cx = W / 2;

    screen.add(new Text({
      x: cx, y: this.mobile ? 140 : 160,
      text: "Select a Room:",
      font: this.mobile ? "bold 40px sans-serif" : "bold 36px sans-serif",
      color: "#d8e4f7",
      align: "center",
      baseline: "middle",
    }));

    const btnW = this.mobile ? W - 80 : 480;
    const btnH = this.mobile ? 96 : 72;
    const gap  = this.mobile ? 24 : 20;
    let   y    = this.mobile ? 240 : 260;

    this.roomButtons = {};

    for (const roomName of ROOMS) {
      const btn = new Button({
        x: cx - btnW / 2, y,
        w: btnW, h: btnH,
        text: ROOM_LABELS[roomName] + "  ?/2",
        fill: "#1a2434",
        stroke: "#3a4d70",
        strokeWidth: 2,
        radius: 8,
        textOptions: {
          font: this.mobile ? "bold 28px sans-serif" : "bold 22px sans-serif",
          color: "#d8e4f7",
        },
        onClick: () => this._joinRoom(roomName),
      });
      screen.add(btn);
      this.roomButtons[roomName] = btn;
      y += btnH + gap;
    }

    this.roomStatusLabel = new Text({
      x: cx, y: this.mobile ? y + 20 : 520,
      text: "",
      font: this.mobile ? "18px monospace" : "16px monospace",
      color: "#8fa9d0",
      align: "center",
      baseline: "middle",
    });
    screen.add(this.roomStatusLabel);

    return screen;
  }

  // ---------- Game screen ----------

  _buildGameScreen() {
    const W = Viewport.width;
    const H = Viewport.height;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#101820",
      stroke: null,
    });

    // Header strip. Same shape on desktop and mobile.
    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Leave",
      fill: "#3a2a2a",
      stroke: "#8f6060",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._leaveRoom(),
    }));

    this.updateBtn = new Button({
      x: W - 164, y: 24, w: 140, h: 48,
      text: "Update",
      fill: "#2a3552",
      stroke: "#6a86b8",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._manualUpdate(),
    });
    screen.add(this.updateBtn);

    this.cycleCountdownLabel = new Text({
      x: W - 164 + 70,
      y: 24 + 48 + 16,
      text: "",
      font: "14px monospace",
      color: "#5f7a95",
      align: "center",
      baseline: "middle",
    });
    screen.add(this.cycleCountdownLabel);

    this.roomTitleLabel = new Text({
      x: W / 2,
      y: 48,
      text: "",
      font: "bold 20px sans-serif",
      color: "#d8e4f7",
      align: "center",
      baseline: "middle",
    });
    screen.add(this.roomTitleLabel);

    this.turnLabel = new Text({
      x: W / 2,
      y: 78,
      text: "",
      font: "bold 18px sans-serif",
      color: "#a0c0ff",
      align: "center",
      baseline: "middle",
    });
    screen.add(this.turnLabel);

    this.feedbackLabel = new Text({
      x: W / 2,
      y: 104,
      text: "",
      font: "bold 16px sans-serif",
      color: "#ffd060",
      align: "center",
      baseline: "middle",
    });
    screen.add(this.feedbackLabel);

    this.statusLabel = new Text({
      x: 180,
      y: 36,
      text: "",
      font: "14px monospace",
      color: "#8fa9d0",
      align: "left",
      baseline: "middle",
    });
    screen.add(this.statusLabel);

    // Boards. Desktop: side by side. Mobile: stacked vertically.
    if (this.mobile) {
      this._buildBoardsMobile(screen);
    } else {
      this._buildBoardsDesktop(screen);
    }

    // Chat button + unread badge (bottom-right on both).
    this.chatBtn = new Button({
      x: W - 164, y: H - 60, w: 140, h: 44,
      text: "Chat",
      fill: "#2a3552",
      stroke: "#6a86b8",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._toggleChat(),
    });
    screen.add(this.chatBtn);

    this.unreadBadge = new Text({
      x: W - 20, y: H - 76,
      text: "",
      font: "bold 22px sans-serif",
      color: "#ff5050",
      align: "center",
      baseline: "middle",
    });
    screen.add(this.unreadBadge);

    // Chat overlay (hidden by default).
    this._buildChatPanel(screen);

    return screen;
  }

  // ---------- Boards: desktop ----------

  _buildBoardsDesktop(screen) {
    const W = Viewport.width;

    const cell    = 36;
    const boardPx = cell * BOARD_W;
    const gap     = 80;
    const totalW  = boardPx * 2 + gap;
    const bx      = (W - totalW) / 2;
    const by      = 150;

    this._cell     = cell;
    this._myBx     = bx;
    this._myBy     = by;
    this._opBx     = bx + boardPx + gap;
    this._opBy     = by;
    this._boardPx  = boardPx;

    this._drawBoardFrame(screen, this._myBx, this._myBy, boardPx, cell, "YOUR WATERS",  "#80a0c0");
    this._drawBoardFrame(screen, this._opBx, this._opBy, boardPx, cell, "ENEMY WATERS", "#c08080");

    this.myLayer = new Panel({
      x: this._myBx, y: this._myBy,
      w: boardPx, h: boardPx,
      fill: null, stroke: null,
    });
    screen.add(this.myLayer);

    this.opLayer = new Panel({
      x: this._opBx, y: this._opBy,
      w: boardPx, h: boardPx,
      fill: null, stroke: null,
    });
    screen.add(this.opLayer);

    // Controls legend (desktop only).
    screen.add(new Text({
      x: W / 2, y: Viewport.height - 40,
      text: "Mouse: hover and click. Keys: WASD/Arrows move, R rotate, Enter place or lock a shot.",
      font: "13px monospace",
      color: "#607080",
      align: "center",
      baseline: "middle",
    }));

    this._buildActionRow(screen, Viewport.height - 96);
  }

  // ---------- Boards: mobile ----------

  _buildBoardsMobile(screen) {
    const W = Viewport.width;
    const H = Viewport.height;

    const cell    = 46;
    const boardPx = cell * BOARD_W;   // 460
    const bx      = (W - boardPx) / 2;

    const myBy = 150;
    const opBy = myBy + boardPx + 60;

    this._cell     = cell;
    this._myBx     = bx;
    this._myBy     = myBy;
    this._opBx     = bx;
    this._opBy     = opBy;
    this._boardPx  = boardPx;

    this._drawBoardFrame(screen, this._myBx, this._myBy, boardPx, cell, "YOUR WATERS",  "#80a0c0");
    this._drawBoardFrame(screen, this._opBx, this._opBy, boardPx, cell, "ENEMY WATERS", "#c08080");

    this.myLayer = new Panel({
      x: this._myBx, y: this._myBy,
      w: boardPx, h: boardPx,
      fill: null, stroke: null,
    });
    screen.add(this.myLayer);

    this.opLayer = new Panel({
      x: this._opBx, y: this._opBy,
      w: boardPx, h: boardPx,
      fill: null, stroke: null,
    });
    screen.add(this.opLayer);

    // Action row: below the enemy board.
    const actionY = this._opBy + boardPx + 20;
    this._buildActionRow(screen, actionY);

    // Show Controls toggle for the fire D-pad. Positioned under the
    // action row. Hidden unless in the fire phase.
    const showCtrlY = actionY + 64;
    this.controlsToggle = new Button({
      x: W / 2 - 160, y: showCtrlY, w: 320, h: 52,
      text: "Show Controls",
      fill: BTN_DARK_FILL,
      stroke: BTN_DARK_STROKE,
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
      onClick: () => this._toggleControls(),
    });
    this.controlsToggle.visible = false;
    screen.add(this.controlsToggle);

    // D-pad. Positioned below the Show Controls button, in the space
    // above the Chat button. Buttons start hidden.
    const dpadCx    = W / 2;
    const dpadTop   = showCtrlY + 64;
    const btnSize   = 84;
    const gap       = 10;
    const centerY   = dpadTop + btnSize + gap / 2;

    this.dpadButtons = [];

    const defs = [
      { text: "^", dir: "up",
        x: dpadCx - btnSize / 2,
        y: centerY - btnSize - gap / 2 },
      { text: "v", dir: "down",
        x: dpadCx - btnSize / 2,
        y: centerY + gap / 2 },
      { text: "<", dir: "left",
        x: dpadCx - btnSize - gap / 2 - btnSize / 2,
        y: centerY - btnSize / 2 },
      { text: ">", dir: "right",
        x: dpadCx + gap / 2 + btnSize / 2,
        y: centerY - btnSize / 2 },
    ];

    for (const d of defs) {
      const b = new Button({
        x: d.x, y: d.y, w: btnSize, h: btnSize,
        text: d.text,
        fill: BTN_DARK_FILL,
        stroke: BTN_DARK_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 32px sans-serif", color: "#d8e4f7" },
        onClick: () => this._nudgeFireCursor(d.dir),
      });
      b.visible = false;
      screen.add(b);
      this.dpadButtons.push(b);
    }

    void H;
  }

  // Draw the static frame of a board: label above, dark panel behind,
  // grid lines. Cell size and board pixel size are passed in.
  _drawBoardFrame(screen, bx, by, boardPx, cell, label, labelColor) {
    screen.add(new Text({
      x: bx, y: by - 28,
      text: label,
      font: "bold 14px monospace",
      color: labelColor,
      align: "left",
      baseline: "middle",
    }));

    screen.add(new Panel({
      x: bx - 2, y: by - 2,
      w: boardPx + 4, h: boardPx + 4,
      fill: "#0a0e12",
      stroke: "#2a3238",
      strokeWidth: 2,
    }));

    for (let i = 0; i <= BOARD_W; i++) {
      screen.add(new Line({
        x1: bx + i * cell, y1: by,
        x2: bx + i * cell, y2: by + boardPx,
        stroke: "#1e262c", strokeWidth: 1,
      }));
      screen.add(new Line({
        x1: bx, y1: by + i * cell,
        x2: bx + boardPx, y2: by + i * cell,
        stroke: "#1e262c", strokeWidth: 1,
      }));
    }
  }

  // ---------- Action row ----------

  // Builds the row of action buttons at the given y. The actual
  // visibility and colors are driven by _renderButtons. Positions
  // here are the "desktop-like" spread; on mobile we use a narrower
  // spread since the boards are stacked and the row sits below the
  // enemy board.
  _buildActionRow(screen, actionY) {
    const W = Viewport.width;
    const mobile = this.mobile;

    // Vote buttons: Me / Defer.
    if (mobile) {
      this.voteMeBtn = new Button({
        x: 40, y: actionY, w: 200, h: 56,
        text: "Me",
        fill: BTN_BLUE_FILL,
        stroke: BTN_BLUE_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._setVote("me"),
      });
      this.voteMeBtn.visible = false;
      screen.add(this.voteMeBtn);

      this.voteDeferBtn = new Button({
        x: 260, y: actionY, w: 200, h: 56,
        text: "Defer",
        fill: BTN_BLUE_FILL,
        stroke: BTN_BLUE_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._setVote("defer"),
      });
      this.voteDeferBtn.visible = false;
      screen.add(this.voteDeferBtn);

      this.readyBtn = new Button({
        x: 480, y: actionY, w: 200, h: 56,
        text: "Ready",
        fill: BTN_GREEN_FILL,
        stroke: BTN_GREEN_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._toggleReady(),
      });
      this.readyBtn.visible = false;
      screen.add(this.readyBtn);

      // Placement controls. Three slots on the row, plus a separate
      // "Place Ships" button when not yet placing.
      this.placeBtn = new Button({
        x: W / 2 - 220, y: actionY, w: 440, h: 56,
        text: "Place Ships",
        fill: BTN_BLUE_FILL,
        stroke: BTN_BLUE_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._beginPlacement(),
      });
      this.placeBtn.visible = false;
      screen.add(this.placeBtn);

      this.lockBtn = new Button({
        x: 40, y: actionY, w: 200, h: 56,
        text: "Lock In",
        fill: BTN_GREEN_FILL,
        stroke: BTN_GREEN_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._lockIn(),
      });
      this.lockBtn.visible = false;
      screen.add(this.lockBtn);

      this.rotateBtn = new Button({
        x: 260, y: actionY, w: 200, h: 56,
        text: "Rotate",
        fill: BTN_DARK_FILL,
        stroke: BTN_DARK_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._rotatePlace(),
      });
      this.rotateBtn.visible = false;
      screen.add(this.rotateBtn);

      this.nextBtn = new Button({
        x: 480, y: actionY, w: 200, h: 56,
        text: "Next",
        fill: BTN_GREEN_FILL,
        stroke: BTN_GREEN_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._nextPlace(),
      });
      this.nextBtn.visible = false;
      screen.add(this.nextBtn);

      this.resetBtn = new Button({
        x: 260, y: actionY, w: 200, h: 56,
        text: "Reset",
        fill: BTN_DARK_FILL,
        stroke: BTN_DARK_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._resetPlacement(),
      });
      this.resetBtn.visible = false;
      screen.add(this.resetBtn);

      this.fireBtn = new Button({
        x: W / 2 - 120, y: actionY, w: 240, h: 56,
        text: "Fire!",
        fill: BTN_RED_FILL,
        stroke: BTN_RED_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 24px sans-serif", color: "#ffffff" },
        onClick: () => this._fireLockedShot(),
      });
      this.fireBtn.visible = false;
      screen.add(this.fireBtn);
    } else {
      this.voteMeBtn = new Button({
        x: W / 2 - 310, y: actionY, w: 200, h: 52,
        text: "Me",
        fill: BTN_BLUE_FILL,
        stroke: BTN_BLUE_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
        onClick: () => this._setVote("me"),
      });
      this.voteMeBtn.visible = false;
      screen.add(this.voteMeBtn);

      this.voteDeferBtn = new Button({
        x: W / 2 - 100, y: actionY, w: 200, h: 52,
        text: "Defer",
        fill: BTN_BLUE_FILL,
        stroke: BTN_BLUE_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
        onClick: () => this._setVote("defer"),
      });
      this.voteDeferBtn.visible = false;
      screen.add(this.voteDeferBtn);

      this.readyBtn = new Button({
        x: W / 2 + 110, y: actionY, w: 200, h: 52,
        text: "Ready",
        fill: BTN_GREEN_FILL,
        stroke: BTN_GREEN_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
        onClick: () => this._toggleReady(),
      });
      this.readyBtn.visible = false;
      screen.add(this.readyBtn);

      this.lockBtn = new Button({
        x: W / 2 - 340, y: actionY, w: 200, h: 52,
        text: "Lock In",
        fill: BTN_GREEN_FILL,
        stroke: BTN_GREEN_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
        onClick: () => this._lockIn(),
      });
      this.lockBtn.visible = false;
      screen.add(this.lockBtn);

      this.rotateBtn = new Button({
        x: W / 2 - 120, y: actionY, w: 240, h: 52,
        text: "Rotate (R)",
        fill: BTN_DARK_FILL,
        stroke: BTN_DARK_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
        onClick: () => this._rotatePlace(),
      });
      this.rotateBtn.visible = false;
      screen.add(this.rotateBtn);

      this.resetBtn = new Button({
        x: W / 2 + 140, y: actionY, w: 200, h: 52,
        text: "Reset",
        fill: BTN_DARK_FILL,
        stroke: BTN_DARK_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
        onClick: () => this._resetPlacement(),
      });
      this.resetBtn.visible = false;
      screen.add(this.resetBtn);

      this.placeBtn = new Button({
        x: W / 2 - 160, y: actionY, w: 320, h: 52,
        text: "Place Ships",
        fill: BTN_BLUE_FILL,
        stroke: BTN_BLUE_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
        onClick: () => this._beginPlacement(),
      });
      this.placeBtn.visible = false;
      screen.add(this.placeBtn);

      this.fireBtn = new Button({
        x: W / 2 - 110, y: actionY, w: 220, h: 52,
        text: "Fire!",
        fill: BTN_RED_FILL,
        stroke: BTN_RED_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 22px sans-serif", color: "#ffffff" },
        onClick: () => this._fireLockedShot(),
      });
      this.fireBtn.visible = false;
      screen.add(this.fireBtn);

      // Desktop has no Next button.
      this.nextBtn = null;

      // Desktop has no D-pad or Show Controls toggle.
      this.controlsToggle = null;
      this.dpadButtons = [];
    }

    // Outcome banner (both). Shown between the boards and the action
    // row while waiting for both fleets.
    this.outcomeLabel = new Text({
      x: W / 2,
      y: actionY - 30,
      text: "",
      font: "bold 16px sans-serif",
      color: "#a0c0ff",
      align: "center",
      baseline: "middle",
    });
    this.outcomeLabel.visible = false;
    screen.add(this.outcomeLabel);
  }

  _buildChatPanel(screen) {
    const W = Viewport.width;
    const H = Viewport.height;

    if (this.mobile) {
      // Full-screen overlay. Everything except the Chat button.
      const panel = new Panel({
        x: 0, y: 0, w: W, h: H,
        fill: "#0d1216",
        stroke: null,
      });
      panel.visible = false;
      screen.add(panel);
      this.chatPanel = panel;

      const titleY = 30;
      panel.add(new Text({
        x: 20, y: titleY,
        text: "Room Chat",
        font: "bold 20px sans-serif",
        color: "#8fa9d0",
        align: "left",
        baseline: "middle",
      }));

      // Keyboard at the bottom.
      const kbMargin = 40;
      const kbW      = W - kbMargin * 2;
      const kbX      = kbMargin;

      this.chatKeyboard = new Keyboard({
        x: kbX, y: 0,
        w: kbW,
        onKey: (char) => this._handleChatKey({ key: char, length: 1 }),
      });
      const kbH = this.chatKeyboard.h;
      const kbY = H - kbH - 20;
      this.chatKeyboard.x = kbX;
      this.chatKeyboard.y = kbY;
      this.chatKeyboard.visible = false;
      panel.add(this.chatKeyboard);

      // Input row above the keyboard.
      const rowY = kbY - 70;
      const inputX = 20;
      const sendW  = 110;
      const inputW = W - 40 - sendW - 12;

      const inputPanel = new Panel({
        x: inputX, y: rowY,
        w: inputW, h: 56,
        fill: "#0a1018",
        stroke: "#2a3552",
        strokeWidth: 2,
        radius: 6,
      });
      panel.add(inputPanel);

      this.inputLabel = new Label({
        x: 0, y: 0, w: "100%", h: "100%",
        text: "",
        textOptions: {
          font: "18px monospace",
          color: "#d8e4f7",
          align: "left",
          baseline: "middle",
        },
      });
      this.inputLabel.text.x = 12;
      this.inputLabel.text.y = "50%";
      inputPanel.add(this.inputLabel);

      this.sendBtn = new Button({
        x: W - 20 - sendW, y: rowY, w: sendW, h: 56,
        text: "Send",
        fill: BTN_GREEN_FILL,
        stroke: BTN_GREEN_STROKE,
        strokeWidth: 2,
        radius: 6,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._sendChat(),
      });
      panel.add(this.sendBtn);

      // Log above the input row.
      const logX = 20;
      const logY = 60;
      const logW = W - 40;
      const logH = rowY - logY - 12;

      this._chatMaxLines = Math.floor((logH - 8) / 22);

      this.chatMessageTexts = [];
      for (let i = 0; i < this._chatMaxLines; i++) {
        const t = new Text({
          x: logX + 4,
          y: logY + 4 + i * 22,
          text: "",
          font: "16px monospace",
          color: "#c8d0d8",
          align: "left",
          baseline: "top",
        });
        panel.add(t);
        this.chatMessageTexts.push(t);
      }
    } else {
      const pw = 420;
      const ph = 320;
      const px = W - pw - 20;
      const py = H - ph - 120;

      const panel = new Panel({
        x: px, y: py, w: pw, h: ph,
        fill: "#0d1216",
        stroke: "#3a4d70",
        strokeWidth: 2,
        radius: 8,
      });
      panel.visible = false;
      screen.add(panel);

      this.chatPanel = panel;

      panel.add(new Text({
        x: 12, y: 10,
        text: "Room Chat",
        font: "bold 14px sans-serif",
        color: "#8fa9d0",
        align: "left",
        baseline: "top",
      }));

      panel.add(new Button({
        x: pw - 84, y: 6, w: 72, h: 26,
        text: "Hide",
        fill: BTN_DARK_FILL,
        stroke: BTN_DARK_STROKE,
        strokeWidth: 1,
        radius: 4,
        textOptions: { font: "bold 12px sans-serif", color: "#ffffff" },
        onClick: () => this._toggleChat(),
      }));

      const logX = 12;
      const logY = 40;
      const logW = pw - 24;
      const logH = ph - 40 - 60;

      this._chatLogW = logW;
      this._chatMaxLines = Math.floor((logH - 8) / 18);

      this.chatMessageTexts = [];
      for (let i = 0; i < this._chatMaxLines; i++) {
        const t = new Text({
          x: logX + 4,
          y: logY + 4 + i * 18,
          text: "",
          font: "13px monospace",
          color: "#c8d0d8",
          align: "left",
          baseline: "top",
        });
        panel.add(t);
        this.chatMessageTexts.push(t);
      }

      const rowY = ph - 48;
      const inputX = 12;
      const inputW = pw - 24 - 96 - 8;

      const inputPanel = new Panel({
        x: inputX, y: rowY,
        w: inputW, h: 36,
        fill: "#0a1018",
        stroke: "#2a3552",
        strokeWidth: 1,
        radius: 4,
      });
      panel.add(inputPanel);

      this.inputLabel = new Label({
        x: 0, y: 0, w: "100%", h: "100%",
        text: "",
        textOptions: {
          font: "14px monospace",
          color: "#d8e4f7",
          align: "left",
          baseline: "middle",
        },
      });
      this.inputLabel.text.x = 8;
      this.inputLabel.text.y = "50%";
      inputPanel.add(this.inputLabel);

      this.sendBtn = new Button({
        x: pw - 12 - 96, y: rowY, w: 96, h: 36,
        text: "Send",
        fill: BTN_GREEN_FILL,
        stroke: BTN_GREEN_STROKE,
        strokeWidth: 1,
        radius: 4,
        textOptions: { font: "bold 14px sans-serif", color: "#ffffff" },
        onClick: () => this._sendChat(),
      });
      panel.add(this.sendBtn);

      this.chatKeyboard = null;
    }
  }

  // ---------- Screen navigation ----------

  _applyScreen(name) {
    this.usernameScreen.visible = name === "username";
    this.roomScreen.visible     = name === "room";
    this.gameScreen.visible     = name === "game";

    this._cursorOn    = true;
    this._cursorTimer = 0;

    if (name !== "game") {
      this._stopCycle();
    }

    this._refreshUsernameField();
    this._refreshChatInput();
    this._refreshCountdown();

    if (name !== "room" && this.roomStatusLabel) {
      this.roomStatusLabel.text = "";
    }

    if (name === "game") {
      this._renderAll();
    }
  }

  _pushScreen(name) {
    this.stack.push(name);
    this._applyScreen(name);

    if (name === "room") this._refreshRoomOccupancy();
  }

  _goBack() {
    if (this.stack.length <= 1) return;
    const leaving = this.stack[this.stack.length - 1];

    if (leaving === "game") {
      this._leaveRoomInternal();
      return;
    }

    this.stack.pop();
    this._applyScreen(this.stack[this.stack.length - 1]);
  }

  // ---------- Status line ----------

  _setStatus(msg) {
    const top = this.stack[this.stack.length - 1];
    const text = msg || "";
    if (top === "game" && this.statusLabel) {
      this.statusLabel.text = text;
    } else if (this.roomStatusLabel) {
      this.roomStatusLabel.text = text;
    }
  }

  _clearStatus() {
    this._setStatus("");
  }

  // ---------- Room occupancy ----------

  async _refreshRoomOccupancy() {
    for (const name of ROOMS) {
      this.roomButtons[name].setText(ROOM_LABELS[name] + "  ?/2");
    }

    let counts;
    try {
      counts = await this._readAllRoomCounts();
    } catch (e) {
      this._setStatus("Could not read room occupancy.");
      return;
    }

    for (const name of ROOMS) {
      const c = counts[name] || 0;
      this.roomButtons[name].setText(ROOM_LABELS[name] + "  " + c + "/2");
    }
  }

  async _readAllRoomCounts() {
    return await this._serialize(async () => {
      const ctx = await this._fetchTreeContext();

      const out = {};
      for (const name of ROOMS) {
        const path  = DATA_ROOT + name + "/presence.txt";
        const entry = ctx.entries.get(path);
        let content = "";
        if (entry) {
          content = await this._readBlob(entry.sha);
        }
        out[name] = this._countPresent(content);
      }
      return out;
    });
  }

  // ---------- Username submit ----------

  _submitUsername() {
    const raw = this._usernameBuffer.trim();
    if (!raw) {
      this.usernameErrorLabel.text = "Username required.";
      return;
    }
    const name = this._sanitizeUsername(raw);
    if (!name) {
      this.usernameErrorLabel.text = "Username must contain letters or digits.";
      return;
    }
    this.usernameErrorLabel.text = "";
    this.username = name;
    this._pushScreen("room");
  }

  _sanitizeUsername(s) {
    return s.replace(/\|/g, "").replace(/\n/g, "").replace(/\r/g, "").trim();
  }

  // =================================================================
  // Git Data API primitives.
  // =================================================================

  _authHeaders() {
    return {
      "Authorization": "Bearer " + this.session,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  _jsonHeaders() {
    return Object.assign({ "Content-Type": "application/json" }, this._authHeaders());
  }

  async _readCommitByRef() {
    const url = API + "commits/" + encodeURIComponent(BRANCH);
    const res = await fetch(url, { headers: this._authHeaders(), cache: "no-store" });
    if (res.status === 401) throw new Error("BAD_SESSION");
    if (!res.ok) throw new Error("READ_COMMIT_FAILED_" + res.status);
    const json = await res.json();
    return { commitSha: json.sha, treeSha: json.commit.tree.sha };
  }

  async _readRef() {
    const url = API + "git/ref/heads/" + encodeURIComponent(BRANCH);
    const res = await fetch(url, { headers: this._authHeaders(), cache: "no-store" });
    if (res.status === 401) throw new Error("BAD_SESSION");
    if (!res.ok) throw new Error("READ_REF_FAILED_" + res.status);
    const json = await res.json();
    return json.object.sha;
  }

  async _readTreeEntries(treeSha) {
    const url = API + "git/trees/" + treeSha + "?recursive=1";
    const res = await fetch(url, { headers: this._authHeaders(), cache: "no-store" });
    if (res.status === 401) throw new Error("BAD_SESSION");
    if (!res.ok) throw new Error("READ_TREE_FAILED_" + res.status);
    const json = await res.json();

    const map = new Map();
    for (const entry of json.tree || []) {
      if (entry.type === "blob") {
        map.set(entry.path, { sha: entry.sha, mode: entry.mode });
      }
    }
    return map;
  }

  async _readBlob(blobSha) {
    const url = API + "git/blobs/" + blobSha;
    const res = await fetch(url, { headers: this._authHeaders(), cache: "no-store" });
    if (res.status === 401) throw new Error("BAD_SESSION");
    if (!res.ok) throw new Error("READ_BLOB_FAILED_" + res.status);
    const json = await res.json();
    if (!json.content) return "";
    return fromBase64(json.content);
  }

  async _fetchTreeContext() {
    const c = await this._readCommitByRef();
    const entries = await this._readTreeEntries(c.treeSha);
    return { commitSha: c.commitSha, treeSha: c.treeSha, entries };
  }

  async _readPresenceFromEntries(ctxEntries, room) {
    const path  = DATA_ROOT + room + "/presence.txt";
    const entry = ctxEntries.get(path);
    let content = "";
    if (entry) {
      content = await this._readBlob(entry.sha);
    }
    return { content, entries: this._parsePresence(content) };
  }

  async _createBlob(content) {
    const url = API + "git/blobs";
    const res = await fetch(url, {
      method: "POST",
      headers: this._jsonHeaders(),
      body: JSON.stringify({ content: toBase64(content), encoding: "base64" }),
    });
    if (res.status === 401) throw new Error("BAD_SESSION");
    if (!res.ok) throw new Error("CREATE_BLOB_FAILED_" + res.status);
    const json = await res.json();
    return json.sha;
  }

  async _postTree(entries, baseTreeSha) {
    const url  = API + "git/trees";
    const body = { tree: entries };
    if (baseTreeSha) body.base_tree = baseTreeSha;

    const res = await fetch(url, {
      method: "POST",
      headers: this._jsonHeaders(),
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new Error("BAD_SESSION");
    if (!res.ok) throw new Error("CREATE_TREE_FAILED_" + res.status);
    const json = await res.json();
    return json.sha;
  }

  async _createTreeWithChange(baseTreeSha, path, blobSha) {
    return await this._postTree([{
      path: path,
      mode: "100644",
      type: "blob",
      sha: blobSha,
    }], baseTreeSha);
  }

  async _createCommit(treeSha, parentCommitSha, message) {
    const url  = API + "git/commits";
    const body = { message, tree: treeSha, parents: [parentCommitSha] };

    const res = await fetch(url, {
      method: "POST",
      headers: this._jsonHeaders(),
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new Error("BAD_SESSION");
    if (!res.ok) throw new Error("CREATE_COMMIT_FAILED_" + res.status);
    const json = await res.json();
    return json.sha;
  }

  async _patchRef(newCommitSha) {
    const url = API + "git/refs/heads/" + encodeURIComponent(BRANCH);
    const res = await fetch(url, {
      method: "PATCH",
      headers: this._jsonHeaders(),
      body: JSON.stringify({ sha: newCommitSha, force: false }),
    });
    if (res.status === 401) throw new Error("BAD_SESSION");
    if (res.status === 409 || res.status === 422) throw new Error("CONFLICT");
    if (!res.ok) throw new Error("PATCH_REF_FAILED_" + res.status);
  }

  async _writeWithRetry(path, buildContent, message, hint) {
    let lastError = null;
    let retried   = false;

    for (let attempt = 0; attempt < PUT_MAX_RETRIES; attempt++) {
      if (attempt > 0) retried = true;

      let currentCommitSha;
      let treeSha;
      let entries;
      let currentContent = null;

      let hintUsed = false;
      if (attempt === 0 && hint && hint.commitSha && hint.entries) {
        let liveRef;
        try {
          liveRef = await this._readRef();
        } catch (e) {
          if (e.message === "BAD_SESSION") throw e;
          liveRef = null;
        }
        if (liveRef !== null && liveRef === hint.commitSha) {
          currentCommitSha = hint.commitSha;
          treeSha          = hint.treeSha;
          entries          = hint.entries;
          currentContent   = hint.content !== undefined ? hint.content : null;
          hintUsed         = true;
        }
      }

      if (!hintUsed) {
        try {
          const c  = await this._readCommitByRef();
          currentCommitSha = c.commitSha;
          treeSha          = c.treeSha;
          entries          = await this._readTreeEntries(treeSha);
        } catch (e) {
          if (e.message === "BAD_SESSION") throw e;
          lastError = e;
          await this._sleep(Math.random() * PUT_BACKOFF_MS);
          continue;
        }
      }

      if (currentContent === null) {
        currentContent = "";
        const entry = entries.get(path);
        if (entry) {
          try {
            currentContent = await this._readBlob(entry.sha);
          } catch (e) {
            if (e.message === "BAD_SESSION") throw e;
            lastError = e;
            await this._sleep(Math.random() * PUT_BACKOFF_MS);
            continue;
          }
        }
      }

      const toWrite = buildContent(currentContent);
      if (toWrite === null) {
        return { ok: false, retried };
      }

      let newBlobSha;
      let newTreeSha;
      let newCommitSha;
      try {
        newBlobSha   = await this._createBlob(toWrite);
        newTreeSha   = await this._createTreeWithChange(treeSha, path, newBlobSha);
        newCommitSha = await this._createCommit(newTreeSha, currentCommitSha, message);
      } catch (e) {
        if (e.message === "BAD_SESSION") throw e;
        lastError = e;
        await this._sleep(Math.random() * PUT_BACKOFF_MS);
        continue;
      }

      let verifyRef;
      try {
        verifyRef = await this._readRef();
      } catch (e) {
        if (e.message === "BAD_SESSION") throw e;
        lastError = e;
        await this._sleep(Math.random() * PUT_BACKOFF_MS);
        continue;
      }

      if (verifyRef === newCommitSha) {
        return { ok: true, retried };
      }

      if (verifyRef !== currentCommitSha) {
        lastError = new Error("CONFLICT");
        await this._sleep(Math.random() * PUT_BACKOFF_MS);
        continue;
      }

      try {
        await this._patchRef(newCommitSha);
      } catch (e) {
        if (e.message === "BAD_SESSION") throw e;
        try {
          const postRef = await this._readRef();
          if (postRef === newCommitSha) {
            return { ok: true, retried };
          }
        } catch (e2) {
          if (e2.message === "BAD_SESSION") throw e2;
        }
        lastError = e;
        await this._sleep(Math.random() * PUT_BACKOFF_MS);
        continue;
      }

      return { ok: true, retried };
    }

    throw lastError || new Error("WRITE_RETRIES_EXHAUSTED");
  }

  // =================================================================
  // Presence parsing and splicing.
  // =================================================================

  _parsePresence(content) {
    const lines = content ? content.split("\n") : [];
    const out = [];
    for (let i = 0; i < SLOTS; i++) {
      const line = lines[i] !== undefined ? lines[i] : "";
      if (!line.trim()) { out.push(null); continue; }
      const parts = line.split("|");
      if (parts.length < 3) { out.push(null); continue; }
      const slotStr  = parts[0];
      const username = parts[1];
      const iso      = parts[2];
      const slotNum  = parseInt(slotStr.replace(/^slot/, ""), 10);
      if (Number.isNaN(slotNum) || slotNum !== i) { out.push(null); continue; }
      if (!username || !iso) { out.push(null); continue; }
      out.push({ slot: i, username, iso });
    }
    return out;
  }

  _serializePresence(entries) {
    const out = [];
    for (let i = 0; i < SLOTS; i++) {
      const e = entries[i];
      if (!e) { out.push(""); continue; }
      out.push("slot" + i + "|" + e.username + "|" + e.iso);
    }
    return out.join("\n");
  }

  _splicePresenceLine(content, slotIndex, newLine) {
    const lines = content ? content.split("\n") : [];
    while (lines.length <= slotIndex) lines.push("");
    lines[slotIndex] = newLine;
    return lines.join("\n");
  }

  _countPresent(content) {
    const entries = this._parsePresence(content);
    let n = 0;
    for (const e of entries) {
      if (e && isPresent(e.iso)) n++;
    }
    return n;
  }

  // ---------- Room join ----------

  async _joinRoom(room) {
    if (this._joining) return;
    this._joining = true;

    this._setStatus("Joining " + ROOM_LABELS[room] + "...");

    try {
      let ctx;
      let pres;
      try {
        const r = await this._serialize(async () => {
          const c = await this._fetchTreeContext();
          const p = await this._readPresenceFromEntries(c.entries, room);
          return { ctx: c, pres: p };
        });
        ctx  = r.ctx;
        pres = r.pres;
      } catch (e) {
        this._handleApiError(e, "read presence");
        return;
      }

      let anyPresent = pres.entries.some(e => e && isPresent(e.iso));

      if (!anyPresent) {
        await this._sleep(DEAD_CONFIRM_MS);
        try {
          const r = await this._serialize(async () => {
            const c = await this._fetchTreeContext();
            const p = await this._readPresenceFromEntries(c.entries, room);
            return { ctx: c, pres: p };
          });
          ctx  = r.ctx;
          pres = r.pres;
        } catch (e) {
          this._handleApiError(e, "read presence (confirm)");
          return;
        }
        anyPresent = pres.entries.some(e => e && isPresent(e.iso));
      }

      if (!anyPresent) {
        this._setStatus("Resetting dead room...");

        try {
          await this._writeWithRetry(
            DATA_ROOT + room + "/game.txt",
            (cur) => (cur === "" ? null : ""),
            "reset " + room + " game"
          );
        } catch (e) {
          if (e.message === "BAD_SESSION") {
            this._handleApiError(e, "reset game");
            return;
          }
        }

        try {
          await this._writeWithRetry(
            DATA_ROOT + room + "/chat.txt",
            (cur) => (cur === "" ? null : ""),
            "reset " + room + " chat"
          );
        } catch (e) {
          if (e.message === "BAD_SESSION") {
            this._handleApiError(e, "reset chat");
            return;
          }
        }

        try {
          await this._writeWithRetry(
            DATA_ROOT + room + "/presence.txt",
            (cur) => (cur === "" ? null : this._serializePresence(new Array(SLOTS).fill(null))),
            "reset " + room + " presence"
          );
        } catch (e) {
          if (e.message === "BAD_SESSION") {
            this._handleApiError(e, "reset presence");
            return;
          }
        }

        try {
          const r = await this._serialize(async () => {
            const c = await this._fetchTreeContext();
            const p = await this._readPresenceFromEntries(c.entries, room);
            return { ctx: c, pres: p };
          });
          ctx  = r.ctx;
          pres = r.pres;
        } catch (e) {
          this._handleApiError(e, "read presence after reset");
          return;
        }
      }

      let slot = -1;
      for (let i = 0; i < SLOTS; i++) {
        const e = pres.entries[i];
        if (!e || !isPresent(e.iso)) { slot = i; break; }
      }

      if (slot < 0) {
        this._setStatus("Room is full.");
        return;
      }

      const path   = DATA_ROOT + room + "/presence.txt";
      const myIso  = nowIso();
      const myName = this.username;
      const self   = this;

      const hint = {
        commitSha: ctx.commitSha,
        treeSha:   ctx.treeSha,
        entries:   ctx.entries,
        content:   pres.content,
      };

      let claimResult;
      try {
        claimResult = await this._serialize(() =>
          this._writeWithRetry(
            path,
            (currentContent) => {
              const newLine = "slot" + slot + "|" + myName + "|" + myIso;
              return self._splicePresenceLine(currentContent, slot, newLine);
            },
            "join " + room,
            hint
          )
        );
      } catch (e) {
        this._handleApiError(e, "claim slot");
        return;
      }

      if (!claimResult.ok) {
        this._setStatus("Room is full.");
        return;
      }

      this.room        = room;
      this.slot        = slot;
      this.presenceEntries = pres.entries;
      this.game        = null;
      this.chatLines   = [];
      this._seenChatCount = 0;

      this.roomTitleLabel.text = ROOM_LABELS[room];
      this.inputText = "";
      this._refreshChatInput();

      this.placing   = false;
      this.placeIdx  = 0;
      this.placeRot  = false;
      this.myFleet   = null;
      this._placePreview = null;
      this.fireCursor = { x: 0, y: 0 };
      this.lockedShot = null;
      this.lastFeedback = "";
      this.myVote  = null;
      this.myReady = false;
      this.chatOpen = false;
      this.controlsVisible = false;
      if (this.chatPanel) this.chatPanel.visible = false;
      if (this.chatKeyboard) this.chatKeyboard.visible = false;
      this.unread = 0;

      this._pushScreen("game");
      this._clearStatus();

      this._startCycle();
    } finally {
      this._joining = false;
    }
  }

  // ---------- Leave ----------

  async _leaveRoom() {
    await this._leaveRoomInternal();
    while (this.stack.length > 1 && this.stack[this.stack.length - 1] !== "room") {
      this.stack.pop();
    }
    this._applyScreen("room");
    this._refreshRoomOccupancy();
  }

  async _leaveRoomInternal() {
    this._stopCycle();

    if (this.room !== null && this.slot !== null) {
      const room = this.room;
      const slot = this.slot;
      this.room = null;
      this.slot = null;

      const path = DATA_ROOT + room + "/presence.txt";
      const self = this;
      try {
        await this._serialize(() =>
          this._writeWithRetry(
            path,
            (currentContent) => {
              const newLine = "slot" + slot + "|" + self.username + "|" + LEAVE_TIMESTAMP;
              return self._splicePresenceLine(currentContent, slot, newLine);
            },
            "leave slot " + slot
          )
        );
      } catch (e) {
        // Best-effort.
      }
    }
  }

  // ---------- Cycle scheduler ----------

  _startCycle() {
    this._stopCycle();
    this._cycleDelay  = CYCLE_MS;
    const initial     = Math.floor(Math.random() * PRESTAGGER_MAX_MS);
    this._nextCycleAt = Date.now() + initial;
    this._refreshCountdown();
    this._cycleTimer = setTimeout(() => this._runCycleLoop(), initial);
  }

  _stopCycle() {
    if (this._cycleTimer) {
      clearTimeout(this._cycleTimer);
      this._cycleTimer = null;
    }
    this._nextCycleAt = 0;
    this._refreshCountdown();
  }

  _kickCycle() {
    if (this.room === null) return;
    if (this._cycleTimer) {
      clearTimeout(this._cycleTimer);
      this._cycleTimer = null;
    }
    this._runCycleLoop();
  }

  async _runCycleLoop() {
    if (this.room === null) return;

    this._nextCycleAt = 0;
    this._refreshCountdown();

    this._busyStart(this.updateBtn);

    let retried = false;
    try {
      retried = await this._cycle();
    } catch (e) {
      if (e && e.message === "BAD_SESSION") {
        this._busyEnd(this.updateBtn);
        this._handleApiError(e, "cycle");
        return;
      }
    }

    this._busyEnd(this.updateBtn);

    if (retried) {
      const nudge = STAGGER_MIN_MS + Math.floor(Math.random() * (STAGGER_MAX_MS - STAGGER_MIN_MS));
      this._cycleDelay += nudge;
    } else {
      this._cycleDelay = CYCLE_MS;
    }

    if (this.room === null) return;

    this._nextCycleAt = Date.now() + this._cycleDelay;
    this._refreshCountdown();
    this._cycleTimer = setTimeout(() => this._runCycleLoop(), this._cycleDelay);
  }

  async _cycle() {
    if (this.room === null || this.slot === null) return false;

    let retried = false;

    await this._serialize(async () => {
      const ctx = await this._fetchTreeContext();

      // Presence.
      const presPath  = DATA_ROOT + this.room + "/presence.txt";
      const presEntry = ctx.entries.get(presPath);
      let presContent = "";
      if (presEntry) {
        presContent = await this._readBlob(presEntry.sha);
      }
      const presEntries = this._parsePresence(presContent);
      this.presenceEntries = presEntries;

      // Game state.
      const gamePath  = DATA_ROOT + this.room + "/game.txt";
      const gameEntry = ctx.entries.get(gamePath);
      let gameContent = "";
      if (gameEntry) {
        gameContent = await this._readBlob(gameEntry.sha);
      }
      this.game = this._decodeGame(gameContent);

      // Resolve the first-turn handshake if the game has not yet
      // started and both votes and both ready flags are in. The
      // resolved object is captured and assigned to this.game after
      // a successful write, so the client that performs the resolve
      // sees the outcome in the SAME cycle it resolved.
      const needsResolve = this.game
        && !this.game.started
        && this.game.voteP0 && this.game.voteP1
        && this.game.readyP0 && this.game.readyP1;

      if (needsResolve) {
        const hint = {
          commitSha: ctx.commitSha,
          treeSha:   ctx.treeSha,
          entries:   ctx.entries,
          content:   gameContent,
        };

        const self = this;
        let resolvedGame = null;

        try {
          const result = await this._writeWithRetry(
            gamePath,
            (currentContent) => {
              const g = self._decodeGame(currentContent);
              if (g.started) return null;
              if (!g.voteP0 || !g.voteP1) return null;
              if (!g.readyP0 || !g.readyP1) return null;

              const mode = self._resolveFirstMode(g.voteP0, g.voteP1);
              const turn = self._resolveFirstTurn(g.voteP0, g.voteP1);

              g.started   = true;
              g.turn      = turn;
              g.turnCount = (g.turnCount || 0) + 1;
              g.winner    = null;
              g.firstMode = mode;
              g.voteP0    = "";
              g.voteP1    = "";
              g.readyP0   = false;
              g.readyP1   = false;

              resolvedGame = g;
              return self._encodeGame(g);
            },
            "resolve first turn",
            hint
          );
          if (result.retried) retried = true;
          if (result.ok && resolvedGame) {
            this.game = resolvedGame;
          }
        } catch (e) {
          if (e && e.message === "BAD_SESSION") throw e;
          // Next cycle retries.
        }
      }

      // Chat.
      const chatPath  = DATA_ROOT + this.room + "/chat.txt";
      const chatEntry = ctx.entries.get(chatPath);
      let chatContent = "";
      if (chatEntry) {
        chatContent = await this._readBlob(chatEntry.sha);
      }
      const newChatLines = chatContent
        ? chatContent.split("\n").filter(l => l.length > 0)
        : [];

      if (newChatLines.length > this._seenChatCount) {
        if (!this.chatOpen) {
          this.unread += (newChatLines.length - this._seenChatCount);
        }
      }
      this.chatLines = newChatLines;
      if (this.chatOpen) {
        this._seenChatCount = newChatLines.length;
      }

      this._renderAll();
      this._renderChatLog();
      this._renderUnreadBadge();

      // Presence writeback.
      const mySlot = this.slot;
      const myName = this.username;
      const myIso  = nowIso();
      const self2  = this;

      const hint2 = {
        commitSha: ctx.commitSha,
        treeSha:   ctx.treeSha,
        entries:   ctx.entries,
        content:   presContent,
      };

      try {
        const result = await self2._writeWithRetry(
          presPath,
          (currentContent) => {
            const newLine = "slot" + mySlot + "|" + myName + "|" + myIso;
            return self2._splicePresenceLine(currentContent, mySlot, newLine);
          },
          "cycle presence " + mySlot,
          hint2
        );
        if (result.retried) retried = true;
      } catch (e) {
        if (e && e.message === "BAD_SESSION") throw e;
        // Best-effort.
      }
    });

    return retried;
  }

  _resolveFirstTurn(v0, v1) {
    if (v0 === "me" && v1 === "defer") return 0;
    if (v0 === "defer" && v1 === "me") return 1;
    return Math.random() < 0.5 ? 0 : 1;
  }

  _resolveFirstMode(v0, v1) {
    if (v0 === "me" && v1 === "defer") return "p1";
    if (v0 === "defer" && v1 === "me") return "p2";
    return "coin";
  }

  // ---------- Manual Update ----------

  async _manualUpdate() {
    if (this._updating) return;

    const now = Date.now();
    if (now - this._lastUpdate < UPDATE_THROTTLE) {
      const remain = Math.ceil((UPDATE_THROTTLE - (now - this._lastUpdate)) / 1000);
      this._setStatus("Please wait " + remain + "s before updating again.");
      setTimeout(() => this._clearStatus(), 2000);
      return;
    }

    this._updating   = true;
    this._lastUpdate = now;
    this._setStatus("Updating...");
    this._busyStart(this.updateBtn);

    if (this._cycleTimer) {
      clearTimeout(this._cycleTimer);
      this._cycleTimer = null;
    }
    this._nextCycleAt = 0;
    this._refreshCountdown();

    try {
      await this._cycle();
    } catch (e) {
      this._handleApiError(e, "update");
      this._updating = false;
      this._busyEnd(this.updateBtn);
      if (this.room !== null) {
        this._nextCycleAt = Date.now() + this._cycleDelay;
        this._refreshCountdown();
        this._cycleTimer = setTimeout(() => this._runCycleLoop(), this._cycleDelay);
      }
      return;
    }

    this._updating = false;
    this._clearStatus();
    this._busyEnd(this.updateBtn);

    if (this.room !== null) {
      this._nextCycleAt = Date.now() + this._cycleDelay;
      this._refreshCountdown();
      this._cycleTimer = setTimeout(() => this._runCycleLoop(), this._cycleDelay);
    }
  }

  // =================================================================
  // Game state encoding.
  //
  // Load-bearing format. If FLEET changes, _encodeGame and _decodeGame
  // must change together. See the header comment for the full layout.
  // =================================================================

  _encodeGame(g) {
    const L = [];
    L.push("#META");
    L.push("started=" + (g.started ? 1 : 0));
    L.push("turn=" + (g.turn == null ? -1 : g.turn));
    L.push("turnCount=" + (g.turnCount || 0));
    L.push("winner=" + (g.winner == null ? -1 : g.winner));
    L.push("firstMode=" + (g.firstMode || ""));
    L.push("voteP0=" + (g.voteP0 || ""));
    L.push("voteP1=" + (g.voteP1 || ""));
    L.push("readyP0=" + (g.readyP0 ? 1 : 0));
    L.push("readyP1=" + (g.readyP1 ? 1 : 0));

    for (let p = 0; p < SLOTS; p++) {
      L.push("#PLAYER " + p);
      const key = "p" + p;
      const pl = (g.players && g.players[key]) || null;
      if (!pl) {
        L.push("name=");
        L.push("fleet=");
        L.push("shots=");
      } else {
        L.push("name=" + (pl.name || "").replace(/[\n|\r]/g, ""));
        const fparts = [];
        if (pl.fleet) {
          for (const s of pl.fleet) {
            const cparts = s.cells.map(c => c.x + "," + c.y);
            fparts.push(cparts.join(":"));
          }
        }
        L.push("fleet=" + fparts.join(";"));
        const sparts = [];
        if (pl.shots) {
          for (const s of pl.shots) {
            sparts.push(s.x + "," + s.y + "," + (s.hit ? 1 : 0));
          }
        }
        L.push("shots=" + sparts.join("|"));
      }
    }
    return L.join("\n") + "\n";
  }

  _decodeGame(text) {
    const g = {
      started: false,
      turn: null,
      turnCount: 0,
      winner: null,
      firstMode: "",
      voteP0: "",
      voteP1: "",
      readyP0: false,
      readyP1: false,
      players: {},
    };
    if (!text) return g;

    const lines = text.split("\n");
    let section = null;
    let playerIdx = -1;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#META")) { section = "meta"; continue; }
      if (line.startsWith("#PLAYER")) {
        section = "player";
        playerIdx = parseInt(line.split(" ")[1] || "-1", 10);
        g.players["p" + playerIdx] = { name: "", fleet: [], shots: [] };
        continue;
      }
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const k = line.slice(0, eq);
      const v = line.slice(eq + 1);

      if (section === "meta") {
        if (k === "started") g.started = v === "1";
        else if (k === "turn") g.turn = v === "-1" ? null : parseInt(v, 10);
        else if (k === "turnCount") g.turnCount = parseInt(v, 10) || 0;
        else if (k === "winner") g.winner = v === "-1" ? null : parseInt(v, 10);
        else if (k === "firstMode") g.firstMode = v;
        else if (k === "voteP0") g.voteP0 = v;
        else if (k === "voteP1") g.voteP1 = v;
        else if (k === "readyP0") g.readyP0 = v === "1";
        else if (k === "readyP1") g.readyP1 = v === "1";
      } else if (section === "player" && playerIdx >= 0) {
        const pl = g.players["p" + playerIdx];
        if (k === "name") pl.name = v;
        else if (k === "fleet") {
          pl.fleet = [];
          if (v) {
            const ships = v.split(";");
            for (const sp of ships) {
              if (!sp) continue;
              const cells = sp.split(":").map(cp => {
                const xy = cp.split(",");
                return { x: parseInt(xy[0], 10), y: parseInt(xy[1], 10) };
              });
              pl.fleet.push({ name: "ship", len: cells.length, cells });
            }
          }
        } else if (k === "shots") {
          pl.shots = [];
          if (v) {
            const parts = v.split("|");
            for (const p of parts) {
              if (!p) continue;
              const xyz = p.split(",");
              pl.shots.push({
                x: parseInt(xyz[0], 10),
                y: parseInt(xyz[1], 10),
                hit: xyz[2] === "1",
              });
            }
          }
        }
      }
    }
    return g;
  }

  // =================================================================
  // First-turn vote + ready.
  // =================================================================

  async _setVote(vote) {
    if (this._votingWrite) return;
    if (!this.game) return;
    if (this.game.started) return;
    if (this.myReady) return;

    this._votingWrite = true;
    this._setStatus("Recording vote...");

    const btn = (vote === "me") ? this.voteMeBtn : this.voteDeferBtn;
    this._busyStart(btn);

    const mySlot = this.slot;
    const self   = this;

    try {
      await this._serialize(async () => {
        const ctx = await self._fetchTreeContext();
        const gamePath = DATA_ROOT + self.room + "/game.txt";
        const entry = ctx.entries.get(gamePath);
        let content = "";
        if (entry) content = await self._readBlob(entry.sha);

        const hint = {
          commitSha: ctx.commitSha,
          treeSha:   ctx.treeSha,
          entries:   ctx.entries,
          content:   content,
        };

        await self._writeWithRetry(
          gamePath,
          (currentContent) => {
            const g = self._decodeGame(currentContent);
            if (g.started) return null;
            const voteKey  = "voteP" + mySlot;
            const readyKey = "readyP" + mySlot;
            if (g[readyKey]) return null;
            g[voteKey] = vote;
            return self._encodeGame(g);
          },
          "vote " + mySlot,
          hint
        );
      });

      await this._refreshGameMirror();
      this.myVote = vote;
      this._clearStatus();
      this._renderAll();

      this._kickCycle();
    } catch (e) {
      this._handleApiError(e, "vote");
    } finally {
      this._votingWrite = false;
      this._busyEnd(btn);
    }
  }

  async _toggleReady() {
    if (this._votingWrite) return;
    if (!this.game) return;
    if (this.game.started) return;

    if (!this.myReady && !this.myVote) return;

    this._votingWrite = true;
    const wasReady = this.myReady;
    this._setStatus(wasReady ? "Unreadying..." : "Readying...");
    this._busyStart(this.readyBtn);

    const mySlot = this.slot;
    const self   = this;

    try {
      await this._serialize(async () => {
        const ctx = await self._fetchTreeContext();
        const gamePath = DATA_ROOT + self.room + "/game.txt";
        const entry = ctx.entries.get(gamePath);
        let content = "";
        if (entry) content = await self._readBlob(entry.sha);

        const hint = {
          commitSha: ctx.commitSha,
          treeSha:   ctx.treeSha,
          entries:   ctx.entries,
          content:   content,
        };

        await self._writeWithRetry(
          gamePath,
          (currentContent) => {
            const g = self._decodeGame(currentContent);
            if (g.started) return null;
            const voteKey  = "voteP" + mySlot;
            const readyKey = "readyP" + mySlot;
            const nextReady = !g[readyKey];
            if (nextReady && !g[voteKey]) return null;
            g[readyKey] = nextReady;
            return self._encodeGame(g);
          },
          (wasReady ? "unready " : "ready ") + mySlot,
          hint
        );
      });

      await this._refreshGameMirror();
      this.myVote  = (mySlot === 0 ? this.game.voteP0 : this.game.voteP1) || this.myVote;
      this.myReady = (mySlot === 0 ? this.game.readyP0 : this.game.readyP1);
      this._clearStatus();
      this._renderAll();

      this._kickCycle();
    } catch (e) {
      this._handleApiError(e, "ready");
    } finally {
      this._votingWrite = false;
      this._busyEnd(this.readyBtn);
    }
  }

  async _refreshGameMirror() {
    const self = this;
    await this._serialize(async () => {
      const ctx = await self._fetchTreeContext();
      const gamePath = DATA_ROOT + self.room + "/game.txt";
      const entry = ctx.entries.get(gamePath);
      let content = "";
      if (entry) content = await self._readBlob(entry.sha);
      self.game = self._decodeGame(content);
    });
  }

  // =================================================================
  // Placement.
  // =================================================================

  _beginPlacement() {
    if (this.placing) return;
    if (!this.game || !this.game.started) return;
    this.placing   = true;
    this.placeIdx  = 0;
    this.placeRot  = false;
    this.myFleet   = null;
    this._placePreview = null;
    this.hoverCell = { x: 0, y: 0 };
    this.lockedShot = null;
    this._renderAll();
  }

  _rotatePlace() {
    if (!this.placing) return;
    this.placeRot = !this.placeRot;

    // If a preview exists, re-render it in the new orientation at
    // the same anchor.
    if (this._placePreview) {
      this._placePreview.horiz = !this.placeRot;
    }
    this._renderAll();
  }

  _resetPlacement() {
    if (!this.placing) return;
    this.placeIdx = 0;
    this.placeRot = false;
    this.myFleet  = null;
    this._placePreview = null;
    this._renderAll();
  }

  // Next: commit the current ship's placement locally (no git) and
  // advance. Valid only when a valid preview exists at the anchor.
  _nextPlace() {
    if (!this.placing) return;
    if (this.placeIdx >= FLEET.length) return;

    const preview = this._placePreview;
    if (!preview) return;

    const ship  = FLEET[this.placeIdx];
    const cells = this._cellsFor(ship.len, preview.x, preview.y, preview.horiz);
    if (!this._cellsValid(cells, this.myFleet)) return;

    if (!this.myFleet) this.myFleet = [];
    this.myFleet.push({ name: ship.name, len: ship.len, cells });
    this.placeIdx++;
    this._placePreview = null;

    // If that was the last ship, the row changes: Rotate becomes
    // Reset. _renderButtons handles the visibility.
    this._renderAll();
  }

  _cellsFor(len, x, y, horiz) {
    const cells = [];
    for (let i = 0; i < len; i++) {
      cells.push({ x: horiz ? x + i : x, y: horiz ? y : y + i });
    }
    return cells;
  }

  _cellsValid(cells, existing) {
    for (const c of cells) {
      if (c.x < 0 || c.y < 0 || c.x >= BOARD_W || c.y >= BOARD_H) return false;
    }
    if (!existing) return true;
    for (const s of existing) {
      for (const c of s.cells) {
        for (const d of cells) {
          if (c.x === d.x && c.y === d.y) return false;
        }
      }
    }
    return true;
  }

  _placeCurrentAt(cx, cy) {
    if (!this.placing) return;
    if (this.placeIdx >= FLEET.length) return;
    const ship = FLEET[this.placeIdx];
    const cells = this._cellsFor(ship.len, cx, cy, !this.placeRot);
    if (!this._cellsValid(cells, this.myFleet)) return;
    if (!this.myFleet) this.myFleet = [];
    this.myFleet.push({ name: ship.name, len: ship.len, cells });
    this.placeIdx++;
    this._renderAll();
  }

  _allShipsPlaced() {
    if (!this.myFleet) return false;
    return this.myFleet.length === FLEET.length;
  }

  _iHaveLockedIn() {
    if (!this.game || !this.game.players) return false;
    const me = this.game.players["p" + this.slot];
    if (!me || !me.fleet) return false;
    return me.fleet.length === FLEET.length;
  }

  async _lockIn() {
    if (!this._allShipsPlaced()) return;
    if (this._placingWrite) return;
    this._placingWrite = true;
    this._setStatus("Locking in...");
    this._busyStart(this.lockBtn);

    const mySlot = this.slot;
    const myFleet = this.myFleet;
    const myName  = this.username;
    const self    = this;

    try {
      await this._serialize(async () => {
        const ctx = await self._fetchTreeContext();
        const gamePath = DATA_ROOT + self.room + "/game.txt";
        const entry = ctx.entries.get(gamePath);
        let content = "";
        if (entry) content = await self._readBlob(entry.sha);

        const hint = {
          commitSha: ctx.commitSha,
          treeSha:   ctx.treeSha,
          entries:   ctx.entries,
          content:   content,
        };

        await self._writeWithRetry(
          gamePath,
          (currentContent) => {
            const g = self._decodeGame(currentContent);
            const key = "p" + mySlot;
            if (!g.players) g.players = {};
            if (!g.players[key]) g.players[key] = { name: "", fleet: [], shots: [] };
            g.players[key].name  = myName;
            g.players[key].fleet = myFleet;
            g.players[key].shots = g.players[key].shots || [];
            return self._encodeGame(g);
          },
          "lock in " + myName,
          hint
        );
      });

      await this._refreshGameMirror();

      this.placing = false;
      this._placePreview = null;
      this._setStatus("");
      this._renderAll();
    } catch (e) {
      this._handleApiError(e, "lock in");
    } finally {
      this._placingWrite = false;
      this._busyEnd(this.lockBtn);
    }
  }

  // =================================================================
  // Fire.
  // =================================================================

  _shotAt(list, x, y) {
    for (const s of list) {
      if (s.x === x && s.y === y) return true;
    }
    return false;
  }

  _hitShip(fleet, x, y) {
    for (const s of fleet) {
      for (const c of s.cells) {
        if (c.x === x && c.y === y) return true;
      }
    }
    return false;
  }

  _allShipsSunk(fleet, shots) {
    let total = 0;
    for (const s of fleet) total += s.len;
    let hits = 0;
    for (const sh of shots) if (sh.hit) hits++;
    return hits >= total;
  }

  // Desktop lock/unlock rule: two-click behavior with the yellow cell.
  // Mobile: no lock concept; tap/drag just moves the cursor and Fire
  // commits. _canFireNow gates both.
  _lockShotAt(cx, cy) {
    if (!this._canFireNow()) return;

    const meKey = "p" + this.slot;
    const me    = this.game.players[meKey];
    if (!me) return;

    if (this._shotAt(me.shots || [], cx, cy)) return;

    if (this.lockedShot) {
      this.lockedShot = null;
    } else {
      this.lockedShot = { x: cx, y: cy };
    }
    this._renderAll();
  }

  _canFireNow() {
    return this.game
      && this.game.started
      && this.game.winner == null
      && this.game.turn === this.slot
      && !this.placing
      && !this._awaitingFire
      && this._bothFleetsIn();
  }

  _bothFleetsIn() {
    if (!this.game || !this.game.players) return false;
    for (let p = 0; p < SLOTS; p++) {
      const pl = this.game.players["p" + p];
      if (!pl || !pl.fleet || pl.fleet.length !== FLEET.length) return false;
    }
    return true;
  }

  // Nudge the fire cursor by direction. Used by the mobile D-pad.
  _nudgeFireCursor(dir) {
    if (!this._canFireNow()) return;
    const c = this.fireCursor;
    if (dir === "up")    c.y = Math.max(0, c.y - 1);
    if (dir === "down")  c.y = Math.min(BOARD_H - 1, c.y + 1);
    if (dir === "left")  c.x = Math.max(0, c.x - 1);
    if (dir === "right") c.x = Math.min(BOARD_W - 1, c.x + 1);
    this._renderAll();
  }

  async _fireLockedShot() {
    if (!this._canFireNow()) return;
    if (this._firing) return;

    // Target cell: desktop uses the locked shot; mobile uses the
    // cursor position directly.
    let cx, cy;
    if (this.mobile) {
      cx = this.fireCursor.x;
      cy = this.fireCursor.y;
    } else {
      if (!this.lockedShot) return;
      cx = this.lockedShot.x;
      cy = this.lockedShot.y;
    }

    this._firing = true;
    this._awaitingFire = true;
    this._setStatus("Firing...");
    this.lastFeedback = "Firing...";
    this._renderAll();
    this._busyStart(this.fireBtn);

    const mySlot = this.slot;
    const myName = this.username;
    const self   = this;

    try {
      await this._serialize(async () => {
        const ctx = await self._fetchTreeContext();
        const gamePath = DATA_ROOT + self.room + "/game.txt";
        const entry = ctx.entries.get(gamePath);
        let content = "";
        if (entry) content = await self._readBlob(entry.sha);

        const hint = {
          commitSha: ctx.commitSha,
          treeSha:   ctx.treeSha,
          entries:   ctx.entries,
          content:   content,
        };

        await self._writeWithRetry(
          gamePath,
          (currentContent) => {
            const g = self._decodeGame(currentContent);
            if (g.turn !== mySlot || g.winner != null) return null;

            const meKey  = "p" + mySlot;
            const oppKey = "p" + (1 - mySlot);
            const opp = g.players[oppKey];
            const my  = g.players[meKey];
            if (!my || !opp || !opp.fleet || opp.fleet.length === 0) {
              return null;
            }

            if (!my.shots) my.shots = [];
            if (self._shotAt(my.shots, cx, cy)) return null;

            const hit = self._hitShip(opp.fleet, cx, cy);
            my.shots.push({ x: cx, y: cy, hit });

            if (self._allShipsSunk(opp.fleet, my.shots)) {
              g.winner = mySlot;
              g.turn   = null;
              g.turnCount = (g.turnCount || 0) + 1;
              self.lastFeedback = "HIT - you win!";
            } else if (hit) {
              self.lastFeedback = "HIT - fire again";
            } else {
              self.lastFeedback = "MISS - opponent's turn";
              g.turn = 1 - mySlot;
              g.turnCount = (g.turnCount || 0) + 1;
            }

            return self._encodeGame(g);
          },
          "fire " + myName,
          hint
        );
      });

      await this._refreshGameMirror();
      this.lockedShot = null;
      this._clearStatus();
      this._renderAll();
    } catch (e) {
      this.lastFeedback = "";
      this._handleApiError(e, "fire");
    } finally {
      this._firing = false;
      this._awaitingFire = false;
      this._busyEnd(this.fireBtn);
    }
  }

  // =================================================================
  // Chat.
  // =================================================================

  _toggleChat() {
    this.chatOpen = !this.chatOpen;

    if (this.chatPanel) {
      this.chatPanel.visible = this.chatOpen;
    }
    if (this.chatKeyboard) {
      this.chatKeyboard.visible = this.chatOpen;
    }

    // Chat button label toggles.
    if (this.chatBtn) {
      this.chatBtn.setText(this.chatOpen ? "Hide" : "Chat");
    }

    if (this.chatOpen) {
      this.unread = 0;
      this._seenChatCount = this.chatLines.length;
      this._renderChatLog();
      this._renderUnreadBadge();
    }
  }

  // Render stored chat lines as: [HH:MM:SS]username:text
  // Storage format is unchanged: username|ISO-timestamp|text
  _renderChatLog() {
    if (!this.chatMessageTexts) return;
    const max = this.chatMessageTexts.length;

    const rawLines = this.chatLines.slice(-max);
    for (let i = 0; i < max; i++) {
      const t = this.chatMessageTexts[i];
      const raw = rawLines[i];
      if (!raw) {
        t.text = "";
        continue;
      }
      const parsed = this._parseChatLine(raw);
      if (!parsed) {
        t.text = truncate(raw, this.mobile ? 40 : 52);
        continue;
      }
      const line = "[" + formatTime(parsed.iso) + "]" + parsed.username + ":" + parsed.text;
      t.text = truncate(line, this.mobile ? 40 : 52);
    }
  }

  _parseChatLine(line) {
    const first = line.indexOf("|");
    if (first < 0) return null;
    const second = line.indexOf("|", first + 1);
    if (second < 0) return null;
    const username = line.slice(0, first);
    const iso      = line.slice(first + 1, second);
    const text     = line.slice(second + 1);
    if (!username || !iso) return null;
    return { username, iso, text };
  }

  _renderUnreadBadge() {
    if (!this.unreadBadge) return;
    this.unreadBadge.text = this.unread > 0 ? "!" : "";
  }

  async _sendChat() {
    if (this.room === null || this.slot === null) return;
    if (this._sending) return;

    const text = this.inputText.trim();
    if (!text) return;

    const now = Date.now();
    if (now - this._lastSend < CHAT_COOLDOWN) {
      const remain = Math.ceil((CHAT_COOLDOWN - (now - this._lastSend)) / 1000);
      this._setStatus("Please wait " + remain + "s before sending again.");
      setTimeout(() => this._clearStatus(), 2000);
      return;
    }

    this._sending  = true;
    this._lastSend = now;
    this._busyStart(this.sendBtn);

    const safe = text.replace(/\|/g, "/").replace(/\n/g, " ").replace(/\r/g, " ");
    const iso  = nowIso();
    const line = this.username + "|" + iso + "|" + safe + "\n";
    const path = DATA_ROOT + this.room + "/chat.txt";

    try {
      await this._serialize(() =>
        this._writeWithRetry(
          path,
          (currentContent) => currentContent + line,
          "chat from " + this.username
        )
      );

      this.chatLines.push(this.username + "|" + iso + "|" + safe);
      this._seenChatCount = this.chatLines.length;
      this._renderChatLog();

      this.inputText = "";
      this._refreshChatInput();
      this._clearStatus();
    } catch (e) {
      if (e.message === "BAD_SESSION") {
        this._handleApiError(e, "chat");
        return;
      }
      this._setStatus("Chat send failed.");
      setTimeout(() => this._clearStatus(), 3000);
    } finally {
      this._sending = false;
      this._busyEnd(this.sendBtn);
    }
  }

  // =================================================================
  // Rendering.
  // =================================================================

  _renderAll() {
    if (this.stack[this.stack.length - 1] !== "game") return;

    this._renderHeader();
    this._renderMyBoard();
    this._renderOpBoard();
    this._renderButtons();
    this._renderOutcomeBanner();
    this._renderUnreadBadge();
  }

  _renderHeader() {
    if (!this.game) {
      this.turnLabel.text = "Loading...";
      this.feedbackLabel.text = "";
      return;
    }

    if (this.game.winner != null) {
      this.turnLabel.text = (this.game.winner === this.slot) ? "YOU WIN" : "YOU LOSE";
      this.feedbackLabel.text = "";
      return;
    }

    if (!this.game.started) {
      const presentCount = this.presenceEntries.filter(e => e && isPresent(e.iso)).length;
      this.turnLabel.text = "Waiting for opponent (" + presentCount + "/2)";
      this.feedbackLabel.text = "";
      return;
    }

    const iLocked    = this._iHaveLockedIn();
    const bothLocked = this._bothFleetsIn();

    if (!iLocked) {
      this.turnLabel.text = "LOCK IN";
      this.feedbackLabel.text = "";
      return;
    }

    if (!bothLocked) {
      this.turnLabel.text = "WAITING FOR OPPONENT";
      this.feedbackLabel.text = "";
      return;
    }

    if (this.game.turn === this.slot) {
      this.turnLabel.text = "YOUR TURN";
    } else {
      this.turnLabel.text = "OPPONENT'S TURN";
    }
    this.feedbackLabel.text = this.lastFeedback || "";
  }

  _renderMyBoard() {
    if (!this.myLayer) return;
    this.myLayer.children.length = 0;

    const cell = this._cell;

    let fleet = this.myFleet;
    if (!fleet && this.game && this.game.players && this.game.players["p" + this.slot]) {
      fleet = this.game.players["p" + this.slot].fleet;
    }

    if (fleet) {
      for (const ship of fleet) {
        for (const c of ship.cells) {
          this.myLayer.add(new Rect({
            x: c.x * cell + 1,
            y: c.y * cell + 1,
            w: cell - 2,
            h: cell - 2,
            fill: "#3a5878",
            stroke: null,
          }));
        }
      }
    }

    if (this.game && this.game.players) {
      const oppKey = "p" + (1 - this.slot);
      const opp = this.game.players[oppKey];
      if (opp && opp.shots) {
        for (const s of opp.shots) {
          this.myLayer.add(new Rect({
            x: s.x * cell + 1,
            y: s.y * cell + 1,
            w: cell - 2,
            h: cell - 2,
            fill: s.hit ? "#c04040" : "#404850",
            stroke: null,
          }));
        }
      }
    }

    // Placement preview (desktop hover cell OR mobile drag preview).
    if (this.placing && this.placeIdx < FLEET.length) {
      let anchor, horiz;
      if (this.mobile) {
        if (!this._placePreview) return;
        anchor = { x: this._placePreview.x, y: this._placePreview.y };
        horiz  = this._placePreview.horiz;
      } else {
        anchor = { x: this.hoverCell.x, y: this.hoverCell.y };
        horiz  = !this.placeRot;
      }

      const ship  = FLEET[this.placeIdx];
      const cells = this._cellsFor(ship.len, anchor.x, anchor.y, horiz);
      const valid = this._cellsValid(cells, this.myFleet);
      for (const c of cells) {
        if (c.x < 0 || c.y < 0 || c.x >= BOARD_W || c.y >= BOARD_H) continue;
        this.myLayer.add(new Rect({
          x: c.x * cell + 1,
          y: c.y * cell + 1,
          w: cell - 2,
          h: cell - 2,
          fill: valid ? "#50a070" : "#a05050",
          stroke: null,
        }));
      }
    }
  }

  _renderOpBoard() {
    if (!this.opLayer) return;
    this.opLayer.children.length = 0;

    const cell = this._cell;

    if (this.game && this.game.players) {
      const me = this.game.players["p" + this.slot];
      if (me && me.shots) {
        for (const s of me.shots) {
          this.opLayer.add(new Rect({
            x: s.x * cell + 1,
            y: s.y * cell + 1,
            w: cell - 2,
            h: cell - 2,
            fill: s.hit ? "#c04040" : "#404850",
            stroke: null,
          }));
        }
      }
    }

    if (!this._canFireNow()) return;

    // Mobile: only the cursor. The cursor IS the choice; Fire
    // commits at its cell.
    if (this.mobile) {
      const c = this.fireCursor;
      this.opLayer.add(new Rect({
        x: c.x * cell + 2,
        y: c.y * cell + 2,
        w: cell - 4,
        h: cell - 4,
        fill: "#ffffff",
        stroke: "#ffd060",
        strokeWidth: 2,
      }));
      return;
    }

    // Desktop: locked-shot yellow cell takes precedence; otherwise
    // draw the cursor outline.
    if (this.lockedShot) {
      this.opLayer.add(new Rect({
        x: this.lockedShot.x * cell + 2,
        y: this.lockedShot.y * cell + 2,
        w: cell - 4,
        h: cell - 4,
        fill: "#ffd060",
        stroke: null,
      }));
      return;
    }

    const c = this.fireCursor;
    this.opLayer.add(new Rect({
      x: c.x * cell + 2,
      y: c.y * cell + 2,
      w: cell - 4,
      h: cell - 4,
      fill: null,
      stroke: "#ffd060",
      strokeWidth: 2,
    }));
  }

  _renderButtons() {
    const presentCount = this.presenceEntries.filter(e => e && isPresent(e.iso)).length;
    const bothHere = presentCount >= 2;

    const g = this.game;

    const gameStarted = g && g.started;
    const votePhase    = g && !g.started && bothHere;
    const placeEntry   = gameStarted && !this.placing && !this._iHaveLockedIn();
    const placeCtl     = this.placing;
    const firePhase    = this._canFireNow();

    // Vote buttons.
    this.voteMeBtn.visible    = !!votePhase;
    this.voteDeferBtn.visible = !!votePhase;
    this.readyBtn.visible     = !!votePhase;

    if (votePhase) {
      if (this.myReady) {
        this.voteMeBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
        this.voteDeferBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
      } else {
        if (this.myVote === "me") {
          this.voteMeBtn.setBaseStyle({ fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE });
        } else {
          this.voteMeBtn.setBaseStyle({ fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE });
        }
        if (this.myVote === "defer") {
          this.voteDeferBtn.setBaseStyle({ fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE });
        } else {
          this.voteDeferBtn.setBaseStyle({ fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE });
        }
      }

      this.readyBtn.setText(this.myReady ? "Unready" : "Ready");

      if (this.myReady) {
        this.readyBtn.setBaseStyle({ fill: BTN_RED_FILL, stroke: BTN_RED_STROKE });
      } else if (this.myVote) {
        this.readyBtn.setBaseStyle({ fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE });
      } else {
        this.readyBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
      }
    }

    // Place Ships entry.
    this.placeBtn.visible = !!placeEntry;

    // Placement controls.
    const allPlaced = this._allShipsPlaced();

    // Desktop placement row: Lock In / Rotate / Reset.
    // Mobile placement row: Lock In / Rotate / Next, and when all
    // ships are placed: Lock In / Reset (Rotate becomes Reset).
    if (this.mobile) {
      if (placeCtl) {
        this.lockBtn.visible = true;
        if (allPlaced) {
          // All ships placed. Lock In is green; Rotate is now Reset.
          this.lockBtn.setText("Lock In");
          this.lockBtn.setBaseStyle({ fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE });

          this.rotateBtn.visible = false;
          this.nextBtn.visible   = false;
          this.resetBtn.visible  = true;
        } else {
          // Mid-placement. Lock In is greyed (nothing to lock in
          // until all ships placed). Rotate and Next are visible.
          // Next is greyed until a valid preview exists.
          this.lockBtn.setText("Lock In");
          this.lockBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });

          this.rotateBtn.visible = true;
          this.rotateBtn.setText("Rotate");
          this.rotateBtn.setBaseStyle({ fill: BTN_DARK_FILL, stroke: BTN_DARK_STROKE });

          const previewValid = this._previewIsValid();

          this.nextBtn.visible = true;
          this.nextBtn.setText("Next");
          if (previewValid) {
            this.nextBtn.setBaseStyle({ fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE });
          } else {
            this.nextBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
          }

          this.resetBtn.visible = false;
        }
      } else {
        // Not placing. Lock In may still be shown if this player has
        // locked in and is waiting for the opponent.
        const waiting = gameStarted && this._iHaveLockedIn() && !this._bothFleetsIn();
        if (waiting) {
          this.lockBtn.visible = true;
          this.lockBtn.setText("Locked In!");
          this.lockBtn.setBaseStyle({ fill: BTN_RED_FILL, stroke: BTN_RED_STROKE });
        } else {
          this.lockBtn.visible = false;
        }
        this.rotateBtn.visible = false;
        this.nextBtn.visible   = false;
        this.resetBtn.visible  = false;
      }
    } else {
      // Desktop.
      this.rotateBtn.visible = !!placeCtl;
      this.resetBtn.visible  = !!placeCtl;

      const showLock = !!placeCtl
        || (gameStarted && this._iHaveLockedIn() && !this._bothFleetsIn());
      this.lockBtn.visible = showLock;

      if (showLock) {
        const locked = this._iHaveLockedIn();
        if (locked) {
          this.lockBtn.setText("Locked In!");
          this.lockBtn.setBaseStyle({ fill: BTN_RED_FILL, stroke: BTN_RED_STROKE });
        } else {
          this.lockBtn.setText("Lock In");
          if (allPlaced) {
            this.lockBtn.setBaseStyle({ fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE });
          } else {
            this.lockBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
          }
        }
      }

      if (this.rotateBtn.visible) {
        this.rotateBtn.setText("Rotate (R)");
        this.rotateBtn.setBaseStyle({ fill: BTN_DARK_FILL, stroke: BTN_DARK_STROKE });
      }
      if (this.resetBtn.visible) {
        this.resetBtn.setBaseStyle({ fill: BTN_DARK_FILL, stroke: BTN_DARK_STROKE });
      }
    }

    // Fire button.
    this.fireBtn.visible = !!firePhase && (this.mobile || !!this.lockedShot);

    // Show Controls / D-pad. Mobile, fire phase only.
    if (this.mobile) {
      if (this.controlsToggle) {
        if (firePhase) {
          this.controlsToggle.visible = true;
          this.controlsToggle.setText(this.controlsVisible ? "Hide Controls" : "Show Controls");
        } else {
          this.controlsToggle.visible = false;
        }
      }
      for (const b of this.dpadButtons) {
        b.visible = !!firePhase && this.controlsVisible;
      }
    }
  }

  // Is the current placement preview a valid ship position?
  _previewIsValid() {
    if (!this.placing) return false;
    if (this.placeIdx >= FLEET.length) return false;
    if (!this._placePreview) return false;

    const ship  = FLEET[this.placeIdx];
    const cells = this._cellsFor(ship.len, this._placePreview.x, this._placePreview.y, this._placePreview.horiz);
    return this._cellsValid(cells, this.myFleet);
  }

  _renderOutcomeBanner() {
    if (!this.outcomeLabel) return;

    const g = this.game;
    if (!g || !g.started) {
      this.outcomeLabel.visible = false;
      return;
    }
    if (this._bothFleetsIn()) {
      this.outcomeLabel.visible = false;
      return;
    }

    const myVote = (this.slot === 0 ? g.voteP0 : g.voteP1) || this.myVote || "";
    const iGoFirst = (g.turn === this.slot);
    const firstPlayerNum = (g.turn === 0) ? "Player 1" : "Player 2";

    let msg = "";

    if (g.firstMode === "coin") {
      if (myVote === "me") {
        msg = "Both chose Me; coinflip -> " + firstPlayerNum + " first!";
      } else {
        msg = "Both chose Defer; coinflip -> " + firstPlayerNum + " first!";
      }
    } else {
      if (iGoFirst) {
        msg = "You go first!";
      } else {
        msg = firstPlayerNum + " goes first!";
      }
    }

    this.outcomeLabel.text = msg;
    this.outcomeLabel.visible = true;
  }

  // =================================================================
  // Input.
  // =================================================================

  onEvent(e) {
    const top = this.stack[this.stack.length - 1];

    if (top === "username") {
      if (e.type === "keydown") this._handleUsernameKey(e);
      return;
    }

    if (top === "room") return;

    if (top === "game") {
      if (this.chatOpen) {
        if (e.type === "keydown") this._handleChatKey(e);
        return;
      }

      if (e.type === "keydown") this._handleGameKey(e);
      else if (e.type === "mousemove") this._handleGameMouseMove(e);
      else if (e.type === "mousedown") this._handleGameMouseDown(e);
      else if (e.type === "mouseup")   this._handleGameMouseUp(e);
      else if (e.type === "mouseleave") this._handleGameMouseLeave(e);
    }
  }

  _handleUsernameKey(e) {
    if (e.key === "Backspace") {
      this._usernameBuffer = this._usernameBuffer.slice(0, -1);
      this._refreshUsernameField();
      return;
    }
    if (e.key === "Enter") {
      this._submitUsername();
      return;
    }
    if (e.key.length === 1) {
      this._usernameBuffer += e.key;
      this._refreshUsernameField();
    }
  }

  _handleChatKey(e) {
    if (e.key === "Backspace") {
      this.inputText = this.inputText.slice(0, -1);
      this._refreshChatInput();
      return;
    }
    if (e.key === "Enter") {
      this._sendChat();
      return;
    }
    if (e.key.length === 1) {
      this.inputText += e.key;
      this._refreshChatInput();
    }
  }

  _handleGameKey(e) {
    const k = e.key;

    if (this.placing) {
      if (k === "r" || k === "R") { this._rotatePlace(); return; }
      if (k === "ArrowLeft" || k === "a" || k === "A") {
        if (this.mobile && this._placePreview) this._placePreview.x = Math.max(0, this._placePreview.x - 1);
        else this.hoverCell.x = Math.max(0, this.hoverCell.x - 1);
        this._renderAll();
        return;
      }
      if (k === "ArrowRight" || k === "d" || k === "D") {
        if (this.mobile && this._placePreview) this._placePreview.x = Math.min(BOARD_W - 1, this._placePreview.x + 1);
        else this.hoverCell.x = Math.min(BOARD_W - 1, this.hoverCell.x + 1);
        this._renderAll();
        return;
      }
      if (k === "ArrowUp" || k === "w" || k === "W") {
        if (this.mobile && this._placePreview) this._placePreview.y = Math.max(0, this._placePreview.y - 1);
        else this.hoverCell.y = Math.max(0, this.hoverCell.y - 1);
        this._renderAll();
        return;
      }
      if (k === "ArrowDown" || k === "s" || k === "S") {
        if (this.mobile && this._placePreview) this._placePreview.y = Math.min(BOARD_H - 1, this._placePreview.y + 1);
        else this.hoverCell.y = Math.min(BOARD_H - 1, this.hoverCell.y + 1);
        this._renderAll();
        return;
      }
      if (k === "Enter") {
        if (this.mobile) this._nextPlace();
        else this._placeCurrentAt(this.hoverCell.x, this.hoverCell.y);
        return;
      }
      return;
    }

    if (this._canFireNow()) {
      if (k === "ArrowLeft" || k === "a" || k === "A") { this.fireCursor.x = Math.max(0, this.fireCursor.x - 1); this._renderAll(); return; }
      if (k === "ArrowRight" || k === "d" || k === "D") { this.fireCursor.x = Math.min(BOARD_W - 1, this.fireCursor.x + 1); this._renderAll(); return; }
      if (k === "ArrowUp" || k === "w" || k === "W") { this.fireCursor.y = Math.max(0, this.fireCursor.y - 1); this._renderAll(); return; }
      if (k === "ArrowDown" || k === "s" || k === "S") { this.fireCursor.y = Math.min(BOARD_H - 1, this.fireCursor.y + 1); this._renderAll(); return; }
      if (k === "Enter") {
        if (this.mobile) this._fireLockedShot();
        else this._lockShotAt(this.fireCursor.x, this.fireCursor.y);
        return;
      }
    }
  }

  _handleGameMouseMove(e) {
    // Mobile placement: if dragging, update the preview.
    if (this.mobile && this.placing && this._dragPlace) {
      const c = this._cellFromPoint(e.x, e.y, this._myBx, this._myBy);
      if (c) {
        this._placePreview = { x: c.x, y: c.y, horiz: !this.placeRot };
        this._renderAll();
      }
      return;
    }

    // Mobile firing: if dragging, move the cursor.
    if (this.mobile && this._dragFire) {
      if (this._canFireNow()) {
        const c = this._cellFromPoint(e.x, e.y, this._opBx, this._opBy);
        if (c) {
          this.fireCursor = c;
          this._renderAll();
        }
      }
      return;
    }

    // Desktop placement: hover preview.
    if (!this.mobile && this.placing) {
      const c = this._cellFromPoint(e.x, e.y, this._myBx, this._myBy);
      if (c) {
        this.hoverCell = c;
        this._renderAll();
      }
      return;
    }

    // Desktop firing: hover cursor.
    if (!this.mobile && this._canFireNow()) {
      const c = this._cellFromPoint(e.x, e.y, this._opBx, this._opBy);
      if (c) {
        this.fireCursor = c;
        this._renderAll();
      }
    }
  }

  _handleGameMouseDown(e) {
    // Mobile placement.
    if (this.mobile && this.placing) {
      const c = this._cellFromPoint(e.x, e.y, this._myBx, this._myBy);
      if (c) {
        this._dragPlace = true;
        this._placePreview = { x: c.x, y: c.y, horiz: !this.placeRot };
        this._renderAll();
      }
      return;
    }

    // Desktop placement.
    if (!this.mobile && this.placing) {
      const c = this._cellFromPoint(e.x, e.y, this._myBx, this._myBy);
      if (c) {
        this._placeCurrentAt(c.x, c.y);
        return;
      }
    }

    // Mobile firing: tap-and-drag moves the cursor; release leaves it.
    if (this.mobile && this._canFireNow()) {
      const c = this._cellFromPoint(e.x, e.y, this._opBx, this._opBy);
      if (c) {
        this._dragFire = true;
        this.fireCursor = c;
        this._renderAll();
      }
      return;
    }

    // Desktop firing: click to lock/unlock (two-click rule).
    if (!this.mobile && this._canFireNow()) {
      const c = this._cellFromPoint(e.x, e.y, this._opBx, this._opBy);
      if (c) {
        this._lockShotAt(c.x, c.y);
        return;
      }
    }
  }

  _handleGameMouseUp(e) {
    // Mobile placement release: the preview stays where it was
    // released. The player presses Next to commit, or drags again to
    // move it.
    if (this.mobile && this.placing && this._dragPlace) {
      this._dragPlace = false;

      const c = this._cellFromPoint(e.x, e.y, this._myBx, this._myBy);
      if (c) {
        this._placePreview = { x: c.x, y: c.y, horiz: !this.placeRot };
      }
      this._renderAll();
      return;
    }

    // Mobile firing release: cursor stays where the finger lifted.
    if (this.mobile && this._dragFire) {
      this._dragFire = false;

      if (this._canFireNow()) {
        const c = this._cellFromPoint(e.x, e.y, this._opBx, this._opBy);
        if (c) this.fireCursor = c;
      }
      this._renderAll();
      return;
    }
  }

  _handleGameMouseLeave(e) {
    if (this.mobile) {
      if (this._dragPlace) this._dragPlace = false;
      if (this._dragFire)  this._dragFire  = false;
    }
    void e;
  }

  _cellFromPoint(px, py, bx, by) {
    const cell = this._cell;
    const lx = px - bx;
    const ly = py - by;
    if (lx < 0 || ly < 0) return null;
    const cx = Math.floor(lx / cell);
    const cy = Math.floor(ly / cell);
    if (cx < 0 || cy < 0 || cx >= BOARD_W || cy >= BOARD_H) return null;
    return { x: cx, y: cy };
  }

  _toggleControls() {
    this.controlsVisible = !this.controlsVisible;
    this._renderAll();
  }

  // ---------- Error handling ----------

  _handleApiError(e, where) {
    if (e && e.message === "BAD_SESSION") {
      this._stopCycle();
      this._leaveRoomInternal();
      this._setStatus("Session unavailable.");
      return;
    }
    this._setStatus("Error during " + where + ": " + (e && e.message ? e.message : "unknown"));
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ---------- App lifecycle ----------

  update(dt) {
    const top = this.stack[this.stack.length - 1];
    if (top !== "username" && top !== "game") return;

    this._cursorTimer += dt * 1000;
    if (this._cursorTimer >= CURSOR_MS) {
      this._cursorTimer -= CURSOR_MS;
      this._cursorOn = !this._cursorOn;

      if (top === "username") this._refreshUsernameField();
      if (top === "game" && this.chatOpen) this._refreshChatInput();
    }

    if (top === "game") {
      this._refreshCountdown();
    }
  }
}