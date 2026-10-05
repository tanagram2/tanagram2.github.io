// ChatRoom.
//
// Client-managed chatroom with no server. Coordination happens through
// files in a GitHub repository, via the Git Data API (blobs, trees,
// commits, refs).
//
// Why Git Data and not Contents: the Contents API is served from a
// cache that is not invalidated promptly after a write, so a read
// right after a write can return the pre-write version and break a
// compare-and-swap. Git Data reads the ref and object database
// directly.
//
// The ref PATCH is the compare-and-swap. On failure we check whether
// our commit actually landed; if it did, the write succeeded and we
// do NOT retry. Otherwise someone else advanced the branch and we
// rebuild.
//
// All git traffic is serialized through one promise chain (_serialize),
// so a cycle and a manual Update cannot race each other.
//
// Tree writes use ONE POST with the full nested path and base_tree.
// GitHub resolves intermediate directories. Do NOT hand-roll the
// directory chain; an earlier version wrote files to data/data/... and
// made every room look empty.
//
// All app data lives under a per-app subfolder of data/, named after
// the app's .js file. ChatRoom's data root is data/ChatRoom/. Rooms
// are nested inside it: data/ChatRoom/roomN/...
//
// Presence: one file per room, data/ChatRoom/roomN/presence.txt, ten
// lines. Line N is slot N. Line format:
//
//     slotN|username|ISO-timestamp
//
// A line is present if its timestamp is within STALE_MS. Room count is
// the number of present lines. A room is dead if zero lines are
// present. Join takes the first not-present line. Leave writes an
// ancient timestamp into the client's own line.
//
// Presence writes are text-level splices: read the ten lines, change
// only your own line, write the whole file back. The other nine lines
// pass through byte-for-byte.
//
// Heartbeat and sync are one cycle. A cycle reads the tree, the log
// blob, and the presence blob; updates the message and user lists;
// refreshes the client's own presence line; writes presence back.
//
// Message ordering: the message list is rebuilt from the log file on
// every cycle that sees a new log sha, in FILE ORDER. The list is not
// an append-only local accumulation. This makes log.txt the single
// source of truth for order: two clients that agree on the file agree
// on the order. The sha cache still skips the blob read when the log
// has not changed, and in that case the list stays as-is (which is
// already correct, because the file has not changed).
//
// Optimistic echo: _sendMessage appends the sender's own line to the
// local list immediately, so the sender sees their message without
// waiting for the next cycle. A kick-cycle runs after a successful
// send, so the local list is rebuilt from disk order within a second
// or two, correcting any transient mismatch between two near-
// simultaneous senders.
//
// Request budget notes:
//   - _fetchTreeContext uses the commits-by-ref endpoint to fold the
//     ref read and the commit read into one request. Then one tree
//     read. Two requests per context fetch instead of three.
//   - _cycle caches the log blob sha. If the log entry in the tree
//     carries the same sha as last cycle, the log blob is not read
//     again.
//   - _writeWithRetry accepts a hint carrying a tree context the
//     caller already has (commit sha, tree sha, entries, and the
//     current content of the file being written). If the hint's
//     commit sha matches the live ref, the write path skips the
//     ref/commit/tree reads and the file-content read.
//
// Decongestion: on a cycle that had to retry at least once before
// succeeding, shift the next cycle later by a random 500-3000ms. This
// is one-way drift, so a pack of clients that started in lockstep
// spreads out and stays spread out. Each client also starts with a
// random 0-2000ms pre-stagger before its first cycle. A manual Update
// is exempt from the stagger logic.
//
// A countdown label under the Update button shows seconds until the
// next automatic cycle. It reflects the actual scheduled time,
// including any stagger, and resets on manual Update.
//
// Screens (one canvas, toggled via visible):
//   1. Username   - display name (not unique).
//   2. Room list  - three rooms, occupancy shown as "N/10".
//   3. Chat       - log + user list + input + Send + Update + Leave.
//
// The session used for Authorization is read from localStorage at
// init. Missing or wrong values surface through the network error
// paths. There is no in-app entry screen for it.
//
// Desktop: wide box, log on the left, user list as a right column.
// Mobile: user list becomes a slim horizontal strip at the top of the
// box, log below, input row at the bottom. On mobile the box is
// deliberately shorter than the screen so the on-canvas keyboard has a
// reserved strip below it. The box height is fixed and does not change
// when the keyboard toggles.
//
// Slot claiming: the slot a joiner takes is decided INSIDE the
// presence-claim build callback, against the freshest presence
// content _writeWithRetry has, not against a pre-read taken before
// the write. Two clients racing to join an empty room both read
// 0/10, then both claim. Whichever commits first takes slot 0. The
// loser's hint misses (or its PATCH conflicts), _writeWithRetry
// re-reads, and the callback sees slot 0 now occupied and takes the
// next free slot. The callback reports its chosen slot back out via
// self._claimedSlot. If the room fills under the callback, it
// returns null and _writeWithRetry returns { ok: false }; the join
// surfaces "Room is full".
//
// Dead-room reset: a room is dead when presence.txt has zero
// present lines. Only then does the reset path run. On the dead
// path, the joiner claims a presence slot FIRST, then resets
// log.txt. It NEVER resets presence.txt on this path. The old
// presence reset was the destructive step: it could wipe a line
// another joiner had just written, leaving two clients who each saw
// a room with only themselves in it. Claim-first makes the claimer
// present before any reset runs, so a second joiner arriving one
// moment later sees a live room and takes another slot. The log.txt
// reset is an idempotent no-op on an already-empty file, so a race
// on it is harmless.
//
// The reset path runs ONLY when presence reads as zero present. If
// even one slot is live (for example a lone player waiting for
// others), a new joiner reads the room as alive, claims a free slot,
// and never touches the reset path. That means a joiner can see
// messages sent before they arrived, in file order, as long as at
// least one other presence line was live at the moment they joined.
//
// Status line: every screen's in-flight descriptor (Joining,
// Resetting dead room, Updating, Sending, Leaving) is shown in the
// same spot: to the right of the top-left button, on the header row.
// Room screen and chat screen both use x=180, y=36. The status
// text never moves between screens.
//
// Two Update buttons exist, on different screens, with different
// behavior:
//   - Chat screen Update (this.updateBtn) runs a full cycle
//     (_manualUpdate -> _cycle). Throttled at UPDATE_THROTTLE.
//   - Room list Update (this.roomListUpdateBtn) runs only a room
//     occupancy read (_manualUpdateRoomList -> _refreshRoomOccupancy).
//     No throttle. It is a read-only operation.
// They share a visual style and a screen position on their
// respective screens, but they are separate objects, wired to
// separate handlers, with separate countdown labels and separate
// timers.
//
// In-flight button feedback: every async button handler that talks
// to the network greys the button that was pressed via
// _busyStart / _busyEnd, and sets a status line. This is the visual
// signal that a request is committed and the user does not need to
// press again.

import { App }       from "./App.js";
import { Rect }      from "../primitives/Rect.js";
import { Text }      from "../primitives/Text.js";
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

const DATA_ROOT = "data/ChatRoom/";

// Tunables.

const ROOMS = ["room1", "room2", "room3"];
const ROOM_LABELS = { room1: "Room1", room2: "Room2", room3: "Room3" };
const SLOTS = 10;

const STALE_MS         = 2 * 60 * 1000;  // presence freshness
const CYCLE_MS         = 30 * 1000;      // automatic cycle interval
const UPDATE_THROTTLE  = 10 * 1000;      // manual Update cooldown
const SEND_COOLDOWN    = 15 * 1000;      // min gap between sends
const PUT_MAX_RETRIES  = 6;              // retries per write
const PUT_BACKOFF_MS   = 250;            // random backoff ceiling per retry
const DEAD_CONFIRM_MS  = 1000;           // gap between dead-room reads

const STAGGER_MIN_MS    = 500;
const STAGGER_MAX_MS    = 3000;
const PRESTAGGER_MAX_MS = 2000;

// Room list screen auto-refresh. Independent of CYCLE_MS so it can
// be tuned on its own.
const ROOMLIST_REFRESH_MS = 30000;

const LEAVE_TIMESTAMP = "1970-01-01T00:00:00.000Z";

const CURSOR_MS = 500;

const SESSION_KEY = "canvasos.session.id";

const API = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/";

// Busy-button colors. Used while a git request is in flight.

const BUSY_FILL   = "#5a5a5a";
const BUSY_STROKE = "#a8a8a8";

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

function hhmm(isoStr) {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "--:--";
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return h + ":" + m;
}

export class ChatRoom extends App {
  static displayName = "ChatRoom";

  init() {
    this.mobile = Viewport.isMobile;

    this.session  = this._loadSession();
    this.username = "";

    this.room = null;
    this.slot = null;

    this.messages = [];
    this.users    = [];

    this._cycleTimer  = null;
    this._cycleDelay  = CYCLE_MS;
    this._nextCycleAt = 0;

    // Room-list-screen auto-refresh scheduler. Independent of the
    // game cycle. Runs only while the room list is visible.
    this._roomListTimer  = null;
    this._roomListNextAt = 0;

    this._lastUpdate = 0;
    this._lastSend   = 0;

    this._sending  = false;
    this._updating = false;
    this._joining  = false;
    this._leaving  = false;
    this._roomListUpdating = false;

    this._cursorOn    = true;
    this._cursorTimer = 0;

    this._usernameBuffer = "";
    this.inputText       = "";

    this._chatKeyboardVisible = false;

    // Last seen log blob sha. Used to skip re-reading an unchanged log.
    this._lastLogSha = null;

    // Slot chosen by the presence-claim write callback during join.
    // Set as a side effect and read back after the write lands, so
    // this.slot reflects what the file actually granted, not what a
    // pre-write read guessed.
    this._claimedSlot = -1;

    this._opChain = Promise.resolve();

    this.stack = ["username"];

    this.usernameScreen = this._buildUsernameScreen();
    this.roomScreen     = this._buildRoomScreen();
    this.chatScreen     = this._buildChatScreen();

    this.root.add(this.usernameScreen);
    this.root.add(this.roomScreen);
    this.root.add(this.chatScreen);

    this._applyScreen("username");
    this._refreshUsernameField();
    this._refreshChatInput();
    this._refreshCountdown();
    this._refreshRoomListCountdown();
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

  _refreshRoomListCountdown() {
    if (!this.roomListCountdownLabel) return;

    if (!this._roomListNextAt) {
      this.roomListCountdownLabel.text = "";
      return;
    }

    const remainMs  = this._roomListNextAt - Date.now();
    const remainSec = remainMs > 0 ? Math.ceil(remainMs / 1000) : 0;
    this.roomListCountdownLabel.text = "auto: " + remainSec + "s";
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
      text: "Username:",
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

    // Room-list Update button. Distinct object from the chat
    // screen's Update button. Wired to a handler that runs only a
    // room occupancy read, not a full cycle. Same visual style and
    // screen position as the chat screen's Update button.
    this.roomListUpdateBtn = new Button({
      x: W - 164, y: 24, w: 140, h: 48,
      text: "Update",
      fill: "#2a3552",
      stroke: "#6a86b8",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._manualUpdateRoomList(),
    });
    screen.add(this.roomListUpdateBtn);

    this.roomListCountdownLabel = new Text({
      x: W - 164 + 70,
      y: 24 + 48 + 16,
      text: "",
      font: "14px monospace",
      color: "#5f7a95",
      align: "center",
      baseline: "middle",
    });
    screen.add(this.roomListCountdownLabel);

    // Status line, in the header row, to the right of the Return
    // button. Same position as the chat screen's statusLabel.
    this.roomStatusLabel = new Text({
      x: 180,
      y: 36,
      text: "",
      font: this.mobile ? "16px monospace" : "14px monospace",
      color: "#8fa9d0",
      align: "left",
      baseline: "middle",
    });
    screen.add(this.roomStatusLabel);

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
        text: ROOM_LABELS[roomName] + "  ?/10",
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

    return screen;
  }

  _buildChatScreen() {
    const W = Viewport.width;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#101820",
      stroke: null,
    });

    this.leaveBtn = new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Leave",
      fill: "#3a2a2a",
      stroke: "#8f6060",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._leaveRoom(),
    });
    screen.add(this.leaveBtn);

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
      font: this.mobile ? "bold 22px sans-serif" : "bold 20px sans-serif",
      color: "#d8e4f7",
      align: "center",
      baseline: "middle",
    });
    screen.add(this.roomTitleLabel);

    // Status line, in the header row, to the right of the Leave
    // button. Same position as the room screen's roomStatusLabel.
    this.statusLabel = new Text({
      x: 180,
      y: 36,
      text: "",
      font: this.mobile ? "16px monospace" : "14px monospace",
      color: "#8fa9d0",
      align: "left",
      baseline: "middle",
    });
    screen.add(this.statusLabel);

    if (this.mobile) {
      this._buildChatScreenMobile(screen);
    } else {
      this._buildChatScreenDesktop(screen);
    }

    return screen;
  }

  _buildChatScreenDesktop(screen) {
    const W = Viewport.width;
    const H = Viewport.height;

    const boxW = Math.min(W - 120, 1100);
    const boxH = Math.min(H - 180, 620);
    const boxX = (W - boxW) / 2;
    const boxY = 110;

    const userColW  = 220;
    const inputRowH = 64;

    this._maxLines = Math.floor((boxH - inputRowH - 20) / 22);

    const box = new Panel({
      x: boxX, y: boxY, w: boxW, h: boxH,
      fill: "#0c121a",
      stroke: "#3a4d70",
      strokeWidth: 2,
      radius: 8,
    });
    screen.add(box);

    box.add(new Rect({
      x: boxW - userColW - 1, y: 0,
      w: 2, h: boxH,
      fill: "#2a3552",
      stroke: null,
    }));

    box.add(new Rect({
      x: 0, y: boxH - inputRowH - 1,
      w: boxW - userColW, h: 2,
      fill: "#2a3552",
      stroke: null,
    }));

    this.messageTexts = [];
    for (let i = 0; i < this._maxLines; i++) {
      const t = new Text({
        x: 16, y: 12 + i * 22,
        text: "",
        font: "16px monospace",
        color: "#d8e4f7",
        align: "left",
        baseline: "top",
      });
      box.add(t);
      this.messageTexts.push(t);
    }

    this.userTexts = [];
    for (let i = 0; i < SLOTS; i++) {
      const t = new Text({
        x: boxW - userColW + 16,
        y: 12 + i * 24,
        text: "",
        font: "15px monospace",
        color: "#7a8a9a",
        align: "left",
        baseline: "top",
      });
      box.add(t);
      this.userTexts.push(t);
    }

    const inputW = boxW - userColW - 140 - 24;
    const inputX = 12;
    const inputY = boxH - inputRowH + 8;

    const inputPanel = new Panel({
      x: inputX, y: inputY,
      w: inputW, h: inputRowH - 16,
      fill: "#0a1018",
      stroke: "#2a3552",
      strokeWidth: 2,
      radius: 6,
    });
    box.add(inputPanel);

    this.inputLabel = new Label({
      x: 0, y: 0, w: "100%", h: "100%",
      text: "",
      textOptions: {
        font: "16px monospace",
        color: "#d8e4f7",
        align: "left",
        baseline: "middle",
      },
    });
    this.inputLabel.text.x = 12;
    this.inputLabel.text.y = "50%";
    inputPanel.add(this.inputLabel);

    const sendW = 120;
    const sendX = inputX + inputW + 12;
    const sendY = inputY;

    this.sendBtn = new Button({
      x: sendX, y: sendY, w: sendW, h: inputRowH - 16,
      text: "Send",
      fill: "#2a4a2a",
      stroke: "#6a9a6a",
      strokeWidth: 2,
      radius: 6,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._sendMessage(),
    });
    box.add(this.sendBtn);

    this.chatKeyboard   = null;
    this.chatTypeToggle = null;
  }

  _buildChatScreenMobile(screen) {
    const W = Viewport.width;
    const H = Viewport.height;

    const boxX = 20;
    const boxY = 130;
    const boxW = W - 40;

    const kbMargin = 40;
    const kbW      = W - kbMargin * 2;
    const kbX      = kbMargin;

    this.chatKeyboard = new Keyboard({
      x: kbX, y: 0,
      w: kbW,
      onKey: (char) => this._handleChatKey({ key: char, length: 1 }),
    });
    const kbH = this.chatKeyboard.h;

    const gapAboveKb     = 16;
    const kbBottomMargin = 20;

    const boxH = H - boxY - kbH - gapAboveKb - kbBottomMargin;

    const userStripH = 44;
    const inputRowH  = 80;
    const logH       = boxH - userStripH - inputRowH;

    this._mBoxX       = boxX;
    this._mBoxY       = boxY;
    this._mBoxW       = boxW;
    this._mBoxH       = boxH;
    this._mUserStripH = userStripH;
    this._mInputRowH  = inputRowH;
    this._mKbX        = kbX;
    this._mKbW        = kbW;
    this._mLogH       = logH;

    const box = new Panel({
      x: boxX, y: boxY, w: boxW, h: boxH,
      fill: "#0c121a",
      stroke: "#3a4d70",
      strokeWidth: 2,
      radius: 8,
    });
    screen.add(box);
    this._mBox = box;

    box.add(new Rect({
      x: 0, y: userStripH - 1,
      w: boxW, h: 2,
      fill: "#2a3552",
      stroke: null,
    }));

    box.add(new Rect({
      x: 0, y: boxH - inputRowH - 1,
      w: boxW, h: 2,
      fill: "#2a3552",
      stroke: null,
    }));

    this.userTexts = [];
    for (let s = 0; s < SLOTS; s++) {
      const t = new Text({
        x: 10 + s * 68,
        y: userStripH / 2,
        text: "",
        font: "14px monospace",
        color: "#7a8a9a",
        align: "left",
        baseline: "middle",
      });
      box.add(t);
      this.userTexts.push(t);
    }

    const logTop = userStripH + 8;
    const lineH  = 20;
    const linesFit = Math.max(1, Math.floor((logH - 16) / lineH));

    this._maxLines = linesFit;
    this._mLogTop  = logTop;
    this._mLineH   = lineH;

    this.messageTexts = [];
    for (let i = 0; i < linesFit; i++) {
      const t = new Text({
        x: 12, y: logTop + i * lineH,
        text: "",
        font: "14px monospace",
        color: "#d8e4f7",
        align: "left",
        baseline: "top",
      });
      box.add(t);
      this.messageTexts.push(t);
    }

    const inputY = boxH - inputRowH + 10;
    const inputH = inputRowH - 20;

    const btnW   = 90;
    const btnGap = 8;
    const sendX  = boxW - 12 - btnW;
    const typeX  = sendX - btnGap - btnW;

    const inputX = 12;
    const inputW = typeX - btnGap - inputX;

    const inputPanel = new Panel({
      x: inputX, y: inputY,
      w: inputW, h: inputH,
      fill: "#0a1018",
      stroke: "#2a3552",
      strokeWidth: 2,
      radius: 6,
    });
    box.add(inputPanel);

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

    this.chatTypeToggle = new Button({
      x: typeX, y: inputY,
      w: btnW, h: inputH,
      text: "Type",
      fill: "#2a2a3a",
      stroke: "#5a5a7a",
      strokeWidth: 2,
      radius: 6,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._toggleChatKeyboard(),
    });
    box.add(this.chatTypeToggle);

    this.sendBtn = new Button({
      x: sendX, y: inputY,
      w: btnW, h: inputH,
      text: "Send",
      fill: "#2a4a2a",
      stroke: "#6a9a6a",
      strokeWidth: 2,
      radius: 6,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._sendMessage(),
    });
    box.add(this.sendBtn);

    const kbY = boxY + boxH + gapAboveKb;
    this.chatKeyboard.x = kbX;
    this.chatKeyboard.y = kbY;
    this.chatKeyboard.visible = false;
    screen.add(this.chatKeyboard);

    this._mKbY = kbY;
  }

  _toggleChatKeyboard() {
    this._chatKeyboardVisible = !this._chatKeyboardVisible;
    this._applyChatKeyboardLayout();
  }

  _applyChatKeyboardLayout() {
    if (!this.mobile) return;

    const show = this._chatKeyboardVisible;
    this.chatKeyboard.visible = show;
    if (this.chatTypeToggle) {
      this.chatTypeToggle.setText(show ? "Hide" : "Type");
    }
  }

  // ---------- Screen navigation ----------

  _applyScreen(name) {
    this.usernameScreen.visible = name === "username";
    this.roomScreen.visible     = name === "room";
    this.chatScreen.visible     = name === "chat";

    this._cursorOn    = true;
    this._cursorTimer = 0;

    if (name !== "chat") {
      this._stopCycle();
      this._chatKeyboardVisible = false;
      if (this.mobile && this.chatKeyboard) {
        this.chatKeyboard.visible = false;
      }
    }

    if (name === "room") {
      this._startRoomListRefresh();
    } else {
      this._stopRoomListRefresh();
    }

    this._refreshUsernameField();
    this._refreshChatInput();
    this._refreshCountdown();
    this._refreshRoomListCountdown();

    if (name !== "room" && this.roomStatusLabel) {
      this.roomStatusLabel.text = "";
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

    if (leaving === "chat") {
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
    if (top === "chat" && this.statusLabel) {
      this.statusLabel.text = text;
    } else if (this.roomStatusLabel) {
      this.roomStatusLabel.text = text;
    }
  }

  _clearStatus() {
    this._setStatus("");
  }

  // ---------- Room-list auto-refresh ----------

  _startRoomListRefresh() {
    this._stopRoomListRefresh();
    this._roomListNextAt = Date.now() + ROOMLIST_REFRESH_MS;
    this._refreshRoomListCountdown();
    this._roomListTimer = setTimeout(() => this._runRoomListRefreshLoop(), ROOMLIST_REFRESH_MS);
  }

  _stopRoomListRefresh() {
    if (this._roomListTimer) {
      clearTimeout(this._roomListTimer);
      this._roomListTimer = null;
    }
    this._roomListNextAt = 0;
    this._refreshRoomListCountdown();
  }

  async _runRoomListRefreshLoop() {
    // If the room list is no longer visible, stop silently.
    if (this.stack[this.stack.length - 1] !== "room") {
      this._stopRoomListRefresh();
      return;
    }

    this._roomListNextAt = 0;
    this._refreshRoomListCountdown();

    try {
      await this._refreshRoomOccupancy();
    } catch (e) {
      // _refreshRoomOccupancy handles its own error status.
    }

    if (this.stack[this.stack.length - 1] !== "room") {
      this._stopRoomListRefresh();
      return;
    }

    this._roomListNextAt = Date.now() + ROOMLIST_REFRESH_MS;
    this._refreshRoomListCountdown();
    this._roomListTimer = setTimeout(() => this._runRoomListRefreshLoop(), ROOMLIST_REFRESH_MS);
  }

  async _manualUpdateRoomList() {
    if (this._roomListUpdating) return;
    if (this.stack[this.stack.length - 1] !== "room") return;

    this._roomListUpdating = true;
    this._busyStart(this.roomListUpdateBtn);

    // Reset the countdown to a fresh interval now.
    if (this._roomListTimer) {
      clearTimeout(this._roomListTimer);
      this._roomListTimer = null;
    }
    this._roomListNextAt = 0;
    this._refreshRoomListCountdown();

    try {
      await this._refreshRoomOccupancy();
    } catch (e) {
      // _refreshRoomOccupancy handles its own error status.
    }

    this._busyEnd(this.roomListUpdateBtn);
    this._roomListUpdating = false;

    if (this.stack[this.stack.length - 1] !== "room") {
      this._stopRoomListRefresh();
      return;
    }

    this._roomListNextAt = Date.now() + ROOMLIST_REFRESH_MS;
    this._refreshRoomListCountdown();
    this._roomListTimer = setTimeout(() => this._runRoomListRefreshLoop(), ROOMLIST_REFRESH_MS);
  }

  // ---------- Room occupancy ----------

  async _refreshRoomOccupancy() {
    for (const name of ROOMS) {
      this.roomButtons[name].setText(ROOM_LABELS[name] + "  ?/10");
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
      this.roomButtons[name].setText(ROOM_LABELS[name] + "  " + c + "/10");
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

    const pressedBtn = this.roomButtons[room];
    if (pressedBtn) this._busyStart(pressedBtn);

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

      // If the room looked dead, confirm after a short pause. This
      // is to avoid resetting a room whose presence file just
      // happens to be mid-write.
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

      const roomIsDead = !anyPresent;

      if (roomIsDead) {
        this._setStatus("Resetting dead room...");
      }

      // Claim a slot via the presence-claim callback. The slot is
      // chosen against the freshest content _writeWithRetry has, so
      // on a retry it re-reads and takes whatever slot is free. The
      // callback reports its chosen slot via self._claimedSlot.
      //
      // On the dead path, this claim makes us present BEFORE any
      // reset runs. A second joiner arriving one moment later sees
      // a live room (our line) and takes another slot. The reset
      // below then only touches log.txt, which is an idempotent
      // no-op on an already-empty file.
      const path   = DATA_ROOT + room + "/presence.txt";
      const myIso  = nowIso();
      const myName = this.username;
      const self   = this;

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
        // Should not happen: ok:true implies a slot was chosen.
        // Guard anyway so a silent failure cannot leave this.slot
        // unset.
        this._setStatus("Room is full.");
        return;
      }

      // We are now present in the room. Only on the dead path do we
      // reset log.txt. The reset NEVER touches presence.txt, because
      // our own presence line is our claim.
      if (roomIsDead) {
        try {
          await this._serialize(() =>
            this._writeWithRetry(
              DATA_ROOT + room + "/log.txt",
              (cur) => (cur === "" ? null : ""),
              "reset " + room + " log"
            )
          );
        } catch (e) {
          if (e.message === "BAD_SESSION") {
            this._handleApiError(e, "reset log");
            return;
          }
          // Best-effort. A second joiner's reset may have already
          // emptied it.
        }
      }

      this.room        = room;
      this.slot        = this._claimedSlot;
      this.messages    = [];
      this.users       = [];
      this._lastLogSha = null;

      this.roomTitleLabel.text = ROOM_LABELS[room];
      this.inputText = "";
      this._refreshChatInput();

      this._pushScreen("chat");
      this._clearStatus();

      this._startCycle();

      // Kick an immediate cycle so a joiner sees the messages that
      // were already on disk (as long as the room was not reset)
      // without waiting up to PRESTAGGER_MAX_MS.
      this._kickCycle();
    } finally {
      this._joining = false;
      if (pressedBtn) this._busyEnd(pressedBtn);
    }
  }

  // ---------- Leave ----------

  async _leaveRoom() {
    if (this._leaving) return;
    this._leaving = true;

    this._busyStart(this.leaveBtn);
    this._setStatus("Leaving...");

    try {
      await this._leaveRoomInternal();
      while (this.stack.length > 1 && this.stack[this.stack.length - 1] !== "room") {
        this.stack.pop();
      }
      this._applyScreen("room");
      this._refreshRoomOccupancy();
    } finally {
      this._leaving = false;
      this._busyEnd(this.leaveBtn);
    }
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

  // Cancel the pending cycle timer and run a cycle immediately.
  // Bounded cost: one extra cycle per call. Cannot loop.
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

      // Log read. Skip the blob read if the tree sha for the log has
      // not changed since last cycle. When the log HAS changed, the
      // message list is rebuilt from the file content in file order.
      // log.txt is the single source of truth for order.
      let logContent = null;
      const logEntry = ctx.entries.get(DATA_ROOT + this.room + "/log.txt");
      if (logEntry) {
        if (logEntry.sha !== this._lastLogSha) {
          logContent = await this._readBlob(logEntry.sha);
          this._lastLogSha = logEntry.sha;
        }
      } else {
        this._lastLogSha = null;
      }

      if (logContent !== null) {
        const lines = logContent
          ? logContent.split("\n").filter(l => l.length > 0)
          : [];

        const parsed = [];
        for (const line of lines) {
          const m = this._parseMessageLine(line);
          if (m) parsed.push(m);
        }

        this.messages = parsed;
        this._renderMessages();
      }

      // Presence read.
      const presPath  = DATA_ROOT + this.room + "/presence.txt";
      const presEntry = ctx.entries.get(presPath);
      let presContent = "";
      if (presEntry) {
        presContent = await this._readBlob(presEntry.sha);
      }
      const presEntries = this._parsePresence(presContent);

      this.users = [];
      for (let i = 0; i < SLOTS; i++) {
        const e = presEntries[i];
        if (e && isPresent(e.iso)) {
          this.users.push({ slot: i, username: e.username });
        }
      }

      this._renderUsers();

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

  // ---------- Message rendering ----------

  _parseMessageLine(line) {
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

  _renderMessages() {
    const n     = this.messages.length;
    const start = Math.max(0, n - this._maxLines);
    const slice = this.messages.slice(start);

    for (let i = 0; i < this.messageTexts.length; i++) {
      const t = this.messageTexts[i];
      const m = slice[i];
      if (!m) {
        t.text  = "";
        t.color = "#d8e4f7";
        continue;
      }
      t.text  = "[" + hhmm(m.iso) + "] " + m.username + ": " + m.text;
      t.color = (m.username === this.username) ? "#6aa9ff" : "#d8e4f7";
    }
  }

  _renderUsers() {
    if (this.mobile) {
      for (let s = 0; s < SLOTS; s++) {
        const t = this.userTexts[s];
        const u = this.users.find(x => x.slot === s);
        if (!u) {
          t.text = "";
          continue;
        }
        let name = u.username;
        if (name.length > 6) name = name.slice(0, 6);
        t.text  = s + "." + name;
        t.color = (u.username === this.username) ? "#6aa9ff" : "#e08080";
      }
      return;
    }

    for (let s = 0; s < SLOTS; s++) {
      const t = this.userTexts[s];
      const u = this.users.find(x => x.slot === s);
      if (!u) {
        t.text = "";
        continue;
      }
      const pad = String(s) + ".";
      t.text  = pad + " " + u.username;
      t.color = (u.username === this.username) ? "#6aa9ff" : "#e08080";
    }
  }

  // ---------- Send ----------

  async _sendMessage() {
    if (this.room === null || this.slot === null) return;
    if (this._sending) return;

    const text = this.inputText.trim();
    if (!text) return;

    const now = Date.now();
    if (now - this._lastSend < SEND_COOLDOWN) {
      const remain = Math.ceil((SEND_COOLDOWN - (now - this._lastSend)) / 1000);
      this._setStatus("Please wait " + remain + "s before sending again.");
      setTimeout(() => this._clearStatus(), 2000);
      return;
    }

    this._sending  = true;
    this._lastSend = now;
    this._setStatus("Sending...");
    this._busyStart(this.sendBtn);

    const safe = text.replace(/\|/g, "/").replace(/\n/g, " ").replace(/\r/g, " ");
    const iso  = nowIso();
    const line = this.username + "|" + iso + "|" + safe + "\n";

    const path = DATA_ROOT + this.room + "/log.txt";

    try {
      await this._serialize(() =>
        this._writeWithRetry(
          path,
          (currentContent) => currentContent + line,
          "chat from " + this.username
        )
      );

      // Our own write changed the log; invalidate the cached sha so
      // the next cycle re-reads it and rebuilds the message list
      // from disk order.
      this._lastLogSha = null;

      // Optimistic echo: show the sender's own line immediately.
      // The next cycle (kicked below) rebuilds the list from the
      // file, which corrects the order in the case of two near-
      // simultaneous senders.
      this.messages.push({ username: this.username, iso, text: safe });
      this._renderMessages();

      this.inputText = "";
      this._refreshChatInput();
      this._clearStatus();

      if (this.mobile && this._chatKeyboardVisible) {
        this._chatKeyboardVisible = false;
        this._applyChatKeyboardLayout();
      }

      // Kick a cycle so the disk order lands within a second or two
      // rather than waiting up to CYCLE_MS.
      this._kickCycle();
    } catch (e) {
      if (e.message === "BAD_SESSION") {
        this._handleApiError(e, "send");
        return;
      }
      this._setStatus("Send failed. Try again.");
      setTimeout(() => this._clearStatus(), 3000);
    } finally {
      this._sending = false;
      this._busyEnd(this.sendBtn);
    }
  }

  // ---------- Keyboard input ----------

  onEvent(e) {
    if (e.type !== "keydown") return;
    if (e.repeat) return;

    const top = this.stack[this.stack.length - 1];

    if (top === "username") { this._handleUsernameKey(e); return; }
    if (top === "chat")     { this._handleChatKey(e);     return; }
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
      this._sendMessage();
      return;
    }
    if (e.key.length === 1) {
      this.inputText += e.key;
      this._refreshChatInput();
    }
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
    if (top !== "username" && top !== "chat" && top !== "room") return;

    this._cursorTimer += dt * 1000;
    if (this._cursorTimer >= CURSOR_MS) {
      this._cursorTimer -= CURSOR_MS;
      this._cursorOn = !this._cursorOn;

      if (top === "username") this._refreshUsernameField();
      if (top === "chat")     this._refreshChatInput();
    }

    if (top === "chat") {
      this._refreshCountdown();
    }

    if (top === "room") {
      this._refreshRoomListCountdown();
    }
  }
}