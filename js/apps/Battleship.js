// Battleship.
//
// one line tweak to test deployment remove me plz
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
// Vote-phase button states, for one client:
//   no vote, not ready : Me blue, Defer blue, Ready grey
//   voted, not ready   : chosen green, other blue, Ready green
//   ready              : chosen green, other blue, Ready red "Unready"
//                        (Me and Defer grey while Unready shows)
// Any vote or ready write greys all three buttons while it is in
// flight, so a choice being committed reads the same regardless of
// which button was pressed.
//
// End-of-game panel: when someone wins, a modal panel shows "You
// win!" or "You lose." with Rematch and Exit buttons. Rematch is a
// two-player handshake stored in #META as rematchP0 / rematchP1.
// Pressing Rematch sets your flag (button turns red, label becomes
// Cancel, Exit greys). Pressing Cancel clears it. When both flags
// are set, the next cycle writer resets the game to the pre-vote
// state in one commit: started back to 0, votes and ready flags
// cleared, fleets and shots cleared, rematch flags cleared,
// turnCount reset to 0. Names are preserved. Exit calls the same
// path as Leave.
//
// All writes to game.txt that come from a single player's action
// (vote, ready, lock in, fire, rematch) are shaped as:
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
// Slot claiming is the same shape. The slot a joiner takes is
// decided INSIDE the presence-claim build callback, against the
// freshest presence content _writeWithRetry has, not against a
// pre-read taken before the write. Two clients racing to join an
// empty room both read 0/2, both run the dead-room reset, then both
// claim. Whichever commits first takes slot 0. The loser's hint
// misses (or its PATCH conflicts), _writeWithRetry re-reads, and
// the callback sees slot 0 now occupied and takes slot 1. No
// explicit race flag, no lock, no claimed-slot register: the shared
// presence file resolves the race. If the room fills under the
// callback, it returns null and the join surfaces "Room is full".
//
// Sunk ships: a ship is sunk when every one of its cells has been
// hit. A sunk ship's cells are drawn in a darker shade of the shot
// color (dark red on your board, dark green on the enemy board),
// and the per-hit overlay for that ship is skipped. The feedback
// line says "Sunk! - fire again" instead of "HIT - fire again",
// and "Sunk! - you win!" when the sinking shot wins the game.
//
// Boards: each board is drawn as an ocean-blue interior with a
// black border, and a lighter blue grid on top. Ships are neutral
// grey (metal on water). Hits are red on your board and green on
// the enemy board. Misses are pale blue, reading as a splash.
// Sunk ships use a dark shade of the same hit color.
//
// Mobile controls: two Show Controls surfaces. The fire-phase
// surface overlays Your Waters and reveals a D-pad that moves the
// fire cursor. The placement-phase surface overlays Enemy Waters
// and reveals a D-pad that moves the current ship preview on Your
// Waters. They have separate visibility flags and are never
// visible at the same time (placement and firing are mutually
// exclusive game phases).
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
import { Composite } from "../composites/Composite.js";
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

// ---- Color palette ----
//
// Mid grey chrome. The board interiors are ocean blue with black
// borders. Ships are neutral grey (metal). Hits are red (yours) or
// green (enemy). Misses are pale blue, reading as a splash.

// Screen chrome.
const BG_SCREEN   = "#2b3038";   // all three screen fills
const BG_INSET    = "#3a4048";   // username field, chat input panel
const BG_PANEL    = "#242830";   // end-game panel box
const BG_CHAT     = "#242a33";   // chat panel / overlay background

const STROKE_INSET = "#5a6570";  // username field, chat input strokes
const STROKE_PANEL = "#6a7a8a";  // panel / box strokes

// Ocean (board interiors).
const OCEAN_FILL   = "#1a4a7a";  // board interior (the water)
const OCEAN_GRID   = "#3a7ab0";  // board grid lines
const OCEAN_BORDER = "#000000";  // board border

// Board cell colors. Ships are neutral grey. Hits are red (your
// board) or green (enemy board). Misses are a pale-blue splash.
// A sunk ship uses a darker shade of the same hit color.
const COLOR_SHIP          = "#b0b0b0";  // grey metal ships
const COLOR_MY_HIT        = "#e03030";  // your ship, hit
const COLOR_MY_SUNK       = "#5a0a0a";  // your ship, sunk
const COLOR_OP_HIT        = "#30d060";  // enemy ship, hit
const COLOR_OP_SUNK       = "#083a10";  // enemy ship, sunk
const COLOR_MISS          = "#b0d8f0";  // splash
const COLOR_PLACE_OK      = "#30c060";
const COLOR_PLACE_BAD     = "#d04040";
const COLOR_FIRE_CURSOR   = "#ffcc33";

// Text.
const TEXT_PRIMARY   = "#eef2f8";
const TEXT_SECONDARY = "#b8c8e0";
const TEXT_DIM       = "#8a9ab0";
const TEXT_TURN      = "#70aaff";
const TEXT_FEEDBACK  = "#ffcc33";
const TEXT_HINT      = "#8090a0";
const TEXT_LABEL_MY  = "#6ac8ff";
const TEXT_LABEL_OP  = "#ff8080";
const TEXT_CHAT      = "#e0e8f0";
const TEXT_ERROR     = "#ff6060";
const TEXT_BADGE     = "#ff4040";

// Busy-button colors. Used while a git request is in flight.
const BUSY_FILL   = "#5a5a5a";
const BUSY_STROKE = "#a8a8a8";

// Named resting colors for buttons whose base color changes with
// state (vote, ready/unready, lock in, fire, rematch). Applied via
// setBaseStyle so hover and press merge over the CURRENT resting
// color instead of a stale snapshot from construction time.

const BTN_BLUE_FILL    = "#2a4a80";
const BTN_BLUE_STROKE  = "#4a9aff";
const BTN_GREEN_FILL   = "#1f8a3f";
const BTN_GREEN_STROKE = "#4fd97a";
const BTN_RED_FILL     = "#c02020";
const BTN_RED_STROKE   = "#ff5050";
const BTN_DARK_FILL    = "#333a45";
const BTN_DARK_STROKE  = "#8a8aa8";

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

    // Rematch state (local mirror of the shared values).
    this.myRematch = false;

    // Chat UI.
    this.chatOpen = false;
    this.unread   = 0;
    this._seenChatCount = 0;

    // Mobile controls visibility. Two independent surfaces: one for
    // the fire-phase D-pad (over Your Waters), one for the
    // placement-phase D-pad (over Enemy Waters).
    this.controlsVisible          = false;
    this.placementControlsVisible = false;

    // Board layout flip. Convenience only. False is the default
    // layout (Your left/top, Enemy right/bottom). True swaps them.
    this.flipped = false;

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
    this._rematchWrite = false;
    this._firing       = false;

    this._cursorOn    = true;
    this._cursorTimer = 0;

    this._usernameBuffer = "";
    this.inputText       = "";

    this._joining = false;

    // Slot chosen by the presence-claim write callback during join.
    // Set as a side effect and read back after the write lands, so
    // this.slot reflects what the file actually granted, not what a
    // pre-write read guessed.
    this._claimedSlot = -1;

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
      fill: BG_SCREEN,
      stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: BTN_DARK_FILL,
      stroke: BTN_DARK_STROKE,
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
      color: TEXT_PRIMARY,
      align: "center",
      baseline: "middle",
    }));

    const fieldW = this.mobile ? W - 80 : 720;
    const fieldH = this.mobile ? 72 : 56;
    const fieldX = cx - fieldW / 2;
    const fieldY = this.mobile ? titleY + 60 : 260;

    const field = new Panel({
      x: fieldX, y: fieldY, w: fieldW, h: fieldH,
      fill: BG_INSET,
      stroke: STROKE_INSET,
      strokeWidth: 2,
      radius: 6,
    });
    screen.add(field);

    this.usernameFieldLabel = new Label({
      x: 0, y: 0, w: "100%", h: "100%",
      text: "",
      textOptions: {
        font: this.mobile ? "22px monospace" : "18px monospace",
        color: TEXT_PRIMARY,
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
      color: TEXT_ERROR,
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
        fill: BTN_BLUE_FILL,
        stroke: BTN_BLUE_STROKE,
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
        fill: BTN_BLUE_FILL,
        stroke: BTN_BLUE_STROKE,
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
      fill: BG_SCREEN,
      stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: BTN_DARK_FILL,
      stroke: BTN_DARK_STROKE,
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
      color: TEXT_PRIMARY,
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
        fill: BTN_BLUE_FILL,
        stroke: BTN_BLUE_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: {
          font: this.mobile ? "bold 28px sans-serif" : "bold 22px sans-serif",
          color: "#ffffff",
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
      color: TEXT_SECONDARY,
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
      fill: BG_SCREEN,
      stroke: null,
    });

    // Header strip.
    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Leave",
      fill: BTN_RED_FILL,
      stroke: BTN_RED_STROKE,
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._leaveRoom(),
    }));

    this.updateBtn = new Button({
      x: W - 164, y: 24, w: 140, h: 48,
      text: "Update",
      fill: BTN_BLUE_FILL,
      stroke: BTN_BLUE_STROKE,
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
      color: TEXT_DIM,
      align: "center",
      baseline: "middle",
    });
    screen.add(this.cycleCountdownLabel);

    this.roomTitleLabel = new Text({
      x: W / 2,
      y: 48,
      text: "",
      font: "bold 20px sans-serif",
      color: TEXT_PRIMARY,
      align: "center",
      baseline: "middle",
    });
    screen.add(this.roomTitleLabel);

    this.turnLabel = new Text({
      x: W / 2,
      y: 78,
      text: "",
      font: "bold 18px sans-serif",
      color: TEXT_TURN,
      align: "center",
      baseline: "middle",
    });
    screen.add(this.turnLabel);

    this.feedbackLabel = new Text({
      x: W / 2,
      y: 104,
      text: "",
      font: "bold 16px sans-serif",
      color: TEXT_FEEDBACK,
      align: "center",
      baseline: "middle",
    });
    screen.add(this.feedbackLabel);

    this.statusLabel = new Text({
      x: 180,
      y: 36,
      text: "",
      font: "14px monospace",
      color: TEXT_SECONDARY,
      align: "left",
      baseline: "middle",
    });
    screen.add(this.statusLabel);

    // Boards.
    if (this.mobile) {
      this._buildBoardsMobile(screen);
    } else {
      this._buildBoardsDesktop(screen);
    }

    // Chat button + unread badge (bottom-right on both).
    this.chatBtn = new Button({
      x: W - 164, y: H - 60, w: 140, h: 44,
      text: "Chat",
      fill: BTN_BLUE_FILL,
      stroke: BTN_BLUE_STROKE,
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
      color: TEXT_BADGE,
      align: "center",
      baseline: "middle",
    });
    screen.add(this.unreadBadge);

    // End-of-game modal (hidden by default). Built before the chat
    // overlay so chat can still open on top of it if the player
    // wants to talk after the game ends.
    this._buildEndPanel(screen);

    // Chat overlay (hidden by default).
    this._buildChatPanel(screen);

    return screen;
  }

  // Build the two frame composites, the two content layers, the
  // Flip button, and (mobile) the D-pads. The frames are positioned
  // by _layoutBoards so flip is a reposition of existing nodes.
  _buildBoardsDesktop(screen) {
    const W = Viewport.width;

    const cell    = 36;
    const boardPx = cell * BOARD_W;
    const gap     = 80;

    this._cell     = cell;
    this._boardPx  = boardPx;
    this._layoutGap = gap;

    // Frame composites. Contents are added by _drawBoardFrame.
    this.myFrame = new Composite({ x: 0, y: 0, w: boardPx, h: boardPx });
    this.opFrame = new Composite({ x: 0, y: 0, w: boardPx, h: boardPx });
    screen.add(this.myFrame);
    screen.add(this.opFrame);

    this._drawBoardFrame(this.myFrame, boardPx, cell, "YOUR WATERS",  TEXT_LABEL_MY);
    this._drawBoardFrame(this.opFrame, boardPx, cell, "ENEMY WATERS", TEXT_LABEL_OP);

    // Content layers.
    this.myLayer = new Panel({
      x: 0, y: 0, w: boardPx, h: boardPx,
      fill: null, stroke: null,
    });
    this.opLayer = new Panel({
      x: 0, y: 0, w: boardPx, h: boardPx,
      fill: null, stroke: null,
    });
    screen.add(this.myLayer);
    screen.add(this.opLayer);

    // Flip button. Small. Sits in the existing gap, vertically
    // centered on the boards. No board repositioning. Uses the same
    // blue palette as Update and Chat.
    this.flipBtn = new Button({
      x: 0, y: 0, w: 64, h: 36,
      text: "Flip",
      fill: BTN_BLUE_FILL,
      stroke: BTN_BLUE_STROKE,
      strokeWidth: 1,
      radius: 6,
      textOptions: { font: "bold 14px sans-serif", color: "#ffffff" },
      onClick: () => this._applyFlip(),
    });
    screen.add(this.flipBtn);

    screen.add(new Text({
      x: W / 2, y: Viewport.height - 40,
      text: "Mouse: hover and click. Keys: WASD/Arrows move, R rotate, Enter place or lock a shot.",
      font: "13px monospace",
      color: TEXT_HINT,
      align: "center",
      baseline: "middle",
    }));

    // Desktop action row is raised 20px from its old position so it
    // does not crowd the controls-hint text near the bottom.
    this._buildActionRow(screen, Viewport.height - 116);

    // Place the boards and Flip button for the initial flip state.
    this._layoutBoards();
  }

  _buildBoardsMobile(screen) {
    const W = Viewport.width;

    const cell    = 46;
    const boardPx = cell * BOARD_W;
    const gap     = 60;

    this._cell      = cell;
    this._boardPx   = boardPx;
    this._layoutGap = gap;

    this.myFrame = new Composite({ x: 0, y: 0, w: boardPx, h: boardPx });
    this.opFrame = new Composite({ x: 0, y: 0, w: boardPx, h: boardPx });
    screen.add(this.myFrame);
    screen.add(this.opFrame);

    this._drawBoardFrame(this.myFrame, boardPx, cell, "YOUR WATERS",  TEXT_LABEL_MY);
    this._drawBoardFrame(this.opFrame, boardPx, cell, "ENEMY WATERS", TEXT_LABEL_OP);

    this.myLayer = new Panel({
      x: 0, y: 0, w: boardPx, h: boardPx,
      fill: null, stroke: null,
    });
    this.opLayer = new Panel({
      x: 0, y: 0, w: boardPx, h: boardPx,
      fill: null, stroke: null,
    });
    screen.add(this.myLayer);
    screen.add(this.opLayer);

    // Flip button, centered in the existing gap. Same blue palette
    // as Update and Chat.
    this.flipBtn = new Button({
      x: 0, y: 0, w: 120, h: 40,
      text: "Flip",
      fill: BTN_BLUE_FILL,
      stroke: BTN_BLUE_STROKE,
      strokeWidth: 2,
      radius: 6,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._applyFlip(),
    });
    screen.add(this.flipBtn);

    // Action row below the lower board. Positioned by _layoutBoards.
    this.actionRowY = 0;
    this._buildActionRow(screen, 0);

    // Fire-phase Show Controls toggle: below the action row.
    // Overlays Your Waters. Positioned by _layoutBoards.
    this.controlsToggle = new Button({
      x: W / 2 - 160, y: 0, w: 320, h: 52,
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

    // Placement-phase Show Controls toggle. Overlays Enemy Waters.
    // Positioned by _layoutBoards.
    this.placementControlsToggle = new Button({
      x: W / 2 - 160, y: 0, w: 320, h: 52,
      text: "Show Controls",
      fill: BTN_DARK_FILL,
      stroke: BTN_DARK_STROKE,
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
      onClick: () => this._togglePlacementControls(),
    });
    this.placementControlsToggle.visible = false;
    screen.add(this.placementControlsToggle);

    // Fire-phase D-pad. Buttons start hidden. Positioned by
    // _layoutDpad so they follow Your Waters when the boards flip.
    this.dpadButtons = [];

    const fireDefs = [
      { text: "^", dir: "up"    },
      { text: "v", dir: "down"  },
      { text: "<", dir: "left"  },
      { text: ">", dir: "right" },
    ];

    for (const d of fireDefs) {
      const b = new Button({
        x: 0, y: 0, w: 84, h: 84,
        text: d.text,
        fill: BTN_DARK_FILL,
        stroke: BTN_DARK_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 32px sans-serif", color: "#ffffff" },
        onClick: () => this._nudgeFireCursor(d.dir),
      });
      b.visible = false;
      b._dir = d.dir;
      screen.add(b);
      this.dpadButtons.push(b);
    }

    // Placement-phase D-pad. Overlays Enemy Waters. Buttons start
    // hidden. Positioned by _layoutPlacementDpad.
    this.placementDpadButtons = [];

    for (const d of fireDefs) {
      const b = new Button({
        x: 0, y: 0, w: 84, h: 84,
        text: d.text,
        fill: BTN_DARK_FILL,
        stroke: BTN_DARK_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 32px sans-serif", color: "#ffffff" },
        onClick: () => this._nudgePlaceCursor(d.dir),
      });
      b.visible = false;
      b._dir = d.dir;
      screen.add(b);
      this.placementDpadButtons.push(b);
    }

    this._layoutBoards();
  }

  // Position the frame composites, content layers, Flip button, and
  // (mobile) the action row, controls toggles, and D-pads from the
  // current this.flipped state. Called at build and again on flip.
  // This is the only place board anchors are computed.
  _layoutBoards() {
    const boardPx = this._boardPx;
    const gap     = this._layoutGap;
    const mobile  = this.mobile;

    if (mobile) {
      const W  = Viewport.width;
      const bx = (W - boardPx) / 2;

      const topBy = 150;
      const botBy = topBy + boardPx + gap;

      if (!this.flipped) {
        this._myBy = topBy;
        this._opBy = botBy;
      } else {
        this._opBy = topBy;
        this._myBy = botBy;
      }
      this._myBx = bx;
      this._opBx = bx;

      // Frame composites. Frame label sits above the board, so the
      // frame composite origin is the board's top-left; the label
      // inside it is drawn at negative y in local space.
      this.myFrame.x = this._myBx;
      this.myFrame.y = this._myBy;
      this.opFrame.x = this._opBx;
      this.opFrame.y = this._opBy;

      // Content layers.
      this.myLayer.x = this._myBx;
      this.myLayer.y = this._myBy;
      this.opLayer.x = this._opBx;
      this.opLayer.y = this._opBy;

      // Flip button: centered in the gap between the boards.
      const upperBottom = Math.min(this._myBy, this._opBy) + boardPx;
      const gapCenter   = upperBottom + gap / 2;
      this.flipBtn.x = W / 2 - this.flipBtn.w / 2;
      this.flipBtn.y = gapCenter - this.flipBtn.h / 2;

      // Action row below whichever board is on the bottom.
      const lowerBottom = Math.max(this._myBy, this._opBy) + boardPx;
      const actionY = lowerBottom + 20;
      this.actionRowY = actionY;
      this._positionActionRow(actionY);

      // Fire-phase controls toggle, below the action row.
      this.controlsToggle.x = W / 2 - this.controlsToggle.w / 2;
      this.controlsToggle.y = actionY + 64;

      // Placement-phase controls toggle, centered vertically over
      // Enemy Waters. Sits over the enemy board so the placement
      // D-pad, when revealed, is out of the way of Your Waters.
      this.placementControlsToggle.x = W / 2 - this.placementControlsToggle.w / 2;
      this.placementControlsToggle.y = this._opBy + boardPx - this.placementControlsToggle.h - 12;

      this._layoutDpad();
      this._layoutPlacementDpad();
    } else {
      const W = Viewport.width;

      const cell    = this._cell;
      const totalW  = boardPx * 2 + gap;
      const bx      = (W - totalW) / 2;
      const by      = 150;

      if (!this.flipped) {
        this._myBx = bx;
        this._opBx = bx + boardPx + gap;
      } else {
        this._opBx = bx;
        this._myBx = bx + boardPx + gap;
      }
      this._myBy = by;
      this._opBy = by;

      this.myFrame.x = this._myBx;
      this.myFrame.y = this._myBy;
      this.opFrame.x = this._opBx;
      this.opFrame.y = this._opBy;

      this.myLayer.x = this._myBx;
      this.myLayer.y = this._myBy;
      this.opLayer.x = this._opBx;
      this.opLayer.y = this._opBy;

      // Flip button: centered in the horizontal gap, vertically
      // centered on the boards.
      const leftBoardRight = Math.min(this._myBx, this._opBx) + boardPx;
      const gapCenterX     = leftBoardRight + gap / 2;
      this.flipBtn.x = gapCenterX - this.flipBtn.w / 2;
      this.flipBtn.y = by + boardPx / 2 - this.flipBtn.h / 2;

      void cell;
    }
  }

  // Position the mobile fire-phase D-pad over Your Waters.
  _layoutDpad() {
    if (!this.mobile) return;
    if (!this.dpadButtons || this.dpadButtons.length === 0) return;

    const boardPx = this._boardPx;
    const W       = Viewport.width;

    const dpadCx  = W / 2;
    const btnSize = 84;
    const gap     = 10;
    const centerY = this._myBy + boardPx / 2;

    const positions = {
      up:    { x: dpadCx - btnSize / 2, y: centerY - btnSize - gap / 2 },
      down:  { x: dpadCx - btnSize / 2, y: centerY + gap / 2 },
      left:  { x: dpadCx - btnSize - gap / 2 - btnSize / 2, y: centerY - btnSize / 2 },
      right: { x: dpadCx + gap / 2 + btnSize / 2, y: centerY - btnSize / 2 },
    };

    for (const b of this.dpadButtons) {
      const p = positions[b._dir];
      if (!p) continue;
      b.x = p.x;
      b.y = p.y;
      b.w = btnSize;
      b.h = btnSize;
    }
  }

  // Position the mobile placement-phase D-pad over Enemy Waters.
  _layoutPlacementDpad() {
    if (!this.mobile) return;
    if (!this.placementDpadButtons || this.placementDpadButtons.length === 0) return;

    const boardPx = this._boardPx;
    const W       = Viewport.width;

    const dpadCx  = W / 2;
    const btnSize = 84;
    const gap     = 10;
    const centerY = this._opBy + boardPx / 2;

    const positions = {
      up:    { x: dpadCx - btnSize / 2, y: centerY - btnSize - gap / 2 },
      down:  { x: dpadCx - btnSize / 2, y: centerY + gap / 2 },
      left:  { x: dpadCx - btnSize - gap / 2 - btnSize / 2, y: centerY - btnSize / 2 },
      right: { x: dpadCx + gap / 2 + btnSize / 2, y: centerY - btnSize / 2 },
    };

    for (const b of this.placementDpadButtons) {
      const p = positions[b._dir];
      if (!p) continue;
      b.x = p.x;
      b.y = p.y;
      b.w = btnSize;
      b.h = btnSize;
    }
  }

  // Reposition the mobile action-row buttons to a new y. Called by
  // _layoutBoards when the lower board moves. Buttons keep their
  // construction-time x.
  _positionActionRow(actionY) {
    if (!this.mobile) return;

    const row = [
      this.voteMeBtn,
      this.voteDeferBtn,
      this.readyBtn,
      this.placeBtn,
      this.lockBtn,
      this.rotateBtn,
      this.nextBtn,
      this.resetBtn,
      this.fireBtn,
    ];
    for (const b of row) {
      if (b) b.y = actionY;
    }

    if (this.outcomeLabel) {
      this.outcomeLabel.y = actionY - 30;
    }
    if (this.voteLabel) {
      this.voteLabel.y = actionY - 30;
    }
  }

  // Build one board's frame contents into a composite. The
  // composite origin is the board's top-left. Label is drawn above
  // at negative y in local space. The interior is ocean blue with a
  // black border; grid lines are a lighter blue on top.
  _drawBoardFrame(composite, boardPx, cell, label, labelColor) {
    composite.add(new Text({
      x: 0, y: -28,
      text: label,
      font: "bold 14px monospace",
      color: labelColor,
      align: "left",
      baseline: "middle",
    }));

    // Ocean interior with black border. Drawn as a single filled
    // rect with a black stroke.
    composite.add(new Panel({
      x: 0, y: 0,
      w: boardPx, h: boardPx,
      fill: OCEAN_FILL,
      stroke: OCEAN_BORDER,
      strokeWidth: 3,
      radius: 0,
    }));

    for (let i = 0; i <= BOARD_W; i++) {
      composite.add(new Line({
        x1: i * cell, y1: 0,
        x2: i * cell, y2: boardPx,
        stroke: OCEAN_GRID, strokeWidth: 1,
      }));
      composite.add(new Line({
        x1: 0, y1: i * cell,
        x2: boardPx, y2: i * cell,
        stroke: OCEAN_GRID, strokeWidth: 1,
      }));
    }
  }

  // ---------- End-of-game panel ----------

  _buildEndPanel(screen) {
    const W = Viewport.width;
    const H = Viewport.height;

    const overlay = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      self: new Rect({ fill: "rgba(0, 0, 0, 0.55)", stroke: null }),
    });
    overlay.visible = false;
    screen.add(overlay);
    this.endPanel = overlay;

    const panelW = this.mobile ? 560 : 480;
    const panelH = this.mobile ? 320 : 260;
    const panelX = (W - panelW) / 2;
    const panelY = (H - panelH) / 2;

    const box = new Panel({
      x: panelX, y: panelY,
      w: panelW, h: panelH,
      fill: BG_PANEL,
      stroke: STROKE_PANEL,
      strokeWidth: 3,
      radius: 12,
    });
    overlay.add(box);

    this.endTitleLabel = new Text({
      x: panelW / 2, y: 70,
      text: "",
      font: this.mobile ? "bold 40px sans-serif" : "bold 34px sans-serif",
      color: TEXT_PRIMARY,
      align: "center",
      baseline: "middle",
    });
    box.add(this.endTitleLabel);

    const btnW = this.mobile ? 220 : 180;
    const btnH = this.mobile ? 72 : 56;
    const gap  = 24;
    const totalW = btnW * 2 + gap;
    const btnY = panelH - btnH - 40;

    this.rematchBtn = new Button({
      x: (panelW - totalW) / 2, y: btnY, w: btnW, h: btnH,
      text: "Rematch",
      fill: BTN_GREEN_FILL,
      stroke: BTN_GREEN_STROKE,
      strokeWidth: 2,
      radius: 8,
      textOptions: {
        font: this.mobile ? "bold 24px sans-serif" : "bold 20px sans-serif",
        color: "#ffffff",
      },
      onClick: () => this._toggleRematch(),
    });
    box.add(this.rematchBtn);

    this.endExitBtn = new Button({
      x: (panelW - totalW) / 2 + btnW + gap, y: btnY, w: btnW, h: btnH,
      text: "Exit",
      fill: BTN_DARK_FILL,
      stroke: BTN_DARK_STROKE,
      strokeWidth: 2,
      radius: 8,
      textOptions: {
        font: this.mobile ? "bold 24px sans-serif" : "bold 20px sans-serif",
        color: "#ffffff",
      },
      onClick: () => this._leaveRoom(),
    });
    box.add(this.endExitBtn);
  }

  // Apply the current this.myRematch and this._rematchWrite flags to
  // the end-panel button styles. Called from _renderAll and after
  // every rematch toggle.
  _renderEndPanelButtons() {
    if (!this.rematchBtn || !this.endExitBtn) return;

    const busy = this._rematchWrite;
    const rematched = this.myRematch;

    if (busy) {
      this.rematchBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
      this.endExitBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
    } else if (rematched) {
      this.rematchBtn.setText("Cancel");
      this.rematchBtn.setBaseStyle({ fill: BTN_RED_FILL, stroke: BTN_RED_STROKE });
      this.endExitBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
    } else {
      this.rematchBtn.setText("Rematch");
      this.rematchBtn.setBaseStyle({ fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE });
      this.endExitBtn.setBaseStyle({ fill: BTN_DARK_FILL, stroke: BTN_DARK_STROKE });
    }
  }

  // ---------- Action row ----------

  _buildActionRow(screen, actionY) {
    const W = Viewport.width;
    const mobile = this.mobile;

    // Vote-phase label. Shown only while the handshake is active.
    // Positioned above the action row, same slot as outcomeLabel.
    // Text is set by _renderButtons from this.myVote.
    this.voteLabel = new Text({
      x: W / 2,
      y: actionY - 30,
      text: "Choose who goes first:",
      font: mobile ? "bold 20px sans-serif" : "bold 16px sans-serif",
      color: TEXT_TURN,
      align: "center",
      baseline: "middle",
    });
    this.voteLabel.visible = false;
    screen.add(this.voteLabel);

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

      this.nextBtn = null;
    }

    this.outcomeLabel = new Text({
      x: W / 2,
      y: actionY - 30,
      text: "",
      font: mobile ? "bold 16px sans-serif" : "bold 16px sans-serif",
      color: TEXT_TURN,
      align: "center",
      baseline: "middle",
    });
    this.outcomeLabel.visible = false;
    screen.add(this.outcomeLabel);
  }

  // Toggle the board layout. Convenience only. Swaps the four
  // anchor constants, repositions the frame composites, content
  // layers, Flip button, action row, controls toggles, and D-pads.
  // Game logic is untouched.
  _applyFlip() {
    this.flipped = !this.flipped;

    this._layoutBoards();
    this._renderAll();
  }

  _buildChatPanel(screen) {
    const W = Viewport.width;
    const H = Viewport.height;

    if (this.mobile) {
      const panel = new Panel({
        x: 0, y: 0, w: W, h: H,
        fill: BG_CHAT,
        stroke: null,
      });
      panel.visible = false;
      screen.add(panel);
      this.chatPanel = panel;

      // Title strip.
      panel.add(new Text({
        x: 20, y: 30,
        text: "Room Chat",
        font: "bold 20px sans-serif",
        color: TEXT_SECONDARY,
        align: "left",
        baseline: "middle",
      }));

      // Hide button, top-right. Above the log so it is never covered
      // by the keyboard. Toggles chat closed.
      panel.add(new Button({
        x: W - 140, y: 12, w: 120, h: 44,
        text: "Hide",
        fill: BTN_DARK_FILL,
        stroke: BTN_DARK_STROKE,
        strokeWidth: 2,
        radius: 8,
        textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
        onClick: () => this._toggleChat(),
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
        fill: BG_INSET,
        stroke: STROKE_INSET,
        strokeWidth: 2,
        radius: 6,
      });
      panel.add(inputPanel);

      this.inputLabel = new Label({
        x: 0, y: 0, w: "100%", h: "100%",
        text: "",
        textOptions: {
          font: "18px monospace",
          color: TEXT_PRIMARY,
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

      // Log above the input row. Starts below the title strip.
      const logX = 20;
      const logY = 70;
      const logH = rowY - logY - 12;

      this._chatMaxLines = Math.floor((logH - 8) / 22);

      this.chatMessageTexts = [];
      for (let i = 0; i < this._chatMaxLines; i++) {
        const t = new Text({
          x: logX + 4,
          y: logY + 4 + i * 22,
          text: "",
          font: "16px monospace",
          color: TEXT_CHAT,
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
        fill: BG_CHAT,
        stroke: STROKE_PANEL,
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
        color: TEXT_SECONDARY,
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
          color: TEXT_CHAT,
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
        fill: BG_INSET,
        stroke: STROKE_INSET,
        strokeWidth: 1,
        radius: 4,
      });
      panel.add(inputPanel);

      this.inputLabel = new Label({
        x: 0, y: 0, w: "100%", h: "100%",
        text: "",
        textOptions: {
          font: "14px monospace",
          color: TEXT_PRIMARY,
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

  // Find the first slot in `entries` that is not currently present.
  // Returns -1 if all slots are present. Used inside the presence-
  // claim build callback so the slot is decided against the freshest
  // content, not a pre-read.
  _firstFreeSlot(entries) {
    for (let i = 0; i < SLOTS; i++) {
      const e = entries[i];
      if (!e || !isPresent(e.iso)) return i;
    }
    return -1;
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

      const path   = DATA_ROOT + room + "/presence.txt";
      const myIso  = nowIso();
      const myName = this.username;
      const self   = this;

      // Slot is chosen INSIDE the callback, against whatever content
      // _writeWithRetry hands us. On the first attempt that content
      // is the pre-read we already have. On any retry (because
      // another joiner committed first) it is the freshly re-read
      // content, which now includes the other joiner's line. The
      // callback reports the slot it took via self._claimedSlot.
      this._claimedSlot = -1;

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
              const entries = self._parsePresence(currentContent);
              const chosen = self._firstFreeSlot(entries);
              if (chosen < 0) return null;
              self._claimedSlot = chosen;
              const newLine = "slot" + chosen + "|" + myName + "|" + myIso;
              return self._splicePresenceLine(currentContent, chosen, newLine);
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

      if (this._claimedSlot < 0) {
        // Should not happen: ok:true implies a slot was chosen. Guard
        // anyway so a silent failure cannot leave this.slot unset.
        this._setStatus("Room is full.");
        return;
      }

      this.room        = room;
      this.slot        = this._claimedSlot;
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
      this.myRematch = false;
      this.chatOpen = false;
      this.controlsVisible = false;
      this.placementControlsVisible = false;
      this.flipped = false;
      if (this.chatPanel) this.chatPanel.visible = false;
      if (this.chatKeyboard) this.chatKeyboard.visible = false;
      if (this.endPanel) this.endPanel.visible = false;
      this.unread = 0;

      this._layoutBoards();

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

      // First-turn handshake resolve.
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
              g.rematchP0 = false;
              g.rematchP1 = false;

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

      // Rematch handshake resolve. Runs only when a winner is set
      // and both players have flagged rematch. Single write resets
      // the game back to pre-vote state.
      const needsRematchResolve = this.game
        && this.game.winner != null
        && this.game.rematchP0 && this.game.rematchP1;

      if (needsRematchResolve) {
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
              if (g.winner == null) return null;
              if (!g.rematchP0 || !g.rematchP1) return null;

              g.started   = false;
              g.turn      = null;
              g.turnCount = 0;
              g.winner    = null;
              g.firstMode = "";
              g.voteP0    = "";
              g.voteP1    = "";
              g.readyP0   = false;
              g.readyP1   = false;
              g.rematchP0 = false;
              g.rematchP1 = false;

              // Preserve names, clear fleets and shots.
              for (let p = 0; p < SLOTS; p++) {
                const key = "p" + p;
                if (!g.players[key]) g.players[key] = { name: "", fleet: [], shots: [] };
                g.players[key].fleet = [];
                g.players[key].shots = [];
              }

              resolvedGame = g;
              return self._encodeGame(g);
            },
            "resolve rematch",
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

      this._syncVoteMirror();
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

  // Re-derive local vote / ready / rematch mirrors from the shared
  // game state. Called after every cycle so both clients agree on
  // what the buttons should show.
  _syncVoteMirror() {
    if (!this.game || this.slot === null) return;
    const mySlot = this.slot;
    const g = this.game;

    if (!g.started) {
      this.myVote  = (mySlot === 0 ? g.voteP0 : g.voteP1) || null;
      this.myReady = (mySlot === 0 ? g.readyP0 : g.readyP1);
    }

    this.myRematch = (mySlot === 0 ? g.rematchP0 : g.rematchP1);
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
    L.push("rematchP0=" + (g.rematchP0 ? 1 : 0));
    L.push("rematchP1=" + (g.rematchP1 ? 1 : 0));

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
      rematchP0: false,
      rematchP1: false,
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
        else if (k === "rematchP0") g.rematchP0 = v === "1";
        else if (k === "rematchP1") g.rematchP1 = v === "1";
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
    this._renderAll();

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
      this._syncVoteMirror();
      this._clearStatus();
      this._renderAll();

      this._kickCycle();
    } catch (e) {
      this._handleApiError(e, "vote");
    } finally {
      this._votingWrite = false;
      this._renderAll();
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
    this._renderAll();

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
      this._syncVoteMirror();
      this._clearStatus();
      this._renderAll();

      this._kickCycle();
    } catch (e) {
      this._handleApiError(e, "ready");
    } finally {
      this._votingWrite = false;
      this._renderAll();
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
  // Rematch.
  // =================================================================

  async _toggleRematch() {
    if (this._rematchWrite) return;
    if (!this.game) return;
    if (this.game.winner == null) return;

    this._rematchWrite = true;
    this._renderAll();

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
            if (g.winner == null) return null;
            const rematchKey = "rematchP" + mySlot;
            const nextRematch = !g[rematchKey];
            g[rematchKey] = nextRematch;
            return self._encodeGame(g);
          },
          "rematch " + mySlot,
          hint
        );
      });

      await this._refreshGameMirror();
      this._syncVoteMirror();
      this._renderAll();

      this._kickCycle();
    } catch (e) {
      this._handleApiError(e, "rematch");
    } finally {
      this._rematchWrite = false;
      this._renderAll();
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

    // Mobile: show the current ship at 0,0 immediately. Desktop
    // already shows it via hoverCell defaulting to 0,0.
    if (this.mobile) {
      this._placePreview = { x: 0, y: 0, horiz: !this.placeRot };
    } else {
      this._placePreview = null;
    }

    this._renderAll();
  }

  _rotatePlace() {
    if (!this.placing) return;
    this.placeRot = !this.placeRot;

    if (this._placePreview) {
      this._placePreview.horiz = !this.placeRot;
    } else if (this.mobile) {
      // No preview yet (should not happen after _beginPlacement, but
      // guard anyway) - create one so rotation has something to act
      // on.
      this._placePreview = { x: 0, y: 0, horiz: !this.placeRot };
    }
    this._renderAll();
  }

  _resetPlacement() {
    if (!this.placing) return;
    this.placeIdx = 0;
    this.placeRot = false;
    this.myFleet  = null;

    // Mobile: reset also re-shows the first ship at 0,0.
    if (this.mobile) {
      this._placePreview = { x: 0, y: 0, horiz: !this.placeRot };
    } else {
      this._placePreview = null;
    }

    this._renderAll();
  }

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

    // Mobile: the NEXT ship appears at 0,0 immediately.
    if (this.mobile && this.placeIdx < FLEET.length) {
      this._placePreview = { x: 0, y: 0, horiz: !this.placeRot };
    } else {
      this._placePreview = null;
    }

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

  // Move the current placement preview one cell in a direction.
  // Mobile placement D-pad and (in the mobile placement paths)
  // keyboard arrows both route through this.
  _nudgePlaceCursor(dir) {
    if (!this.placing) return;
    if (this.placeIdx >= FLEET.length) return;
    if (!this._placePreview) return;

    const c = this._placePreview;
    if (dir === "up")    c.y = Math.max(0, c.y - 1);
    if (dir === "down")  c.y = Math.min(BOARD_H - 1, c.y + 1);
    if (dir === "left")  c.x = Math.max(0, c.x - 1);
    if (dir === "right") c.x = Math.min(BOARD_W - 1, c.x + 1);
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
    this._renderAll();

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

      await self._refreshGameMirror();

      this.placing = false;
      this._placePreview = null;
      this._setStatus("");
      this._renderAll();
    } catch (e) {
      this._handleApiError(e, "lock in");
    } finally {
      this._placingWrite = false;
      this._renderAll();
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

  // Is this specific ship fully hit in the given shot list?
  _isShipSunk(ship, shots) {
    for (const c of ship.cells) {
      let hit = false;
      for (const sh of shots) {
        if (sh.hit && sh.x === c.x && sh.y === c.y) {
          hit = true;
          break;
        }
      }
      if (!hit) return false;
    }
    return true;
  }

  // Is the ship whose cells contain (x, y) now fully hit?
  _isShipContainingSunk(fleet, shots, x, y) {
    for (const ship of fleet) {
      let contains = false;
      for (const c of ship.cells) {
        if (c.x === x && c.y === y) {
          contains = true;
          break;
        }
      }
      if (!contains) continue;
      return this._isShipSunk(ship, shots);
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

  // Looser gate used by the mobile cursor render: still your turn,
  // still fire phase, but ignores _awaitingFire so the cursor stays
  // visible during the "Firing..." window.
  _canShowMobileCursor() {
    return this.game
      && this.game.started
      && this.game.winner == null
      && this.game.turn === this.slot
      && !this.placing
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

            const sunk = hit && self._isShipContainingSunk(opp.fleet, my.shots, cx, cy);
            const won  = self._allShipsSunk(opp.fleet, my.shots);

            if (won) {
              g.winner = mySlot;
              g.turn   = null;
              g.turnCount = (g.turnCount || 0) + 1;
              self.lastFeedback = sunk ? "Sunk! - you win!" : "HIT - you win!";
            } else if (sunk) {
              self.lastFeedback = "Sunk! - fire again";
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

      // After a HIT (turn is still ours), reset the mobile cursor to
      // (0,0). After a MISS the turn is the opponent's, so the cursor
      // is not shown and resetting is harmless. On win, likewise.
      if (this.mobile) {
        this.fireCursor = { x: 0, y: 0 };
      }

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
      const line = "[" + formatTime(parsed.iso) + "]" + parsed.username + ": " + parsed.text;
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
    this._renderEndPanel();
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

    // Shots by the opponent at my board (for sunk detection and the
    // per-hit overlay).
    let oppShots = null;
    if (this.game && this.game.players) {
      const opp = this.game.players["p" + (1 - this.slot)];
      oppShots = (opp && opp.shots) ? opp.shots : null;
    }

    if (fleet) {
      for (const ship of fleet) {
        const sunk = oppShots ? this._isShipSunk(ship, oppShots) : false;
        for (const c of ship.cells) {
          this.myLayer.add(new Rect({
            x: c.x * cell + 1,
            y: c.y * cell + 1,
            w: cell - 2,
            h: cell - 2,
            fill: sunk ? COLOR_MY_SUNK : COLOR_SHIP,
            stroke: null,
          }));
        }
      }
    }

    if (oppShots) {
      for (const s of oppShots) {
        // Skip cells that belong to a sunk ship: the ship already
        // draws in the dark sunk color and the overlay would cover
        // it.
        if (s.hit && this._shipAtIsSunk(fleet, oppShots, s.x, s.y)) continue;
        this.myLayer.add(new Rect({
          x: s.x * cell + 1,
          y: s.y * cell + 1,
          w: cell - 2,
          h: cell - 2,
          fill: s.hit ? COLOR_MY_HIT : COLOR_MISS,
          stroke: null,
        }));
      }
    }

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
          fill: valid ? COLOR_PLACE_OK : COLOR_PLACE_BAD,
          stroke: null,
        }));
      }
    }
  }

  // True if the ship whose cells contain (x, y) is fully hit in
  // `shots`. Returns false if (x, y) is not on any ship.
  _shipAtIsSunk(fleet, shots, x, y) {
    if (!fleet) return false;
    for (const ship of fleet) {
      let contains = false;
      for (const c of ship.cells) {
        if (c.x === x && c.y === y) {
          contains = true;
          break;
        }
      }
      if (!contains) continue;
      return this._isShipSunk(ship, shots);
    }
    return false;
  }

  _renderOpBoard() {
    if (!this.opLayer) return;
    this.opLayer.children.length = 0;

    const cell = this._cell;

    // My shots at the enemy board.
    let myShots = null;
    let oppFleet = null;
    if (this.game && this.game.players) {
      const me  = this.game.players["p" + this.slot];
      const opp = this.game.players["p" + (1 - this.slot)];
      myShots  = (me && me.shots) ? me.shots : null;
      oppFleet = (opp && opp.fleet) ? opp.fleet : null;
    }

    if (myShots) {
      for (const s of myShots) {
        // Skip cells that belong to a sunk enemy ship: that ship is
        // rendered separately below in dark green.
        if (s.hit && this._shipAtIsSunk(oppFleet, myShots, s.x, s.y)) continue;
        this.opLayer.add(new Rect({
          x: s.x * cell + 1,
          y: s.y * cell + 1,
          w: cell - 2,
          h: cell - 2,
          fill: s.hit ? COLOR_OP_HIT : COLOR_MISS,
          stroke: null,
        }));
      }
    }

    // Sunk enemy ships: draw every cell of each sunk ship in dark
    // green, so the whole ship reads as down.
    if (oppFleet && myShots) {
      for (const ship of oppFleet) {
        if (!this._isShipSunk(ship, myShots)) continue;
        for (const c of ship.cells) {
          this.opLayer.add(new Rect({
            x: c.x * cell + 1,
            y: c.y * cell + 1,
            w: cell - 2,
            h: cell - 2,
            fill: COLOR_OP_SUNK,
            stroke: null,
          }));
        }
      }
    }

    // Mobile: cursor is drawn whenever it is this player's turn in
    // the fire phase, INCLUDING while _awaitingFire is true. This
    // keeps the cursor visible during "Firing..." so the shooter can
    // see where the shot is going. After a hit, the cursor has been
    // reset to (0,0) and this render picks it up.
    if (this.mobile) {
      if (!this._canShowMobileCursor()) return;
      const c = this.fireCursor;
      this.opLayer.add(new Rect({
        x: c.x * cell + 2,
        y: c.y * cell + 2,
        w: cell - 4,
        h: cell - 4,
        fill: "#ffffff",
        stroke: COLOR_FIRE_CURSOR,
        strokeWidth: 2,
      }));
      return;
    }

    // Desktop.
    if (!this._canFireNow()) return;

    if (this.lockedShot) {
      this.opLayer.add(new Rect({
        x: this.lockedShot.x * cell + 2,
        y: this.lockedShot.y * cell + 2,
        w: cell - 4,
        h: cell - 4,
        fill: COLOR_FIRE_CURSOR,
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
      stroke: COLOR_FIRE_CURSOR,
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

    this.voteMeBtn.visible    = !!votePhase;
    this.voteDeferBtn.visible = !!votePhase;
    this.readyBtn.visible     = !!votePhase;

    if (this.voteLabel) {
      this.voteLabel.visible = !!votePhase;
      if (votePhase) {
        const choice = this.myVote === "me" ? "Me"
                     : this.myVote === "defer" ? "Defer"
                     : "";
        this.voteLabel.text = choice
          ? "Choose who goes first: " + choice
          : "Choose who goes first:";
      }
    }

    if (votePhase) {
      if (this._votingWrite) {
        // Any vote or ready write in flight greys all three. This
        // is the visual signal that a commit is being processed.
        this.voteMeBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
        this.voteDeferBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
        this.readyBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
      } else if (this.myReady) {
        // Ready state: chosen green, other blue, Ready red Unready.
        // Me and Defer grey to indicate they are not pressable
        // until Unready is recorded.
        this.voteMeBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
        this.voteDeferBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
        this.readyBtn.setText("Unready");
        this.readyBtn.setBaseStyle({ fill: BTN_RED_FILL, stroke: BTN_RED_STROKE });
      } else {
        // Not ready: chosen green, other blue, Ready green or grey.
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

        this.readyBtn.setText("Ready");
        if (this.myVote) {
          this.readyBtn.setBaseStyle({ fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE });
        } else {
          this.readyBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
        }
      }
    }

    this.placeBtn.visible = !!placeEntry;

    const allPlaced = this._allShipsPlaced();
    const placingWrite = this._placingWrite;

    if (this.mobile) {
      if (placeCtl) {
        this.lockBtn.visible = true;
        if (placingWrite) {
          this.lockBtn.setText("Lock In");
          this.lockBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
          this.rotateBtn.visible = true;
          this.rotateBtn.setText("Rotate");
          this.rotateBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
          this.nextBtn.visible = true;
          this.nextBtn.setText("Next");
          this.nextBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
          this.resetBtn.visible = true;
          this.resetBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
        } else if (allPlaced) {
          this.lockBtn.setText("Lock In");
          this.lockBtn.setBaseStyle({ fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE });

          this.rotateBtn.visible = false;
          this.nextBtn.visible   = false;
          this.resetBtn.visible  = true;
          this.resetBtn.setBaseStyle({ fill: BTN_DARK_FILL, stroke: BTN_DARK_STROKE });
        } else {
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
      this.rotateBtn.visible = !!placeCtl;
      this.resetBtn.visible  = !!placeCtl;

      const showLock = !!placeCtl
        || (gameStarted && this._iHaveLockedIn() && !this._bothFleetsIn());
      this.lockBtn.visible = showLock;

      if (placingWrite) {
        this.lockBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
        this.rotateBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
        this.resetBtn.setBaseStyle({ fill: BUSY_FILL, stroke: BUSY_STROKE });
      } else if (showLock) {
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

        if (this.rotateBtn.visible) {
          this.rotateBtn.setText("Rotate (R)");
          this.rotateBtn.setBaseStyle({ fill: BTN_DARK_FILL, stroke: BTN_DARK_STROKE });
        }
        if (this.resetBtn.visible) {
          this.resetBtn.setBaseStyle({ fill: BTN_DARK_FILL, stroke: BTN_DARK_STROKE });
        }
      }
    }

    this.fireBtn.visible = !!firePhase && (this.mobile || !!this.lockedShot);

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

      if (this.placementControlsToggle) {
        if (placeCtl) {
          this.placementControlsToggle.visible = true;
          this.placementControlsToggle.setText(
            this.placementControlsVisible ? "Hide Controls" : "Show Controls"
          );
        } else {
          this.placementControlsToggle.visible = false;
        }
      }
      for (const b of this.placementDpadButtons) {
        b.visible = !!placeCtl && this.placementControlsVisible;
      }
    }
  }

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

  // Show or hide the end-of-game panel from game.winner.
  _renderEndPanel() {
    if (!this.endPanel) return;

    const g = this.game;
    const show = !!(g && g.winner != null);

    this.endPanel.visible = show;
    if (!show) return;

    const iWon = (g.winner === this.slot);
    this.endTitleLabel.text = iWon ? "You win!" : "You lose.";

    this._renderEndPanelButtons();
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

    // While the end panel is up, board keys are inert. The buttons
    // are handled by the router.
    if (this.endPanel && this.endPanel.visible) return;

    if (this.placing) {
      if (k === "r" || k === "R") { this._rotatePlace(); return; }
      if (k === "ArrowLeft" || k === "a" || k === "A") {
        if (this.mobile && this._placePreview) {
          this._nudgePlaceCursor("left");
        } else {
          this.hoverCell.x = Math.max(0, this.hoverCell.x - 1);
          this._renderAll();
        }
        return;
      }
      if (k === "ArrowRight" || k === "d" || k === "D") {
        if (this.mobile && this._placePreview) {
          this._nudgePlaceCursor("right");
        } else {
          this.hoverCell.x = Math.min(BOARD_W - 1, this.hoverCell.x + 1);
          this._renderAll();
        }
        return;
      }
      if (k === "ArrowUp" || k === "w" || k === "W") {
        if (this.mobile && this._placePreview) {
          this._nudgePlaceCursor("up");
        } else {
          this.hoverCell.y = Math.max(0, this.hoverCell.y - 1);
          this._renderAll();
        }
        return;
      }
      if (k === "ArrowDown" || k === "s" || k === "S") {
        if (this.mobile && this._placePreview) {
          this._nudgePlaceCursor("down");
        } else {
          this.hoverCell.y = Math.min(BOARD_H - 1, this.hoverCell.y + 1);
          this._renderAll();
        }
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
    if (this.endPanel && this.endPanel.visible) return;

    if (this.mobile && this.placing && this._dragPlace) {
      const c = this._cellFromPoint(e.x, e.y, this._myBx, this._myBy);
      if (c) {
        this._placePreview = { x: c.x, y: c.y, horiz: !this.placeRot };
        this._renderAll();
      }
      return;
    }

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

    if (!this.mobile && this.placing) {
      const c = this._cellFromPoint(e.x, e.y, this._myBx, this._myBy);
      if (c) {
        this.hoverCell = c;
        this._renderAll();
      }
      return;
    }

    if (!this.mobile && this._canFireNow()) {
      const c = this._cellFromPoint(e.x, e.y, this._opBx, this._opBy);
      if (c) {
        this.fireCursor = c;
        this._renderAll();
      }
    }
  }

  _handleGameMouseDown(e) {
    if (this.endPanel && this.endPanel.visible) return;

    if (this.mobile && this.placing) {
      const c = this._cellFromPoint(e.x, e.y, this._myBx, this._myBy);
      if (c) {
        this._dragPlace = true;
        this._placePreview = { x: c.x, y: c.y, horiz: !this.placeRot };
        this._renderAll();
      }
      return;
    }

    if (!this.mobile && this.placing) {
      const c = this._cellFromPoint(e.x, e.y, this._myBx, this._myBy);
      if (c) {
        this._placeCurrentAt(c.x, c.y);
        return;
      }
    }

    if (this.mobile && this._canFireNow()) {
      const c = this._cellFromPoint(e.x, e.y, this._opBx, this._opBy);
      if (c) {
        this._dragFire = true;
        this.fireCursor = c;
        this._renderAll();
      }
      return;
    }

    if (!this.mobile && this._canFireNow()) {
      const c = this._cellFromPoint(e.x, e.y, this._opBx, this._opBy);
      if (c) {
        this._lockShotAt(c.x, c.y);
        return;
      }
    }
  }

  _handleGameMouseUp(e) {
    if (this.endPanel && this.endPanel.visible) return;

    if (this.mobile && this.placing && this._dragPlace) {
      this._dragPlace = false;

      const c = this._cellFromPoint(e.x, e.y, this._myBx, this._myBy);
      if (c) {
        this._placePreview = { x: c.x, y: c.y, horiz: !this.placeRot };
      }
      this._renderAll();
      return;
    }

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

  _togglePlacementControls() {
    this.placementControlsVisible = !this.placementControlsVisible;
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