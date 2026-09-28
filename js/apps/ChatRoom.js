// ChatRoom.
//
// A client-managed chatroom with no server. Coordination happens
// through files in a GitHub repository, read and written via the
// GitHub Contents API. Every client holds a Personal Access Token
// in localStorage; the token is only ever sent to api.github.com,
// never committed anywhere.
//
// Concurrency model: the Contents API's required "sha" field acts
// as compare-and-swap. A write must include the sha of the version
// it read; if someone else wrote in between, the write fails with
// 409 and we re-read, re-apply our change, and retry.
//
// Read-after-write is NOT reliable. The Contents API GET is served
// from a cache and can return the pre-write version for several
// seconds after a PUT succeeds. So:
//   - We never confirm a write by reading the file back.
//   - We trust the PUT response. If it returned 2xx, the write
//     landed, full stop.
//   - The only reads we make are for data we did not just write.
//     Those reads are, in practice, not stale, because the last
//     write to that file happened at least seconds ago.
//   - Local state is updated optimistically after our own writes,
//     so our own message shows up immediately even if a followup
//     sync reads stale content.
//
// _writeWithRetry returns true if it wrote, false if it declined
// (buildContent returned null, meaning "the current content is
// already what it should be, do not touch"). Callers use that
// return value to decide whether their intent was realized,
// without needing a confirm read.
//
// Presence model: one file per slot, data/roomN/presence/slotM.txt.
// Each slot is written by exactly one client at a time. A slot is
// "occupied" if its heartbeat is within STALE_MS. A room is "dead"
// if every slot is empty or stale.
//
// Room reset: the first client to join a dead room wipes the log
// and all ten presence files, then claims slot 0.
//
// Screens (all one canvas, toggled via visible):
//   1. Token      - enters PAT, stored in localStorage.
//   2. Username   - enters display name (not unique).
//   3. Room list  - three rooms, occupancy shown as "?".
//   4. Chat       - log + user list + input + Send + Update + Leave.

import { App }       from "./App.js";
import { Rect }      from "../primitives/Rect.js";
import { Text }      from "../primitives/Text.js";
import { Panel }     from "../composites/Panel.js";
import { Button }    from "../composites/Button.js";
import { Label }     from "../composites/Label.js";
import { Viewport }  from "../systems/Viewport.js";

// -----------------------------------------------------------------
// FILL THESE IN
// -----------------------------------------------------------------

const OWNER  = "YOUR_GITHUB_USERNAME";
const REPO   = "YOUR_REPO_NAME";
const BRANCH = "main";

// -----------------------------------------------------------------
// Tunables
// -----------------------------------------------------------------

const ROOMS = ["room1", "room2", "room3"];
const ROOM_LABELS = { room1: "Room1", room2: "Room2", room3: "Room3" };
const SLOTS = 10;

const STALE_MS         = 2 * 60 * 1000;  // 2 minutes: room is dead if older
const HEARTBEAT_MS     = 60 * 1000;      // every 60s, always
const SYNC_MS          = 60 * 1000;      // periodic sync
const UPDATE_THROTTLE  = 10 * 1000;      // manual Update cooldown
const SEND_COOLDOWN    = 30 * 1000;      // min gap between sends
const PUT_MAX_RETRIES  = 6;              // retries for a conflicted write
const PUT_BACKOFF_MS   = 250;            // random 0..250 ms between retries
const RESET_SETTLE_MS  = 800;            // pause after wipe before re-reading

const CURSOR_MS        = 500;            // blink half-period

const API = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/";

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
    this.token    = this._loadToken();
    this.username = "";

    this.clientId = randomId();

    this.room     = null;
    this.slot     = null;

    this.messages    = [];
    this.seenKeys    = new Set();
    this.users       = [];

    this._syncTimer      = null;
    this._heartbeatTimer = null;

    this._lastUpdate = 0;
    this._lastSend   = 0;

    this._cursorOn    = true;
    this._cursorTimer = 0;

    this._tokenBuffer    = "";
    this._usernameBuffer = "";
    this.inputText       = "";

    this.stack = ["token"];

    this.tokenScreen    = this._buildTokenScreen();
    this.usernameScreen = this._buildUsernameScreen();
    this.roomScreen     = this._buildRoomScreen();
    this.chatScreen     = this._buildChatScreen();

    this.root.add(this.tokenScreen);
    this.root.add(this.usernameScreen);
    this.root.add(this.roomScreen);
    this.root.add(this.chatScreen);

    this._applyScreen("token");
    this._refreshTokenField();
    this._refreshUsernameField();
    this._refreshChatInput();
  }

  // ---------- Token persistence ----------

  _loadToken() {
    try {
      return localStorage.getItem("canvasos.chatroom.token") || "";
    } catch (e) {
      return "";
    }
  }

  _saveToken(tok) {
    this.token = tok;
    try {
      if (tok) localStorage.setItem("canvasos.chatroom.token", tok);
      else     localStorage.removeItem("canvasos.chatroom.token");
    } catch (e) {
      // localStorage may be unavailable.
    }
  }

  // ---------- Field rendering ----------

  _renderField(label, buffer) {
    if (!label) return;
    label.setText(buffer + (this._cursorOn ? "|" : " "));
  }

  _refreshTokenField()    { this._renderField(this.tokenFieldLabel,    this._tokenBuffer); }
  _refreshUsernameField() { this._renderField(this.usernameFieldLabel, this._usernameBuffer); }
  _refreshChatInput()     { this._renderField(this.inputLabel,         this.inputText); }

  // ---------- Screens ----------

  _buildTokenScreen() {
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

    screen.add(new Text({
      x: cx, y: 180,
      text: "Enter Token:",
      font: "bold 36px sans-serif",
      color: "#d8e4f7",
      align: "center",
      baseline: "middle",
    }));

    const fieldW = 720;
    const fieldH = 56;
    const fieldX = cx - fieldW / 2;
    const fieldY = 240;

    const field = new Panel({
      x: fieldX, y: fieldY, w: fieldW, h: fieldH,
      fill: "#0a1018",
      stroke: "#3a4d70",
      strokeWidth: 2,
      radius: 6,
    });
    screen.add(field);

    this.tokenFieldLabel = new Label({
      x: 0, y: 0, w: "100%", h: "100%",
      text: "",
      textOptions: {
        font: "18px monospace",
        color: "#d8e4f7",
        align: "left",
        baseline: "middle",
      },
    });
    this.tokenFieldLabel.text.x = 14;
    this.tokenFieldLabel.text.y = "50%";
    field.add(this.tokenFieldLabel);

    this.tokenErrorLabel = new Text({
      x: cx, y: fieldY + fieldH + 24,
      text: "",
      font: "16px monospace",
      color: "#e06060",
      align: "center",
      baseline: "middle",
    });
    screen.add(this.tokenErrorLabel);

    screen.add(new Button({
      x: fieldX, y: fieldY + fieldH + 44,
      w: 140, h: 44,
      text: "Paste",
      fill: "#2a2a3a",
      stroke: "#5a5a7a",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 16px sans-serif", color: "#ffffff" },
      onClick: () => this._pasteIntoToken(),
    }));

    screen.add(new Button({
      x: cx - 110, y: fieldY + fieldH + 100,
      w: 220, h: 56,
      text: "Continue",
      fill: "#2a3552",
      stroke: "#6a86b8",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
      onClick: () => this._submitToken(),
    }));

    return screen;
  }

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
      onClick: () => this._goBack(),
    }));

    const cx = W / 2;

    screen.add(new Text({
      x: cx, y: 200,
      text: "Username:",
      font: "bold 36px sans-serif",
      color: "#d8e4f7",
      align: "center",
      baseline: "middle",
    }));

    const fieldW = 720;
    const fieldH = 56;
    const fieldX = cx - fieldW / 2;
    const fieldY = 260;

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
        font: "18px monospace",
        color: "#d8e4f7",
        align: "left",
        baseline: "middle",
      },
    });
    this.usernameFieldLabel.text.x = 14;
    this.usernameFieldLabel.text.y = "50%";
    field.add(this.usernameFieldLabel);

    this.usernameErrorLabel = new Text({
      x: cx, y: fieldY + fieldH + 28,
      text: "",
      font: "16px monospace",
      color: "#e06060",
      align: "center",
      baseline: "middle",
    });
    screen.add(this.usernameErrorLabel);

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
      x: cx, y: 160,
      text: "Select a Room:",
      font: "bold 36px sans-serif",
      color: "#d8e4f7",
      align: "center",
      baseline: "middle",
    }));

    const btnW = 480;
    const btnH = 72;
    const gap  = 20;
    let   y    = 260;

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
        textOptions: { font: "bold 22px sans-serif", color: "#d8e4f7" },
        onClick: () => this._joinRoom(roomName),
      });
      screen.add(btn);
      this.roomButtons[roomName] = btn;
      y += btnH + gap;
    }

    // Status text visible on the room screen too, so join failures
    // are not silent.
    this.roomStatusLabel = new Text({
      x: cx, y: 520,
      text: "",
      font: "16px monospace",
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

    const boxW = Math.min(W - 120, 1100);
    const boxH = Math.min(H - 180, 620);
    const boxX = (W - boxW) / 2;
    const boxY = 110;

    const userColW = 220;
    const inputRowH = 64;

    this._boxX = boxX; this._boxY = boxY;
    this._boxW = boxW; this._boxH = boxH;
    this._userColW = userColW;
    this._inputRowH = inputRowH;

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

    this._maxLines = Math.floor((boxH - inputRowH - 20) / 22);

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

    this.statusLabel = new Text({
      x: boxX,
      y: boxY - 26,
      text: "",
      font: "14px monospace",
      color: "#8fa9d0",
      align: "left",
      baseline: "middle",
    });
    screen.add(this.statusLabel);

    this.roomTitleLabel = new Text({
      x: boxX + boxW / 2,
      y: boxY - 26,
      text: "",
      font: "bold 20px sans-serif",
      color: "#d8e4f7",
      align: "center",
      baseline: "middle",
    });
    screen.add(this.roomTitleLabel);

    return screen;
  }

  // ---------- Screen navigation ----------

  _applyScreen(name) {
    this.tokenScreen.visible    = name === "token";
    this.usernameScreen.visible = name === "username";
    this.roomScreen.visible     = name === "room";
    this.chatScreen.visible     = name === "chat";

    this._cursorOn    = true;
    this._cursorTimer = 0;

    if (name !== "chat") {
      this._stopTimers();
    }

    this._refreshTokenField();
    this._refreshUsernameField();
    this._refreshChatInput();

    // Clear the room-screen status whenever we leave the room
    // screen, so stale messages do not linger into a fresh visit.
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

  // Two status channels: the chat screen has statusLabel, the room
  // screen has roomStatusLabel. _setStatus writes whichever is
  // visible on the current screen so join failures are never silent.
  _setStatus(msg) {
    const top = this.stack[this.stack.length - 1];
    const text = msg || "";
    if (top === "chat" && this.statusLabel) {
      this.statusLabel.text = text;
    } else if (top === "room" && this.roomStatusLabel) {
      this.roomStatusLabel.text = text;
    } else if (this.roomStatusLabel) {
      // Default to the room screen status when neither is focused,
      // so the message is still somewhere the user can see it.
      this.roomStatusLabel.text = text;
    }
  }

  _clearStatus() {
    this._setStatus("");
  }

  // ---------- Token submit / paste ----------

  _submitToken() {
    const tok = this._tokenBuffer.trim();
    if (!tok) {
      this.tokenErrorLabel.text = "Token required.";
      return;
    }
    this.tokenErrorLabel.text = "";
    this._saveToken(tok);
    this._pushScreen("username");
  }

  async _pasteIntoToken() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      this.tokenErrorLabel.text = "Paste not available in this browser.";
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        this._tokenBuffer = text.trim();
        this._refreshTokenField();
        this.tokenErrorLabel.text = "";
      }
    } catch (e) {
      this.tokenErrorLabel.text = "Paste was blocked. Type it manually or allow clipboard access.";
    }
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

  // ---------- GitHub API primitives ----------

  _authHeaders() {
    return {
      "Authorization": "Bearer " + this.token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  // Raw read. Returns { content, sha } or null on 404. Throws
  // BAD_TOKEN on 401, READ_FAILED_<n> on anything else.
  //
  // cache: "no-store" tells the browser not to serve from its own
  // cache. This does not affect GitHub's server-side cache, which
  // is what actually causes stale reads. See the file header.
  async _readFile(path) {
    const url = API + path + "?ref=" + encodeURIComponent(BRANCH);
    const res = await fetch(url, {
      headers: this._authHeaders(),
      cache: "no-store",
    });

    if (res.status === 404) return null;
    if (res.status === 401) throw new Error("BAD_TOKEN");
    if (!res.ok) throw new Error("READ_FAILED_" + res.status);

    const json = await res.json();
    const content = json.content ? fromBase64(json.content) : "";
    return { content, sha: json.sha };
  }

  // Raw single-shot write with the given sha. Throws CONFLICT on
  // 409 or 422. Returns the new content sha on success.
  async _putOnce(path, content, sha, message) {
    const url = API + path;
    const body = {
      message: message || ("update " + path),
      content: toBase64(content),
      branch: BRANCH,
    };
    if (sha) body.sha = sha;

    const res = await fetch(url, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, this._authHeaders()),
      body: JSON.stringify(body),
    });

    if (res.status === 401) throw new Error("BAD_TOKEN");
    if (res.status === 409) throw new Error("CONFLICT");
    if (res.status === 422) throw new Error("CONFLICT");
    if (!res.ok) throw new Error("WRITE_FAILED_" + res.status);

    const json = await res.json();
    return json.content ? json.content.sha : null;
  }

  // Read-modify-write with retries on conflict.
  //
  // buildContent(currentContentString) returns the string to write,
  // or null to skip the write ("current content is already correct").
  //
  // Returns true if a write happened, false if buildContent declined
  // to write. Callers use this to know whether their intent landed,
  // without needing a confirm read (which cannot be trusted).
  async _writeWithRetry(path, buildContent, message) {
    let lastError = null;

    for (let attempt = 0; attempt < PUT_MAX_RETRIES; attempt++) {
      let current = null;
      try {
        current = await this._readFile(path);
      } catch (e) {
        if (e.message === "BAD_TOKEN") throw e;
        current = null;
      }

      const currentContent = current ? current.content : "";
      const sha = current ? current.sha : null;

      let toWrite = buildContent(currentContent);

      if (toWrite === null) {
        return false;
      }

      try {
        await this._putOnce(path, toWrite, sha, message);
        return true;
      } catch (e) {
        if (e.message === "BAD_TOKEN") throw e;
        if (e.message === "CONFLICT") {
          lastError = e;
          await this._sleep(Math.random() * PUT_BACKOFF_MS);
          continue;
        }
        throw e;
      }
    }

    throw lastError || new Error("WRITE_RETRIES_EXHAUSTED");
  }

  // ---------- Presence helpers ----------

  async _readPresence(room) {
    const out = [];
    for (let s = 0; s < SLOTS; s++) {
      const path = "data/" + room + "/presence/slot" + s + ".txt";
      let rec = null;
      try {
        const r = await this._readFile(path);
        if (r && r.content) {
          const parsed = this._parseSlot(r.content);
          if (parsed) rec = parsed;
        }
      } catch (e) {
        if (e.message === "BAD_TOKEN") throw e;
      }
      out.push(rec);
    }
    return out;
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
    // Guard against double-clicks or a re-join while one is in flight.
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

      const anyFresh = presence.some(p => p && isFresh(p.iso));

      if (!anyFresh) {
        this._setStatus("Resetting dead room...");

        try {
          await this._writeWithRetry(
            "data/" + room + "/log.txt",
            (cur) => (cur === "" ? null : ""),
            "reset " + room + " log"
          );
        } catch (e) {
          if (e.message === "BAD_TOKEN") {
            this._handleApiError(e, "reset log");
            return;
          }
          // Other errors on reset are survivable; continue.
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
            if (e.message === "BAD_TOKEN") {
              this._handleApiError(e, "reset presence");
              return;
            }
          }
        }

        await this._sleep(RESET_SETTLE_MS);

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

  // Claim the lowest slot that is either free or stale. Trusts the
  // write: if _writeWithRetry returned true, the write landed on
  // GitHub, and this slot is ours. No confirm read (which would be
  // stale and could not be trusted anyway).
  async _claimSlot(room, presence) {
    for (let s = 0; s < SLOTS; s++) {
      const cur = presence[s];
      if (cur && isFresh(cur.iso) && cur.clientId !== this.clientId) {
        continue;
      }
      if (cur && cur.clientId === this.clientId && isFresh(cur.iso)) {
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
              // If a race put someone else here between our loop's
              // snapshot and this read, do not stomp them.
              if (parsed && parsed.clientId !== this.clientId && isFresh(parsed.iso)) {
                return null;
              }
            }
            return this._serializeSlot(this.clientId, this.username, nowIso());
          },
          "claim slot " + s
        );
      } catch (e) {
        if (e.message === "BAD_TOKEN") throw e;
        // Write failed after retries. Try next slot.
        continue;
      }

      if (wrote) {
        return s;
      }
      // buildContent declined: someone else holds this slot.
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

  // Writes our slot. If the write declines (buildContent returned
  // null because someone else holds the slot), we treat that as
  // eviction and leave. No confirm read: we trust the write.
  async _heartbeat() {
    if (this.room === null || this.slot === null) return;
    const path = "data/" + this.room + "/presence/slot" + this.slot + ".txt";
    const self = this;

    try {
      const wrote = await this._writeWithRetry(
        path,
        (currentContent) => {
          if (!currentContent) {
            // Slot was cleared by someone else. Do not re-claim
            // silently; signal eviction.
            return null;
          }
          const parsed = self._parseSlot(currentContent);
          if (!parsed || parsed.clientId !== self.clientId) {
            return null;
          }
          return self._serializeSlot(self.clientId, self.username, nowIso());
        },
        "heartbeat slot " + this.slot
      );

      if (!wrote) {
        this._setStatus("Your slot was taken. Leaving...");
        await this._leaveRoom();
      }
    } catch (e) {
      if (e.message === "BAD_TOKEN") {
        this._handleApiError(e, "heartbeat");
        return;
      }
      // Other errors: try again next beat.
    }
  }

  // ---------- Sync ----------

  async _manualUpdate() {
    const now = Date.now();
    if (now - this._lastUpdate < UPDATE_THROTTLE) {
      const remain = Math.ceil((UPDATE_THROTTLE - (now - this._lastUpdate)) / 1000);
      this._setStatus("Please wait " + remain + "s before updating again.");
      setTimeout(() => this._clearStatus(), 2000);
      return;
    }
    this._lastUpdate = now;
    this._setStatus("Updating...");
    try {
      await this._sync();
      this._clearStatus();
    } catch (e) {
      this._handleApiError(e, "update");
    }
  }

  async _sync() {
    if (this.room === null) return;

    let logRead;
    try {
      logRead = await this._readFile("data/" + this.room + "/log.txt");
    } catch (e) {
      if (e.message === "BAD_TOKEN") { this._handleApiError(e, "sync log"); return; }
      throw e;
    }

    const lines = logRead && logRead.content
      ? logRead.content.split("\n").filter(l => l.length > 0)
      : [];

    for (const line of lines) {
      const parsed = this._parseMessageLine(line);
      if (!parsed) continue;
      const key = parsed.username + "|" + parsed.iso + "|" + parsed.text;
      if (this.seenKeys.has(key)) continue;
      this.seenKeys.add(key);
      this.messages.push(parsed);
    }

    let presence;
    try {
      presence = await this._readPresence(this.room);
    } catch (e) {
      if (e.message === "BAD_TOKEN") { this._handleApiError(e, "sync presence"); return; }
      throw e;
    }

    // Always include ourselves in the user list. The read of our
    // own slot may be stale (we just heartbeated); we know we are
    // here regardless.
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

    const text = this.inputText.trim();
    if (!text) return;

    const now = Date.now();
    if (now - this._lastSend < SEND_COOLDOWN) {
      const remain = Math.ceil((SEND_COOLDOWN - (now - this._lastSend)) / 1000);
      this._setStatus("Please wait " + remain + "s before sending again.");
      setTimeout(() => this._clearStatus(), 2000);
      return;
    }

    const safe = text.replace(/\|/g, "/").replace(/\n/g, " ").replace(/\r/g, " ");
    const iso  = nowIso();
    const line = this.username + "|" + iso + "|" + safe + "\n";

    const path = "data/" + this.room + "/log.txt";

    try {
      await this._writeWithRetry(
        path,
        (currentContent) => currentContent + line,
        "chat from " + this.username
      );

      // Optimistic local echo. The sync below may read stale content
      // and miss our own line; we cannot rely on it to show ourselves
      // what we just wrote.
      const key = this.username + "|" + iso + "|" + safe;
      if (!this.seenKeys.has(key)) {
        this.seenKeys.add(key);
        this.messages.push({ username: this.username, iso, text: safe });
        this._renderMessages();
      }

      this._lastSend = now;
      this.inputText = "";
      this._refreshChatInput();
      this._clearStatus();

      // Best-effort sync to pick up others' messages. Ignore errors
      // here; the local echo above already made our own message
      // visible.
      try {
        await this._sync();
      } catch (e) {
        // Non-fatal.
      }
    } catch (e) {
      if (e.message === "BAD_TOKEN") {
        this._handleApiError(e, "send");
        return;
      }
      this._setStatus("Send failed. Try again.");
      setTimeout(() => this._clearStatus(), 3000);
    }
  }

  // ---------- Keyboard input ----------

  onEvent(e) {
    if (e.type !== "keydown") return;
    if (e.repeat) return;

    const top = this.stack[this.stack.length - 1];

    if (top === "token")    { this._handleTokenKey(e);    return; }
    if (top === "username") { this._handleUsernameKey(e); return; }
    if (top === "chat")     { this._handleChatKey(e);     return; }
  }

  _handleTokenKey(e) {
    if (e.key === "Backspace") {
      this._tokenBuffer = this._tokenBuffer.slice(0, -1);
      this._refreshTokenField();
      return;
    }
    if (e.key === "Enter") {
      this._submitToken();
      return;
    }
    if (e.key.length === 1) {
      this._tokenBuffer += e.key;
      this._refreshTokenField();
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
    if (e && e.message === "BAD_TOKEN") {
      this._saveToken("");
      this._stopTimers();
      this._leaveRoomInternal();
      this.stack = ["token"];
      this._applyScreen("token");
      this.tokenErrorLabel.text = "That token did not work. Check it and try again.";
      this._tokenBuffer = "";
      this._refreshTokenField();
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
    if (top !== "token" && top !== "username" && top !== "chat") return;

    this._cursorTimer += dt * 1000;
    if (this._cursorTimer >= CURSOR_MS) {
      this._cursorTimer -= CURSOR_MS;
      this._cursorOn = !this._cursorOn;

      if (top === "token")    this._refreshTokenField();
      if (top === "username") this._refreshUsernameField();
      if (top === "chat")     this._refreshChatInput();
    }
  }
}