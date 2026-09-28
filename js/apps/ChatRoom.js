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
const SEND_COOLDOWN    = 30 * 1000;      // min gap between sends
const PUT_MAX_RETRIES  = 6;              // retries for a conflicted write
const PUT_BACKOFF_MS   = 250;            // random 0..250 ms between retries
const DEAD_CONFIRM_MS  = 1000;           // wait between the two dead-room reads

const CURSOR_MS        = 500;            // blink half-period

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
    this.token    = this._loadToken();
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

    this._cursorOn    = true;
    this._cursorTimer = 0;

    this._tokenBuffer    = "";
    this._usernameBuffer = "";
    this.inputText       = "";

    this._joining = false;

    this._treeCache = null;

    this._opChain = Promise.resolve();

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

  // =================================================================
  // GIT DATA API PRIMITIVES
  // =================================================================

  _authHeaders() {
    return {
      "Authorization": "Bearer " + this.token,
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
    if (res.status === 401) throw new Error("BAD_TOKEN");
    if (!res.ok) throw new Error("READ_REF_FAILED_" + res.status);
    const json = await res.json();
    return json.object.sha;
  }

  async _readCommitTreeSha(commitSha) {
    const url = API + "git/commits/" + commitSha;
    const res = await fetch(url, { headers: this._authHeaders(), cache: "no-store" });
    if (res.status === 401) throw new Error("BAD_TOKEN");
    if (!res.ok) throw new Error("READ_COMMIT_FAILED_" + res.status);
    const json = await res.json();
    return json.tree.sha;
  }

  async _readTreeEntries(treeSha) {
    const url = API + "git/trees/" + treeSha + "?recursive=1";
    const res = await fetch(url, { headers: this._authHeaders(), cache: "no-store" });
    if (res.status === 401) throw new Error("BAD_TOKEN");
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
    if (res.status === 401) throw new Error("BAD_TOKEN");
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
    if (res.status === 401) throw new Error("BAD_TOKEN");
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
    if (res.status === 401) throw new Error("BAD_TOKEN");
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
    if (res.status === 401) throw new Error("BAD_TOKEN");
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
    if (res.status === 401) throw new Error("BAD_TOKEN");
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
        if (e.message === "BAD_TOKEN") throw e;
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
          if (e.message === "BAD_TOKEN") throw e;
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
        if (e.message === "BAD_TOKEN") throw e;
        lastError = e;
        await this._sleep(Math.random() * PUT_BACKOFF_MS);
        continue;
      }

      let verifyRef;
      try {
        verifyRef = await this._readRef();
      } catch (e) {
        if (e.message === "BAD_TOKEN") throw e;
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
        if (e.message === "BAD_TOKEN") throw e;
        try {
          const postRef = await this._readRef();
          if (postRef === newCommitSha) {
            this._clearTreeCache();
            return true;
          }
        } catch (e2) {
          if (e2.message === "BAD_TOKEN") throw e2;
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
          if (e.message === "BAD_TOKEN") throw e;
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
          if (e.message === "BAD_TOKEN") {
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
            if (e.message === "BAD_TOKEN") {
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
        if (e.message === "BAD_TOKEN") throw e;
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
      if (e.message === "BAD_TOKEN") {
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

    return await this._serialize(async () => {
      this._clearTreeCache();
      await this._refreshTreeCache();

      let logContent = "";
      const logEntry = this._treeCache.entries.get("data/" + this.room + "/log.txt");
      if (logEntry) {
        try {
          logContent = await this._readBlob(logEntry.sha);
        } catch (e) {
          if (e.message === "BAD_TOKEN") { this._handleApiError(e, "sync log"); return; }
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
            if (e.message === "BAD_TOKEN") { this._handleApiError(e, "sync presence"); return; }
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

      this._lastSend = now;
      this.inputText = "";
      this._refreshChatInput();
      this._clearStatus();

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