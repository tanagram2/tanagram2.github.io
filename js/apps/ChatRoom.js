// ChatRoom.
//
// A client-managed chatroom with no server. Coordination happens
// through files in a GitHub repository, via the Git Data API
// (blobs, trees, commits, refs), not the Contents API.
//
// Why Git Data and not Contents:
//
// The Contents API (GET/PUT /repos/.../contents/PATH) is served from
// a cache that is not invalidated promptly after a write. A read
// right after a write can return the pre-write version for long
// enough to break a compare-and-swap. The Git Data API reads the
// ref and git object database directly.
//
// The ref PATCH is the compare-and-swap. If our PATCH fails, we
// check whether our commit actually landed (the ref may already
// point at it). If it did, the write succeeded and we do NOT retry.
// If it did not, someone else advanced the branch and we rebuild.
//
// All git traffic on this client goes through one serialized chain
// (_serialize). This prevents the heartbeat and the sync from
// racing each other.
//
// Tree writes use ONE POST with the full nested path. The tree
// endpoint resolves intermediate directories when base_tree is
// supplied. Do NOT hand-roll the directory chain - the previous
// version wrapped the top-level dir twice and wrote files to
// data/data/roomN/... which made every room look empty.
//
// Presence model: one file per slot, data/roomN/presence/slotM.txt.
// A slot is "occupied" if its content is non-empty and its
// timestamp is within OCCUPIED_MS (2 * STALE_MS, so a single late
// heartbeat does not make a live client look gone). "Fresh" is the
// stricter STALE_MS used for display. A room is "dead" if no slot
// is occupied.
//
// Dead-room detection is two-phase: read presence, and if no slot
// is occupied, wait 1s and read again. Only if the second read also
// shows no occupied slot do we reset.
//
// Reset wipes the log and all presence files, then claims slot 0.
//
// Heartbeat self-heal: if the heartbeat finds its own slot empty
// (not occupied by someone else), it re-claims rather than leaving.
// Eviction only fires when the slot holds ANOTHER client's content.
//
// Screens (all one canvas, toggled via visible):
//   1. Username   - enters display name (not unique).
//   2. Room list  - three rooms, occupancy shown as "?".
//   3. Chat       - log + user list + input + Send + Update + Leave.
//
// The session value used for Authorization is read from
// localStorage at init. If it is missing or wrong, the network
// error paths below surface it. There is no in-app entry screen
// for it.
//
// Desktop layout: wide box, chat log on the left and user list as a
// right-hand column. Mobile layout: user list becomes a slim
// horizontal strip at the top of the chat box, log below, input row
// at the bottom. The chat box on mobile is deliberately shorter than
// the screen so the on-canvas keyboard has a reserved strip below
// it. The box height is fixed and does not change when the keyboard
// toggles.

import { App }       from "./App.js";
import { Rect }      from "../primitives/Rect.js";
import { Text }      from "../primitives/Text.js";
import { Panel }     from "../composites/Panel.js";
import { Button }    from "../composites/Button.js";
import { Label }     from "../composites/Label.js";
import { Keyboard }  from "../composites/Keyboard.js";
import { Viewport }  from "../systems/Viewport.js";

// -----------------------------------------------------------------
// Repo config
// -----------------------------------------------------------------

const OWNER  = "tanagram2";
const REPO   = "tanagram2.github.io";
const BRANCH = "main";

// -----------------------------------------------------------------
// Tunables
// -----------------------------------------------------------------

const ROOMS = ["room1", "room2", "room3"];
const ROOM_LABELS = { room1: "Room1", room2: "Room2", room3: "Room3" };
const SLOTS = 10;

const STALE_MS         = 2 * 60 * 1000;  // 2 min: heartbeat freshness for display
const OCCUPIED_MS      = 4 * 60 * 1000;  // 4 min: join-time "is someone here"
const HEARTBEAT_MS     = 30 * 1000;      // every 30s
const SYNC_MS          = 60 * 1000;      // periodic sync
const UPDATE_THROTTLE  = 10 * 1000;      // manual Update cooldown
const SEND_COOLDOWN    = 15 * 1000;      // min gap between sends
const PUT_MAX_RETRIES  = 6;              // retries for a conflicted write
const PUT_BACKOFF_MS   = 250;            // random 0..250 ms between retries
const DEAD_CONFIRM_MS  = 1000;           // wait between the two dead-room reads

const CURSOR_MS        = 500;            // blink half-period

const SESSION_KEY = "canvasos.session.id";

const API = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/";

// -----------------------------------------------------------------
// base64 helpers - the browser's btoa/atob mishandle non-ASCII
// -----------------------------------------------------------------

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

// -----------------------------------------------------------------
// small utils
// -----------------------------------------------------------------

function randomId() {
  let s = "";
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s + "-" + Date.now().toString(36);
}

function nowIso() {
  return new Date().toISOString();
}

function isFresh(isoStr) {
  if (!isoStr) return false;
  const t = Date.parse(isoStr);
  if (Number.isNaN(t)) return false;
  return (Date.now() - t) < STALE_MS;
}

function isOccupied(isoStr) {
  if (!isoStr) return false;
  const t = Date.parse(isoStr);
  if (Number.isNaN(t)) return false;
  return (Date.now() - t) < OCCUPIED_MS;
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

    this.clientId = randomId();

    this.room     = null;
    this.slot     = null;

    this.messages    = [];
    this.seenKeys    = new Set();
    this.users       = [];

    this._syncTimer       = null;
    this._heartbeatTimer  = null;
    this._lastHeartbeatAt = 0;

    this._lastUpdate = 0;
    this._lastSend   = 0;

    // In-flight guards. Prevents a double-tap on Send or Update from
    // firing two overlapping operations. Cleared in finally blocks.
    this._sending  = false;
    this._updating = false;

    this._cursorOn    = true;
    this._cursorTimer = 0;

    this._usernameBuffer = "";
    this.inputText       = "";

    // Mobile chat-screen keyboard visibility.
    this._chatKeyboardVisible = false;

    this._joining = false;

    this._treeCache = null;

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
  }

  // ---------- Session persistence ----------

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

  // ---------- Field rendering ----------

  _renderField(label, buffer) {
    if (!label) return;
    label.setText(buffer + (this._cursorOn ? "|" : " "));
  }

  _refreshUsernameField() { this._renderField(this.usernameFieldLabel, this._usernameBuffer); }
  _refreshChatInput()     { this._renderField(this.inputLabel,         this.inputText); }

  // ---------- Screens ----------

  _buildUsernameScreen() {
    const W = Viewport.width;
    const H = Viewport.height;

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
      // Keyboard always visible on mobile. Enter button sits below.
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

      const kbH   = this.usernameKeyboard.h;
      const btnW  = kbW;
      const btnH  = 72;
      const btnX  = kbX;
      const btnY  = kbY + kbH + 20;

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

  _buildChatScreen() {
    const W = Viewport.width;
    const H = Viewport.height;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#101820",
      stroke: null,
    });

    // Top bar: Leave on the left, Update on the right.
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

    screen.add(new Button({
      x: W - 164, y: 24, w: 140, h: 48,
      text: "Update",
      fill: "#2a3552",
      stroke: "#6a86b8",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._manualUpdate(),
    }));

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

    this.statusLabel = new Text({
      x: 24,
      y: this.mobile ? 100 : 84,
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

    const userColW = 220;
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

    box.add(new Button({
      x: sendX, y: sendY, w: sendW, h: inputRowH - 16,
      text: "Send",
      fill: "#2a4a2a",
      stroke: "#6a9a6a",
      strokeWidth: 2,
      radius: 6,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._sendMessage(),
    }));

    this.chatKeyboard = null;
    this.chatTypeToggle = null;
  }

  _buildChatScreenMobile(screen) {
    const W = Viewport.width;
    const H = Viewport.height;

    // The chat box top stays fixed. The chat box bottom is raised
    // so that a full on-canvas keyboard fits below it, fully
    // on-screen. The box height does NOT change when the keyboard is
    // toggled: the strip below the box is always reserved.
    //
    // Order of computation:
    //   1. Build the keyboard first so we know its height.
    //   2. Reserve space below the box equal to keyboard height plus
    //      a top gap (between box and keyboard) and a bottom margin.
    //   3. Size the box to what remains.
    const boxX = 20;
    const boxY = 130;
    const boxW = W - 40;

    const kbMargin = 40;
    const kbW      = W - kbMargin * 2;
    const kbX      = kbMargin;

    // Build the keyboard unpositioned so we can read its .h. Its y
    // is set below, once we know the box height.
    this.chatKeyboard = new Keyboard({
      x: kbX, y: 0,
      w: kbW,
      onKey: (char) => this._handleChatKey({ key: char, length: 1 }),
    });
    const kbH = this.chatKeyboard.h;

    const gapAboveKb = 16;
    const kbBottomMargin = 20;

    const boxH = H - boxY - kbH - gapAboveKb - kbBottomMargin;

    const userStripH = 44;
    const inputRowH  = 80;

    const logH = boxH - userStripH - inputRowH;

    this._mBoxX         = boxX;
    this._mBoxY         = boxY;
    this._mBoxW         = boxW;
    this._mBoxH         = boxH;
    this._mUserStripH   = userStripH;
    this._mInputRowH    = inputRowH;
    this._mKbX          = kbX;
    this._mKbW          = kbW;
    this._mLogH         = logH;

    const box = new Panel({
      x: boxX, y: boxY, w: boxW, h: boxH,
      fill: "#0c121a",
      stroke: "#3a4d70",
      strokeWidth: 2,
      radius: 8,
    });
    screen.add(box);
    this._mBox = box;

    // Separator under the user strip.
    box.add(new Rect({
      x: 0, y: userStripH - 1,
      w: boxW, h: 2,
      fill: "#2a3552",
      stroke: null,
    }));

    // Separator above the input row.
    box.add(new Rect({
      x: 0, y: boxH - inputRowH - 1,
      w: boxW, h: 2,
      fill: "#2a3552",
      stroke: null,
    }));

    // User strip: one Text per slot, laid out horizontally.
    this.userTexts = [];
    const slotFont = "14px monospace";
    for (let s = 0; s < SLOTS; s++) {
      const t = new Text({
        x: 10 + s * 68,
        y: userStripH / 2,
        text: "",
        font: slotFont,
        color: "#7a8a9a",
        align: "left",
        baseline: "middle",
      });
      box.add(t);
      this.userTexts.push(t);
    }

    // Log area. Text nodes are positioned relative to the box, with
    // the strip offset baked in via y.
    const logTop = userStripH + 8;
    const lineH  = 20;
    const linesFit = Math.max(1, Math.floor((logH - 16) / lineH));

    this._maxLines     = linesFit;
    this._mLogTop      = logTop;
    this._mLineH       = lineH;

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

    // Input row: input panel on the left, Type and Send buttons on
    // the right.
    const inputY = boxH - inputRowH + 10;
    const inputH = inputRowH - 20;

    const btnW = 90;
    const btnGap = 8;
    const sendX = boxW - 12 - btnW;
    const typeX = sendX - btnGap - btnW;

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

    box.add(new Button({
      x: sendX, y: inputY,
      w: btnW, h: inputH,
      text: "Send",
      fill: "#2a4a2a",
      stroke: "#6a9a6a",
      strokeWidth: 2,
      radius: 6,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._sendMessage(),
    }));

    // The keyboard lives in the reserved strip below the box.
    const kbY = boxY + boxH + gapAboveKb;
    this.chatKeyboard.x = kbX;
    this.chatKeyboard.y = kbY;
    this.chatKeyboard.visible = false;
    screen.add(this.chatKeyboard);

    this._mKbY = kbY;
  }

  // Show or hide the on-canvas keyboard on the mobile chat screen.
  // The box does not move: the strip below the box is always
  // reserved. Toggling the keyboard only changes its own visibility.
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
      this._stopTimers();
      this._chatKeyboardVisible = false;
      if (this.mobile && this.chatKeyboard) {
        this.chatKeyboard.visible = false;
      }
    }

    this._refreshUsernameField();
    this._refreshChatInput();

    if (name !== "room" && this.roomStatusLabel) {
      this.roomStatusLabel.text = "";
    }
  }

  _pushScreen(name) {
    this.stack.push(name);
    this._applyScreen(name);

    if (name === "room") this._refreshRoomOccupancyPlaceholders();
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

  _refreshRoomOccupancyPlaceholders() {
    for (const name of ROOMS) {
      this.roomButtons[name].setText(ROOM_LABELS[name] + "  ?/10");
    }
  }

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

  // ---------- Username submit ----------

  _submitUsername() {
    const name = this._usernameBuffer.trim();
    if (!name) {
      this.usernameErrorLabel.text = "Username required.";
      return;
    }
    this.usernameErrorLabel.text = "";
    this.username = name;
    this._pushScreen("room");
  }

  // =================================================================
  // GIT DATA API PRIMITIVES
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

  async _readRef() {
    const url = API + "git/ref/heads/" + encodeURIComponent(BRANCH);
    const res = await fetch(url, { headers: this._authHeaders(), cache: "no-store" });
    if (res.status === 401) throw new Error("BAD_SESSION");
    if (!res.ok) throw new Error("READ_REF_FAILED_" + res.status);
    const json = await res.json();
    return json.object.sha;
  }

  async _readCommitTreeSha(commitSha) {
    const url = API + "git/commits/" + commitSha;
    const res = await fetch(url, { headers: this._authHeaders(), cache: "no-store" });
    if (res.status === 401) throw new Error("BAD_SESSION");
    if (!res.ok) throw new Error("READ_COMMIT_FAILED_" + res.status);
    const json = await res.json();
    return json.tree.sha;
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

  async _refreshTreeCache() {
    const commitSha = await this._readRef();
    const treeSha   = await this._readCommitTreeSha(commitSha);
    const entries   = await this._readTreeEntries(treeSha);
    this._treeCache = { commitSha, treeSha, entries };
    return this._treeCache;
  }

  _clearTreeCache() {
    this._treeCache = null;
  }

  async _readFile(path) {
    if (!this._treeCache) {
      await this._refreshTreeCache();
    }
    const entry = this._treeCache.entries.get(path);
    if (!entry) return null;
    const content = await this._readBlob(entry.sha);
    return { content, sha: entry.sha, commitSha: this._treeCache.commitSha };
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
    const url = API + "git/trees";
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

  // Single POST. GitHub resolves intermediate directories from the
  // supplied full path when base_tree is present.
  async _createTreeWithChange(baseTreeSha, path, blobSha) {
    return await this._postTree([{
      path: path,
      mode: "100644",
      type: "blob",
      sha: blobSha,
    }], baseTreeSha);
  }

  async _createCommit(treeSha, parentCommitSha, message) {
    const url = API + "git/commits";
    const body = {
      message,
      tree: treeSha,
      parents: [parentCommitSha],
    };
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

  async _writeWithRetry(path, buildContent, message) {
    let lastError = null;

    for (let attempt = 0; attempt < PUT_MAX_RETRIES; attempt++) {
      let currentCommitSha;
      let treeSha;
      let entries;
      try {
        currentCommitSha = await this._readRef();
        treeSha          = await this._readCommitTreeSha(currentCommitSha);
        entries          = await this._readTreeEntries(treeSha);
      } catch (e) {
        if (e.message === "BAD_SESSION") throw e;
        lastError = e;
        await this._sleep(Math.random() * PUT_BACKOFF_MS);
        continue;
      }

      let currentContent = "";
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

      let toWrite;
      try {
        toWrite = buildContent(currentContent);
      } catch (e) {
        throw e;
      }
      if (toWrite === null) {
        return false;
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
        this._clearTreeCache();
        return true;
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
            this._clearTreeCache();
            return true;
          }
        } catch (e2) {
          if (e2.message === "BAD_SESSION") throw e2;
        }
        lastError = e;
        await this._sleep(Math.random() * PUT_BACKOFF_MS);
        continue;
      }

      this._clearTreeCache();
      return true;
    }

    throw lastError || new Error("WRITE_RETRIES_EXHAUSTED");
  }

  // =================================================================
  // END GIT DATA API PRIMITIVES
  // =================================================================

  // ---------- Presence helpers ----------

  async _readPresence(room) {
    return await this._serialize(async () => {
      this._clearTreeCache();
      await this._refreshTreeCache();

      const out = [];
      for (let s = 0; s < SLOTS; s++) {
        const path = "data/" + room + "/presence/slot" + s + ".txt";
        let rec = null;
        try {
          const entry = this._treeCache.entries.get(path);
          if (entry) {
            const content = await this._readBlob(entry.sha);
            if (content) {
              const parsed = this._parseSlot(content);
              if (parsed) rec = parsed;
            }
          }
        } catch (e) {
          if (e.message === "BAD_SESSION") throw e;
        }
        out.push(rec);
      }
      return out;
    });
  }

  _parseSlot(content) {
    const parts = content.split("\n");
    if (parts.length < 3) return null;
    const clientId = parts[0].trim();
    const username = parts[1].trim();
    const iso      = parts[2].trim();
    if (!clientId || !iso) return null;
    return { clientId, username, iso };
  }

  _serializeSlot(clientId, username, iso) {
    return clientId + "\n" + username + "\n" + iso + "\n";
  }

  // ---------- Room join ----------

  async _joinRoom(room) {
    if (this._joining) return;
    this._joining = true;

    this._setStatus("Joining " + ROOM_LABELS[room] + "...");

    try {
      let presence;
      try {
        presence = await this._readPresence(room);
      } catch (e) {
        this._handleApiError(e, "read presence");
        return;
      }

      let anyOccupied = presence.some(p => p && isOccupied(p.iso));

      if (!anyOccupied) {
        await this._sleep(DEAD_CONFIRM_MS);
        try {
          presence = await this._readPresence(room);
        } catch (e) {
          this._handleApiError(e, "read presence (confirm)");
          return;
        }
        anyOccupied = presence.some(p => p && isOccupied(p.iso));
      }

      if (!anyOccupied) {
        this._setStatus("Resetting dead room...");

        try {
          await this._writeWithRetry(
            "data/" + room + "/log.txt",
            (cur) => (cur === "" ? null : ""),
            "reset " + room + " log"
          );
        } catch (e) {
          if (e.message === "BAD_SESSION") {
            this._handleApiError(e, "reset log");
            return;
          }
        }

        for (let s = 0; s < SLOTS; s++) {
          if (!presence[s]) continue;
          try {
            await this._writeWithRetry(
              "data/" + room + "/presence/slot" + s + ".txt",
              (cur) => (cur === "" ? null : ""),
              "reset slot " + s
            );
          } catch (e) {
            if (e.message === "BAD_SESSION") {
              this._handleApiError(e, "reset presence");
              return;
            }
          }
        }

        this._clearTreeCache();

        try {
          presence = await this._readPresence(room);
        } catch (e) {
          this._handleApiError(e, "read presence after reset");
          return;
        }
      }

      const slot = await this._claimSlot(room, presence);
      if (slot === null) {
        this._setStatus("Room is full.");
        return;
      }

      this.room = room;
      this.slot = slot;
      this.messages = [];
      this.seenKeys = new Set();
      this.users = [];
      this._lastHeartbeatAt = 0;

      this.roomTitleLabel.text = ROOM_LABELS[room];
      this.inputText = "";
      this._refreshChatInput();

      this._pushScreen("chat");
      this._clearStatus();

      try {
        await this._sync();
      } catch (e) {
        this._handleApiError(e, "initial sync");
      }
      this._startTimers();
    } finally {
      this._joining = false;
    }
  }

  async _claimSlot(room, presence) {
    for (let s = 0; s < SLOTS; s++) {
      const cur = presence[s];
      if (cur && isOccupied(cur.iso) && cur.clientId !== this.clientId) {
        continue;
      }
      if (cur && cur.clientId === this.clientId && isOccupied(cur.iso)) {
        return s;
      }

      const path = "data/" + room + "/presence/slot" + s + ".txt";

      let wrote = false;
      try {
        wrote = await this._writeWithRetry(
          path,
          (currentContent) => {
            if (currentContent) {
              const parsed = this._parseSlot(currentContent);
              if (parsed && parsed.clientId !== this.clientId && isOccupied(parsed.iso)) {
                return null;
              }
            }
            return this._serializeSlot(this.clientId, this.username, nowIso());
          },
          "claim slot " + s
        );
      } catch (e) {
        if (e.message === "BAD_SESSION") throw e;
        continue;
      }

      if (wrote) return s;
    }
    return null;
  }

  // ---------- Leave ----------

  async _leaveRoom() {
    await this._leaveRoomInternal();
    while (this.stack.length > 1 && this.stack[this.stack.length - 1] !== "room") {
      this.stack.pop();
    }
    this._applyScreen("room");
  }

  async _leaveRoomInternal() {
    this._stopTimers();

    if (this.room !== null && this.slot !== null) {
      const room = this.room;
      const slot = this.slot;
      this.room = null;
      this.slot = null;

      const path = "data/" + room + "/presence/slot" + slot + ".txt";
      try {
        await this._writeWithRetry(
          path,
          (currentContent) => {
            if (!currentContent) return null;
            const parsed = this._parseSlot(currentContent);
            if (parsed && parsed.clientId !== this.clientId) {
              return null;
            }
            return "";
          },
          "leave slot " + slot
        );
      } catch (e) {
        // Best-effort.
      }
    }
  }

  // ---------- Timers ----------

  _startTimers() {
    this._stopTimers();

    this._heartbeatTimer = setInterval(() => {
      this._heartbeat().catch(() => {});
    }, HEARTBEAT_MS);

    this._syncTimer = setInterval(() => {
      this._sync().catch(() => {});
    }, SYNC_MS);
  }

  _stopTimers() {
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    if (this._syncTimer)      { clearInterval(this._syncTimer);      this._syncTimer = null; }
  }

  // ---------- Heartbeat ----------

  async _heartbeat() {
    if (this.room === null || this.slot === null) return;

    const now = Date.now();
    if (this._lastHeartbeatAt && (now - this._lastHeartbeatAt) < HEARTBEAT_MS * 0.75) {
      return;
    }

    const path = "data/" + this.room + "/presence/slot" + this.slot + ".txt";
    const self = this;

    let wrote = false;
    try {
      wrote = await this._serialize(() =>
        this._writeWithRetry(
          path,
          (currentContent) => {
            if (!currentContent) {
              return self._serializeSlot(self.clientId, self.username, nowIso());
            }
            const parsed = self._parseSlot(currentContent);
            if (!parsed) {
              return self._serializeSlot(self.clientId, self.username, nowIso());
            }
            if (parsed.clientId !== self.clientId) {
              return null;
            }
            return self._serializeSlot(self.clientId, self.username, nowIso());
          },
          "heartbeat slot " + this.slot
        )
      );
    } catch (e) {
      if (e.message === "BAD_SESSION") {
        this._handleApiError(e, "heartbeat");
        return;
      }
      return;
    }

    if (wrote) {
      this._lastHeartbeatAt = now;
    } else {
      this._setStatus("Your slot was taken. Leaving...");
      await this._leaveRoom();
    }
  }

  // ---------- Sync ----------

  async _manualUpdate() {
    if (this._updating) return;

    const now = Date.now();
    if (now - this._lastUpdate < UPDATE_THROTTLE) {
      const remain = Math.ceil((UPDATE_THROTTLE - (now - this._lastUpdate)) / 1000);
      this._setStatus("Please wait " + remain + "s before updating again.");
      setTimeout(() => this._clearStatus(), 2000);
      return;
    }

    this._updating = true;
    this._lastUpdate = now;
    this._setStatus("Updating...");

    try {
      await this._sync();
      this._clearStatus();
    } catch (e) {
      this._handleApiError(e, "update");
    } finally {
      this._updating = false;
    }
  }

  async _sync() {
    if (this.room === null) return;

    return await this._serialize(async () => {
      this._clearTreeCache();
      await this._refreshTreeCache();

      let logContent = "";
      const logEntry = this._treeCache.entries.get("data/" + this.room + "/log.txt");
      if (logEntry) {
        try {
          logContent = await this._readBlob(logEntry.sha);
        } catch (e) {
          if (e.message === "BAD_SESSION") { this._handleApiError(e, "sync log"); return; }
          throw e;
        }
      }

      const lines = logContent
        ? logContent.split("\n").filter(l => l.length > 0)
        : [];

      for (const line of lines) {
        const parsed = this._parseMessageLine(line);
        if (!parsed) continue;
        const key = parsed.username + "|" + parsed.iso + "|" + parsed.text;
        if (this.seenKeys.has(key)) continue;
        this.seenKeys.add(key);
        this.messages.push(parsed);
      }

      const presence = [];
      for (let s = 0; s < SLOTS; s++) {
        const path = "data/" + this.room + "/presence/slot" + s + ".txt";
        const entry = this._treeCache.entries.get(path);
        let rec = null;
        if (entry) {
          try {
            const content = await this._readBlob(entry.sha);
            if (content) {
              const parsed = this._parseSlot(content);
              if (parsed) rec = parsed;
            }
          } catch (e) {
            if (e.message === "BAD_SESSION") { this._handleApiError(e, "sync presence"); return; }
          }
        }
        presence.push(rec);
      }

      this.users = [];
      let selfListed = false;
      for (let s = 0; s < SLOTS; s++) {
        const p = presence[s];
        if (p && isFresh(p.iso)) {
          this.users.push({ slot: s, username: p.username, clientId: p.clientId });
          if (p.clientId === this.clientId) selfListed = true;
        }
      }
      if (!selfListed && this.slot !== null) {
        this.users.push({ slot: this.slot, username: this.username, clientId: this.clientId });
        this.users.sort((a, b) => a.slot - b.slot);
      }

      this._renderMessages();
      this._renderUsers();
    });
  }

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
    const n = this.messages.length;
    const start = Math.max(0, n - this._maxLines);
    const slice = this.messages.slice(start);

    for (let i = 0; i < this.messageTexts.length; i++) {
      const t = this.messageTexts[i];
      const m = slice[i];
      if (!m) {
        t.text = "";
        t.color = "#d8e4f7";
        continue;
      }
      t.text = "[" + hhmm(m.iso) + "] " + m.username + ": " + m.text;
      t.color = (m.username === this.username) ? "#6aa9ff" : "#d8e4f7";
    }
  }

  _renderUsers() {
    if (this.mobile) {
      // Slot prefix plus username, clipped to fit the strip.
      for (let s = 0; s < SLOTS; s++) {
        const t = this.userTexts[s];
        const u = this.users.find(x => x.slot === s);
        if (!u) {
          t.text = "";
          continue;
        }
        let name = u.username;
        if (name.length > 6) name = name.slice(0, 6);
        t.text = s + "." + name;
        t.color = (u.clientId === this.clientId) ? "#6aa9ff" : "#e08080";
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
      t.text = pad + " " + u.username;
      t.color = (u.clientId === this.clientId) ? "#6aa9ff" : "#e08080";
    }
  }

  // ---------- Send ----------

  async _sendMessage() {
    if (this.room === null || this.slot === null) return;

    // In-flight guard: a second Send tap while the first is still
    // talking to GitHub is dropped on the floor. This is what keeps
    // a double-tap from firing two overlapping writes.
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

    this._sending = true;
    // Stamp on commitment, not on success. The cooldown is measured
    // from "user tried to send", which is what a user actually
    // perceives. A failed write burning a cooldown slot is rare
    // enough that this is the right trade.
    this._lastSend = now;

    const safe = text.replace(/\|/g, "/").replace(/\n/g, " ").replace(/\r/g, " ");
    const iso  = nowIso();
    const line = this.username + "|" + iso + "|" + safe + "\n";

    const path = "data/" + this.room + "/log.txt";

    try {
      await this._serialize(() =>
        this._writeWithRetry(
          path,
          (currentContent) => currentContent + line,
          "chat from " + this.username
        )
      );

      const key = this.username + "|" + iso + "|" + safe;
      if (!this.seenKeys.has(key)) {
        this.seenKeys.add(key);
        this.messages.push({ username: this.username, iso, text: safe });
        this._renderMessages();
      }

      this.inputText = "";
      this._refreshChatInput();
      this._clearStatus();

      // On mobile, hide the keyboard after a send so the log is
      // visible again.
      if (this.mobile && this._chatKeyboardVisible) {
        this._chatKeyboardVisible = false;
        this._applyChatKeyboardLayout();
      }

      try {
        await this._sync();
      } catch (e) {
        // Non-fatal.
      }
    } catch (e) {
      if (e.message === "BAD_SESSION") {
        this._handleApiError(e, "send");
        return;
      }
      this._setStatus("Send failed. Try again.");
      setTimeout(() => this._clearStatus(), 3000);
    } finally {
      this._sending = false;
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
      this._stopTimers();
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
    if (top !== "username" && top !== "chat") return;

    this._cursorTimer += dt * 1000;
    if (this._cursorTimer >= CURSOR_MS) {
      this._cursorTimer -= CURSOR_MS;
      this._cursorOn = !this._cursorOn;

      if (top === "username") this._refreshUsernameField();
      if (top === "chat")     this._refreshChatInput();
    }
  }
}