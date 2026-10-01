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

// Busy-button colors. The helper swaps the self shape's fill to BUSY
// while a git request is in flight, and restores the original fill on
// completion. The original is captured the first time a button goes
// busy and kept until the button is done.

const BUSY_FILL = "#444a52";

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

    // Fire state.
    this.fireCursor = { x: 0, y: 0 };
    this.lockedShot = null;         // { x, y } or null
    this.lastFeedback = "";
    this._awaitingFire = false;

    // First-turn vote state (local mirror of the shared values).
    this.myVote   = null;           // "me" | "defer" | null
    this.myReady  = false;

    // Chat UI.
    this.chatOpen = false;
    this.unread   = 0;
    this._seenChatCount = 0;

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

  // Grey out a Button's self shape for the duration of a git request,
  // then restore its original fill. The original fill is captured the
  // first time the button is made busy and kept until _busyEnd. Local
  // to this app on purpose; not a Button composite change.

  _busyStart(btn) {
    if (!btn || !btn.self) return;
    if (btn._busyBaseFill === undefined) {
      btn._busyBaseFill = btn.self.fill;
    }
    btn.self.fill = BUSY_FILL;
  }

  _busyEnd(btn) {
    if (!btn || !btn.self) return;
    if (btn._busyBaseFill !== undefined) {
      btn.self.fill = btn._busyBaseFill;
    }
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

  _buildGameScreen() {
    const W = Viewport.width;
    const H = Viewport.height;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#101820",
      stroke: null,
    });

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

    // Boards.
    const cell   = 36;
    const boardPx = cell * BOARD_W;
    const gap    = 80;
    const totalW = boardPx * 2 + gap;
    const bx     = (W - totalW) / 2;
    const by     = 150;

    this._cell     = cell;
    this._myBx     = bx;
    this._myBy     = by;
    this._opBx     = bx + boardPx + gap;
    this._opBy     = by;
    this._boardPx  = boardPx;

    screen.add(new Text({
      x: this._myBx, y: by - 28,
      text: "YOUR WATERS",
      font: "bold 14px monospace",
      color: "#80a0c0",
      align: "left",
      baseline: "middle",
    }));
    screen.add(new Text({
      x: this._opBx, y: by - 28,
      text: "ENEMY WATERS",
      font: "bold 14px monospace",
      color: "#c08080",
      align: "left",
      baseline: "middle",
    }));

    screen.add(new Panel({
      x: this._myBx - 2, y: this._myBy - 2,
      w: boardPx + 4, h: boardPx + 4,
      fill: "#0a0e12",
      stroke: "#2a3238",
      strokeWidth: 2,
    }));
    screen.add(new Panel({
      x: this._opBx - 2, y: this._opBy - 2,
      w: boardPx + 4, h: boardPx + 4,
      fill: "#0a0e12",
      stroke: "#2a3238",
      strokeWidth: 2,
    }));

    // Grids.
    for (let i = 0; i <= BOARD_W; i++) {
      screen.add(new Line({
        x1: this._myBx + i * cell, y1: this._myBy,
        x2: this._myBx + i * cell, y2: this._myBy + boardPx,
        stroke: "#1e262c", strokeWidth: 1,
      }));
      screen.add(new Line({
        x1: this._myBx, y1: this._myBy + i * cell,
        x2: this._myBx + boardPx, y2: this._myBy + i * cell,
        stroke: "#1e262c", strokeWidth: 1,
      }));
      screen.add(new Line({
        x1: this._opBx + i * cell, y1: this._opBy,
        x2: this._opBx + i * cell, y2: this._opBy + boardPx,
        stroke: "#1e262c", strokeWidth: 1,
      }));
      screen.add(new Line({
        x1: this._opBx, y1: this._opBy + i * cell,
        x2: this._opBx + boardPx, y2: this._opBy + i * cell,
        stroke: "#1e262c", strokeWidth: 1,
      }));
    }

    // Dynamic layers.
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

    // Controls legend.
    screen.add(new Text({
      x: W / 2, y: H - 40,
      text: "Mouse: hover and click. Keys: WASD/Arrows move, R rotate, Enter place or lock a shot.",
      font: "13px monospace",
      color: "#607080",
      align: "center",
      baseline: "middle",
    }));

    // Action row of buttons. Visibility is toggled by state.
    const actionY = H - 96;

    // Vote buttons: Me / Defer.
    this.voteMeBtn = new Button({
      x: W / 2 - 310, y: actionY, w: 200, h: 52,
      text: "Me",
      fill: "#2a3552",
      stroke: "#6a86b8",
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
      fill: "#2a3552",
      stroke: "#6a86b8",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._setVote("defer"),
    });
    this.voteDeferBtn.visible = false;
    screen.add(this.voteDeferBtn);

    // Ready / Unready.
    this.readyBtn = new Button({
      x: W / 2 + 110, y: actionY, w: 200, h: 52,
      text: "Ready",
      fill: "#2a6a3a",
      stroke: "#6aaa7a",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._toggleReady(),
    });
    this.readyBtn.visible = false;
    screen.add(this.readyBtn);

    // Lock In / Rotate / Reset during placement.
    this.lockBtn = new Button({
      x: W / 2 - 340, y: actionY, w: 200, h: 52,
      text: "Lock In",
      fill: "#2a6a3a",
      stroke: "#6aaa7a",
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
      fill: "#2a2a3a",
      stroke: "#5a5a7a",
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
      fill: "#2a2a3a",
      stroke: "#5a5a7a",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._resetPlacement(),
    });
    this.resetBtn.visible = false;
    screen.add(this.resetBtn);

    // Place Ships entry.
    this.placeBtn = new Button({
      x: W / 2 - 160, y: actionY, w: 320, h: 52,
      text: "Place Ships",
      fill: "#2a3552",
      stroke: "#6a86b8",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._beginPlacement(),
    });
    this.placeBtn.visible = false;
    screen.add(this.placeBtn);

    // Fire button (centered under the boards, appears when a shot is
    // locked).
    this.fireBtn = new Button({
      x: W / 2 - 110, y: actionY, w: 220, h: 52,
      text: "Fire!",
      fill: "#8a2020",
      stroke: "#e06060",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 22px sans-serif", color: "#ffffff" },
      onClick: () => this._fireLockedShot(),
    });
    this.fireBtn.visible = false;
    screen.add(this.fireBtn);

    // Vote outcome banner. Shown once both players are ready, until
    // the game reaches the fire phase.
    this.outcomeLabel = new Text({
      x: W / 2,
      y: H - 96,
      text: "",
      font: "bold 18px sans-serif",
      color: "#a0c0ff",
      align: "center",
      baseline: "middle",
    });
    this.outcomeLabel.visible = false;
    screen.add(this.outcomeLabel);

    // Chat button + unread badge.
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

    // Chat panel (hidden by default).
    this._buildChatPanel(screen);

    return screen;
  }

  _buildChatPanel(screen) {
    const W = Viewport.width;
    const H = Viewport.height;

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
      fill: "#2a2a3a",
      stroke: "#5a5a7a",
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
      fill: "#2a4a2a",
      stroke: "#6a9a6a",
      strokeWidth: 1,
      radius: 4,
      textOptions: { font: "bold 14px sans-serif", color: "#ffffff" },
      onClick: () => this._sendChat(),
    });
    panel.add(this.sendBtn);

    this._chatPanelX = px;
    this._chatPanelY = py;
    this._chatPanelW = pw;
    this._chatPanelH = ph;
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
      this.fireCursor = { x: 0, y: 0 };
      this.lockedShot = null;
      this.lastFeedback = "";
      this.myVote  = null;
      this.myReady = false;
      this.chatOpen = false;
      if (this.chatPanel) this.chatPanel.visible = false;
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

  async _runCycleLoop() {
    if (this.room === null) return;

    this._nextCycleAt = 0;
    this._refreshCountdown();

    let retried = false;
    try {
      retried = await this._cycle();
    } catch (e) {
      if (e && e.message === "BAD_SESSION") {
        this._handleApiError(e, "cycle");
        return;
      }
    }

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
      // started and both votes and both ready flags are in. Only the
      // first writer to reach here flips started; the other sees
      // started=1 on their next cycle and no-ops.
      const needsResolve = this.game
        && !this.game.started
        && this.game.voteP0 && this.game.voteP1
        && this.game.readyP0 && this.game.readyP1;

      if (needsResolve) {
        const resolvedTurn = this._resolveFirstTurn(this.game.voteP0, this.game.voteP1);
        const mode = this._resolveFirstMode(this.game.voteP0, this.game.voteP1);

        const g = {
          started:   true,
          turn:      resolvedTurn,
          turnCount: (this.game.turnCount || 0) + 1,
          winner:    null,
          firstMode: mode,
          voteP0:    "",
          voteP1:    "",
          readyP0:   false,
          readyP1:   false,
          players:   this.game.players || {},
        };

        // Keep the existing per-player blocks (name, fleet, shots).
        for (let p = 0; p < SLOTS; p++) {
          const key = "p" + p;
          if (this.game.players && this.game.players[key]) {
            g.players[key] = this.game.players[key];
          } else {
            g.players[key] = { name: "", fleet: [], shots: [] };
          }
        }

        const hint = {
          commitSha: ctx.commitSha,
          treeSha:   ctx.treeSha,
          entries:   ctx.entries,
          content:   gameContent,
        };

        try {
          const result = await this._writeWithRetry(
            gamePath,
            () => this._encodeGame(g),
            "resolve first turn",
            hint
          );
          if (result.retried) retried = true;
          if (result.ok) this.game = g;
        } catch (e) {
          if (e && e.message === "BAD_SESSION") throw e;
          // Best-effort; next cycle tries again.
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
      const self   = this;

      const hint = {
        commitSha: ctx.commitSha,
        treeSha:   ctx.treeSha,
        entries:   ctx.entries,
        content:   presContent,
      };

      try {
        const result = await self._writeWithRetry(
          presPath,
          (currentContent) => {
            const newLine = "slot" + mySlot + "|" + myName + "|" + myIso;
            return self._splicePresenceLine(currentContent, mySlot, newLine);
          },
          "cycle presence " + mySlot,
          hint
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
  // must change together.
  //
  // Line-oriented. "#" starts a section.
  //
  //   #META
  //   started=0|1
  //   turn=0|1|-1
  //   turnCount=<int>
  //   winner=0|1|-1
  //   firstMode=p1|p2|coin
  //   voteP0=me|defer|
  //   voteP1=me|defer|
  //   readyP0=0|1
  //   readyP1=0|1
  //   #PLAYER 0
  //   name=<username>
  //   fleet=<cells>;<cells>;...
  //   shots=<x,y,hit>|<x,y,hit>|...
  //   #PLAYER 1
  //   ...
  //
  // A cell is "x,y". Ships are ";" separated, cells inside a ship are
  // ":" separated. Shots are "|" separated.
  //
  // turnCount increments only on writes that flip the turn: the start
  // commit and any miss. A hit does not flip the turn, so turnCount
  // does not advance. Clients use it to detect that the turn has moved
  // since they last read, independent of the turn value itself.
  //
  // voteP0 / voteP1 / readyP0 / readyP1 are the first-turn handshake.
  // They are cleared in the same write that sets started=1.
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
    if (this.myReady) return;   // vote locked once ready

    this._votingWrite = true;
    this._setStatus("Recording vote...");

    const mySlot = this.slot;
    const self   = this;

    try {
      await this._serialize(async () => {
        const ctx = await this._fetchTreeContext();
        const gamePath = DATA_ROOT + this.room + "/game.txt";
        const entry = ctx.entries.get(gamePath);
        let content = "";
        if (entry) content = await this._readBlob(entry.sha);
        const g = this._decodeGame(content);

        if (g.started) { this.game = g; return; }

        const voteKey  = "voteP" + mySlot;
        const readyKey = "readyP" + mySlot;

        if (g[readyKey]) { this.game = g; return; }

        g[voteKey] = vote;

        const hint = {
          commitSha: ctx.commitSha,
          treeSha:   ctx.treeSha,
          entries:   ctx.entries,
          content:   content,
        };

        await self._writeWithRetry(
          gamePath,
          () => self._encodeGame(g),
          "vote " + mySlot,
          hint
        );

        this.game  = g;
        this.myVote = vote;
      });

      this._clearStatus();
      this._renderAll();
    } catch (e) {
      this._handleApiError(e, "vote");
    } finally {
      this._votingWrite = false;
    }
  }

  async _toggleReady() {
    if (this._votingWrite) return;
    if (!this.game) return;
    if (this.game.started) return;

    // Ready requires a vote. Button is disabled (greyed) until a vote
    // is in, so this guard is belt-and-braces.
    if (!this.myReady && !this.myVote) return;

    this._votingWrite = true;
    this._setStatus(this.myReady ? "Unreadying..." : "Readying...");
    this._busyStart(this.readyBtn);

    const mySlot = this.slot;
    const self   = this;

    try {
      await this._serialize(async () => {
        const ctx = await this._fetchTreeContext();
        const gamePath = DATA_ROOT + this.room + "/game.txt";
        const entry = ctx.entries.get(gamePath);
        let content = "";
        if (entry) content = await this._readBlob(entry.sha);
        const g = this._decodeGame(content);

        if (g.started) { this.game = g; return; }

        const voteKey  = "voteP" + mySlot;
        const readyKey = "readyP" + mySlot;

        const nextReady = !g[readyKey];

        if (nextReady && !g[voteKey]) {
          // Should not happen given the button is disabled, but do
          // not write an inconsistent state.
          this.game = g;
          return;
        }

        g[readyKey] = nextReady;

        const hint = {
          commitSha: ctx.commitSha,
          treeSha:   ctx.treeSha,
          entries:   ctx.entries,
          content:   content,
        };

        await self._writeWithRetry(
          gamePath,
          () => self._encodeGame(g),
          (nextReady ? "ready " : "unready ") + mySlot,
          hint
        );

        this.game   = g;
        this.myReady = nextReady;
      });

      this._clearStatus();
      this._renderAll();
    } catch (e) {
      this._handleApiError(e, "ready");
    } finally {
      this._votingWrite = false;
      this._busyEnd(this.readyBtn);
    }
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
    this.hoverCell = { x: 0, y: 0 };
    this.lockedShot = null;
    this._renderAll();
  }

  _rotatePlace() {
    if (!this.placing) return;
    this.placeRot = !this.placeRot;
    this._renderAll();
  }

  _resetPlacement() {
    if (!this.placing) return;
    this.placeIdx = 0;
    this.placeRot = false;
    this.myFleet  = null;
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
    const cells = this._cellsFor(ship.len, cx, cy, this.placeRot);
    if (!this._cellsValid(cells, this.myFleet)) return;
    if (!this.myFleet) this.myFleet = [];
    this.myFleet.push({ name: ship.name, len: ship.len, cells });
    this.placeIdx++;
    this._renderAll();
  }

  async _lockIn() {
    if (!this.myFleet || this.myFleet.length !== FLEET.length) return;
    if (this._placingWrite) return;
    this._placingWrite = true;
    this._setStatus("Locking in...");
    this._busyStart(this.lockBtn);

    try {
      await this._serialize(async () => {
        const ctx = await this._fetchTreeContext();
        const gamePath = DATA_ROOT + this.room + "/game.txt";
        const entry = ctx.entries.get(gamePath);
        let content = "";
        if (entry) content = await this._readBlob(entry.sha);
        const g = this._decodeGame(content);

        if (!g.players) g.players = {};
        const key = "p" + this.slot;
        if (!g.players[key]) g.players[key] = { name: "", fleet: [], shots: [] };
        g.players[key].name   = this.username;
        g.players[key].fleet  = this.myFleet;
        g.players[key].shots  = g.players[key].shots || [];

        const hint = {
          commitSha: ctx.commitSha,
          treeSha:   ctx.treeSha,
          entries:   ctx.entries,
          content:   content,
        };

        await this._writeWithRetry(
          gamePath,
          () => this._encodeGame(g),
          "lock in " + this.username,
          hint
        );

        this.game = g;
      });

      this.placing = false;
      this._setStatus("Locked in. Waiting for opponent.");
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

  // Lock or unlock the shot at the given cell. Same cell twice
  // unlocks; a different cell re-locks on the new one. Only valid on
  // your turn, only in the fire phase, only at cells not already
  // fired at.
  _lockShotAt(cx, cy) {
    if (!this._canFireNow()) return;

    const meKey = "p" + this.slot;
    const me    = this.game.players[meKey];
    if (!me) return;

    if (this._shotAt(me.shots || [], cx, cy)) return;

    if (this.lockedShot && this.lockedShot.x === cx && this.lockedShot.y === cy) {
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

  async _fireLockedShot() {
    if (!this.lockedShot) return;
    if (!this._canFireNow()) return;
    if (this._firing) return;

    const cx = this.lockedShot.x;
    const cy = this.lockedShot.y;

    this._firing = true;
    this._awaitingFire = true;
    this._setStatus("Firing...");
    this._busyStart(this.fireBtn);

    const meKey  = "p" + this.slot;
    const oppKey = "p" + (1 - this.slot);

    try {
      await this._serialize(async () => {
        const ctx = await this._fetchTreeContext();
        const gamePath = DATA_ROOT + this.room + "/game.txt";
        const entry = ctx.entries.get(gamePath);
        let content = "";
        if (entry) content = await this._readBlob(entry.sha);
        const g = this._decodeGame(content);

        if (g.turn !== this.slot || g.winner != null) {
          this.game = g;
          this.lockedShot = null;
          return;
        }

        const opp = g.players[oppKey];
        const my  = g.players[meKey];
        if (!my || !opp || !opp.fleet || opp.fleet.length === 0) {
          this._setStatus("Opponent not ready.");
          return;
        }

        if (!my.shots) my.shots = [];
        if (this._shotAt(my.shots, cx, cy)) {
          this.game = g;
          this.lockedShot = null;
          return;
        }

        const hit = this._hitShip(opp.fleet, cx, cy);
        my.shots.push({ x: cx, y: cy, hit });

        if (this._allShipsSunk(opp.fleet, my.shots)) {
          g.winner = this.slot;
          g.turn   = null;
          g.turnCount = (g.turnCount || 0) + 1;
          this.lastFeedback = "HIT - you win!";
        } else if (hit) {
          this.lastFeedback = "HIT - fire again";
        } else {
          this.lastFeedback = "MISS - opponent's turn";
          g.turn = 1 - this.slot;
          g.turnCount = (g.turnCount || 0) + 1;
        }

        const hint = {
          commitSha: ctx.commitSha,
          treeSha:   ctx.treeSha,
          entries:   ctx.entries,
          content:   content,
        };

        await this._writeWithRetry(
          gamePath,
          () => this._encodeGame(g),
          "fire " + this.username,
          hint
        );

        this.game = g;
        this.lockedShot = null;
      });

      this._clearStatus();
      this._renderAll();
    } catch (e) {
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
    if (this.chatOpen) {
      this.unread = 0;
      this._seenChatCount = this.chatLines.length;
      this._renderChatLog();
      this._renderUnreadBadge();
    }
  }

  _renderChatLog() {
    if (!this.chatMessageTexts) return;
    const max = this.chatMessageTexts.length;
    const lines = this.chatLines.slice(-max);
    for (let i = 0; i < max; i++) {
      const t = this.chatMessageTexts[i];
      const line = lines[i];
      t.text = line ? truncate(line, 52) : "";
    }
  }

  _renderUnreadBadge() {
    if (!this.unreadBadge) return;
    if (this.unread > 0) {
      this.unreadBadge.text = "!";
    } else {
      this.unreadBadge.text = "";
    }
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

    // Started. Before both fleets are in, the "turn" label just tells
    // the players what phase they are in.
    if (!this._bothFleetsIn()) {
      const me = this.game.players["p" + this.slot];
      if (this._playerNeedsFleet()) {
        this.turnLabel.text = "Place your fleet";
      } else {
        this.turnLabel.text = "Waiting for opponent to place";
      }
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

    if (this.placing && this.placeIdx < FLEET.length) {
      const ship = FLEET[this.placeIdx];
      const cells = this._cellsFor(ship.len, this.hoverCell.x, this.hoverCell.y, this.placeRot);
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

    // Locked-shot marker (solid), drawn under the cursor.
    if (this.lockedShot) {
      this.opLayer.add(new Rect({
        x: this.lockedShot.x * cell + 2,
        y: this.lockedShot.y * cell + 2,
        w: cell - 4,
        h: cell - 4,
        fill: "#ffd060",
        stroke: null,
      }));
    }

    // Fire cursor outline at the current hover/cursor cell.
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
    const placeEntry   = gameStarted && !this.placing && this._playerNeedsFleet();
    const placeCtl     = this.placing;
    const firePhase    = this._canFireNow();

    this.voteMeBtn.visible    = !!votePhase;
    this.voteDeferBtn.visible = !!votePhase;
    this.readyBtn.visible     = !!votePhase;

    if (votePhase) {
      // Vote buttons: highlight the current choice; both are still
      // clickable until ready.
      if (this.myVote === "me") {
        this.voteMeBtn.self.fill    = "#2a6a3a";
        this.voteMeBtn.self.stroke  = "#6aaa7a";
      } else {
        this.voteMeBtn.self.fill    = "#2a3552";
        this.voteMeBtn.self.stroke  = "#6a86b8";
      }
      if (this.myVote === "defer") {
        this.voteDeferBtn.self.fill    = "#2a6a3a";
        this.voteDeferBtn.self.stroke  = "#6aaa7a";
      } else {
        this.voteDeferBtn.self.fill    = "#2a3552";
        this.voteDeferBtn.self.stroke  = "#6a86b8";
      }

      // Ready is disabled (greyed, non-clickable in effect) until a
      // vote has been made. Once ready, the button reads Unready and
      // is red.
      this.readyBtn.setText(this.myReady ? "Unready" : "Ready");

      if (this.myReady) {
        this.readyBtn.self.fill   = "#8a2020";
        this.readyBtn.self.stroke = "#e06060";
      } else if (this.myVote) {
        this.readyBtn.self.fill   = "#2a6a3a";
        this.readyBtn.self.stroke = "#6aaa7a";
      } else {
        this.readyBtn.self.fill   = "#3a3a3a";
        this.readyBtn.self.stroke = "#5a5a5a";
      }
    }

    this.placeBtn.visible = !!placeEntry;
    this.lockBtn.visible  = !!placeCtl;
    this.rotateBtn.visible = !!placeCtl;
    this.resetBtn.visible  = !!placeCtl;

    // Fire button: shown only when a shot is locked and it is your
    // turn in the fire phase.
    this.fireBtn.visible = !!(firePhase && this.lockedShot);
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

    // Show the two votes and the resolved outcome until both fleets
    // are in (i.e., until the fire phase is ready to begin).
    const yourVote = this.myVote || (this.slot === 0 ? g.voteP0 : g.voteP1) || "?";
    const theirVote = (this.slot === 0 ? g.voteP1 : g.voteP0) || "?";

    const yourLabel  = yourVote === "me" ? "Me" : (yourVote === "defer" ? "Defer" : "?");
    const theirLabel = theirVote === "me" ? "Me" : (theirVote === "defer" ? "Defer" : "?");

    let outcomeText;
    if (g.firstMode === "coin") {
      outcomeText = "Coinflip";
    } else if (g.firstMode === "p1") {
      outcomeText = "Player 1 first";
    } else if (g.firstMode === "p2") {
      outcomeText = "Player 2 first";
    } else {
      outcomeText = "";
    }

    const whoGoesFirst = (g.turn === this.slot) ? "You go first" : "Opponent goes first";

    this.outcomeLabel.text =
      "You: " + yourLabel + "   Opponent: " + theirLabel +
      "   ->   " + outcomeText + "  (" + whoGoesFirst + ")";
    this.outcomeLabel.visible = true;
  }

  _playerNeedsFleet() {
    if (!this.game) return false;
    const me = this.game.players["p" + this.slot];
    if (!me) return true;
    if (!me.fleet || me.fleet.length !== FLEET.length) return true;
    return false;
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
      if (e.type === "keydown") this._handleGameKey(e);
      else if (e.type === "mousemove") this._handleGameMouseMove(e);
      else if (e.type === "mousedown") this._handleGameMouseDown(e);
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

  _handleGameKey(e) {
    const k = e.key;

    if (this.chatOpen) {
      if (k === "Escape") { this._toggleChat(); return; }
      if (k === "Backspace") {
        this.inputText = this.inputText.slice(0, -1);
        this._refreshChatInput();
        return;
      }
      if (k === "Enter") { this._sendChat(); return; }
      if (k.length === 1) {
        this.inputText += k;
        this._refreshChatInput();
        return;
      }
      return;
    }

    if (this.placing) {
      if (k === "r" || k === "R") { this._rotatePlace(); return; }
      if (k === "ArrowLeft" || k === "a" || k === "A") { this.hoverCell.x = Math.max(0, this.hoverCell.x - 1); this._renderAll(); return; }
      if (k === "ArrowRight" || k === "d" || k === "D") { this.hoverCell.x = Math.min(BOARD_W - 1, this.hoverCell.x + 1); this._renderAll(); return; }
      if (k === "ArrowUp" || k === "w" || k === "W") { this.hoverCell.y = Math.max(0, this.hoverCell.y - 1); this._renderAll(); return; }
      if (k === "ArrowDown" || k === "s" || k === "S") { this.hoverCell.y = Math.min(BOARD_H - 1, this.hoverCell.y + 1); this._renderAll(); return; }
      if (k === "Enter") { this._placeCurrentAt(this.hoverCell.x, this.hoverCell.y); return; }
      return;
    }

    if (this._canFireNow()) {
      if (k === "ArrowLeft" || k === "a" || k === "A") { this.fireCursor.x = Math.max(0, this.fireCursor.x - 1); this._renderAll(); return; }
      if (k === "ArrowRight" || k === "d" || k === "D") { this.fireCursor.x = Math.min(BOARD_W - 1, this.fireCursor.x + 1); this._renderAll(); return; }
      if (k === "ArrowUp" || k === "w" || k === "W") { this.fireCursor.y = Math.max(0, this.fireCursor.y - 1); this._renderAll(); return; }
      if (k === "ArrowDown" || k === "s" || k === "S") { this.fireCursor.y = Math.min(BOARD_H - 1, this.fireCursor.y + 1); this._renderAll(); return; }
      if (k === "Enter") { this._lockShotAt(this.fireCursor.x, this.fireCursor.y); return; }
    }
  }

  _handleGameMouseMove(e) {
    if (this.placing) {
      const c = this._cellFromPoint(e.x, e.y, this._myBx, this._myBy);
      if (c) {
        this.hoverCell = c;
        this._renderAll();
      }
      return;
    }

    if (this._canFireNow()) {
      const c = this._cellFromPoint(e.x, e.y, this._opBx, this._opBy);
      if (c) {
        this.fireCursor = c;
        this._renderAll();
      }
    }
  }

  _handleGameMouseDown(e) {
    if (this.placing) {
      const c = this._cellFromPoint(e.x, e.y, this._myBx, this._myBy);
      if (c) {
        this._placeCurrentAt(c.x, c.y);
        return;
      }
    }

    if (this._canFireNow()) {
      const c = this._cellFromPoint(e.x, e.y, this._opBx, this._opBy);
      if (c) {
        this._lockShotAt(c.x, c.y);
        return;
      }
    }
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