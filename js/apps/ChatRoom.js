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
// Presence model: one file per slot, data/roomN/presence/slotM.txt.
// Each slot is written by exactly one client at a time, so presence
// writes never contend. A slot is "occupied" if its heartbeat is
// within STALE_MS. A room is "dead" if every slot is empty or stale.
//
// Room reset: the first client to join a dead room wipes the log
// and all ten presence files, then claims slot 0. Two simultaneous
// joiners are handled by a re-read after claiming: if our clientId
// is not in the file we wrote, someone raced us and we try the
// next free slot.
//
// Screens (all one canvas, toggled via visible):
//   1. Token      - enters PAT, stored in localStorage.
//   2. Username   - enters display name (not unique).
//   3. Room list  - three rooms, occupancy shown as "?".
//   4. Chat       - log + user list + input + Send + Update + Leave.
//
// A local back-stack drives navigation. Return/Leave walks it back.
// Only the token screen's Return exits to OSApp.

import { App }       from "./App.js";
import { Rect }      from "../primitives/Rect.js";
import { Text }      from "../primitives/Text.js";
import { Panel }     from "../composites/Panel.js";
import { Button }    from "../composites/Button.js";
import { Label }     from "../composites/Label.js";
import { Composite } from "../composites/Composite.js";
import { Viewport }  from "../systems/Viewport.js";

// -----------------------------------------------------------------
// FILL THESE IN
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

const STALE_MS         = 2 * 60 * 1000;  // 2 minutes: room is dead if older
const HEARTBEAT_MS     = 60 * 1000;      // every 60s, always
const SYNC_MS          = 60 * 1000;      // periodic sync
const UPDATE_THROTTLE  = 10 * 1000;      // manual Update cooldown
const SEND_COOLDOWN    = 30 * 1000;      // min gap between sends
const PUT_MAX_RETRIES  = 5;
const PUT_BACKOFF_MS   = 150;            // randomized 0..150 between retries
const CLAIM_SETTLE_MS  = 300;            // re-read delay after claiming a slot

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
  // API returns base64 with embedded newlines; strip them.
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
  // Not cryptographic, just needs to be unique per tab.
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
    // Persistent-per-machine state.
    this.token    = this._loadToken();
    this.username = "";

    // Per-tab identity. New every page load.
    this.clientId = randomId();

    // Current room, if any. Set on join, cleared on leave.
    this.room     = null;
    this.slot     = null;

    // Chat state.
    this.messages    = [];    // parsed { username, iso, text }
    this.seenKeys    = new Set();
    this.users       = [];    // [{ slot, username, clientId }]

    // Timers.
    this._syncTimer      = null;
    this._heartbeatTimer = null;

    // Throttle/cooldown timestamps.
    this._lastUpdate = 0;
    this._lastSend   = 0;

    // Input echo.
    this.inputText = "";

    // Back-stack of screen names. Top = current.
    this.stack = ["token"];

    // Build all four screens.
    this.tokenScreen    = this._buildTokenScreen();
    this.usernameScreen = this._buildUsernameScreen();
    this.roomScreen     = this._buildRoomScreen();
    this.chatScreen     = this._buildChatScreen();

    this.root.add(this.tokenScreen);
    this.root.add(this.usernameScreen);
    this.root.add(this.roomScreen);
    this.root.add(this.chatScreen);

    this._applyScreen("token");
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
      // localStorage may be unavailable; in-memory token still works.
    }
  }

  // ---------- Screens ----------

  _buildTokenScreen() {
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

    screen.add(new Text({
      x: cx, y: 200,
      text: "Enter Token:",
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
      x: cx, y: fieldY + fieldH + 28,
      text: "",
      font: "16px monospace",
      color: "#e06060",
      align: "center",
      baseline: "middle",
    });
    screen.add(this.tokenErrorLabel);

    screen.add(new Button({
      x: cx - 110, y: fieldY + fieldH + 70,
      w: 220, h: 56,
      text: "Continue",
      fill: "#2a3552",
      stroke: "#6a86b8",
      strokeWidth: 2,
      radius: 8,
      textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
      onClick: () => this._submitToken(),
    }));

    this._tokenBuffer = "";
    this.tokenFieldLabel.setText("");

    return screen;
  }

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

    this._usernameBuffer = "";
    this.usernameFieldLabel.setText("");

    return screen;
  }

  _buildRoomScreen() {
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

    // Leave - top-left.
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

    // Update - top-right, mirrored.
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

    // The big rectangle: chat log (top-left), user list (right),
    // input row (bottom-left), Send button (bottom-left, right of
    // input row, still inside the rectangle).
    //
    //   boxX,boxY,boxW,boxH  ->  outer border of the big rectangle
    //   userColW             ->  width of the right column (user list)
    //   inputRowH            ->  height of the bottom input row
    //
    // The chat area is (boxW - userColW) wide and (boxH - inputRowH)
    // tall. The input row spans the full chat-area width.

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

    // Divider line between chat area and user column.
    box.add(new Rect({
      x: boxW - userColW - 1, y: 0,
      w: 2, h: boxH,
      fill: "#2a3552",
      stroke: null,
    }));

    // Divider line between message area and input row.
    box.add(new Rect({
      x: 0, y: boxH - inputRowH - 1,
      w: boxW - userColW, h: 2,
      fill: "#2a3552",
      stroke: null,
    }));

    // Message lines. No scrolling - oldest get pushed off. We keep a
    // pool of Text nodes and rewrite the visible slice.
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

    // User list - ten fixed rows, one per slot.
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

    // Input field.
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

    // Send button - to the right of the input field, inside the box.
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

    // Status text - small, top of chat area, for cooldowns/errors.
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

    // Room title - shows which room.
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

    if (name !== "chat") {
      this._stopTimers();
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

    // Leaving the chat screen via the back-stack is equivalent to
    // pressing Leave: clear our slot best-effort.
    if (leaving === "chat") {
      this._leaveRoomInternal();
      return;
    }

    this.stack.pop();
    this._applyScreen(this.stack[this.stack.length - 1]);
  }

  _refreshRoomOccupancyPlaceholders() {
    // Occupancy is shown as "?" until the user joins a room, per
    // the design decision to avoid 30 reads just for a UI hint.
    for (const name of ROOMS) {
      this.roomButtons[name].setText(ROOM_LABELS[name] + "  ?/10");
    }
  }

  // ---------- Token submit ----------

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

  // ---------- GitHub API ----------

  _authHeaders() {
    return {
      "Authorization": "Bearer " + this.token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  // Read a file. Returns { content: string, sha: string } or null if
  // the file does not exist (404). Throws on other errors.
  async _readFile(path) {
    const url = API + path + "?ref=" + encodeURIComponent(BRANCH);
    const res = await fetch(url, { headers: this._authHeaders() });

    if (res.status === 404) return null;
    if (res.status === 401) throw new Error("BAD_TOKEN");
    if (!res.ok) throw new Error("READ_FAILED_" + res.status);

    const json = await res.json();
    const content = json.content ? fromBase64(json.content) : "";
    return { content, sha: json.sha };
  }

  // Write a file. `sha` must be the sha of the version we read. If
  // the file does not exist yet, pass sha = null. Returns the new
  // sha on success. Throws CONFLICT on 409.
  async _writeFile(path, content, sha, message) {
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
    if (res.status === 422) throw new Error("CONFLICT"); // sha mismatch often surfaces as 422
    if (!res.ok) throw new Error("WRITE_FAILED_" + res.status);

    const json = await res.json();
    return json.content ? json.content.sha : null;
  }

  // Read all ten slot files of a room. Returns an array of length
  // SLOTS. Each entry is { clientId, username, iso } or null.
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
        // A failed read for one slot should not take down the room.
        if (e.message === "BAD_TOKEN") throw e;
      }
      out.push(rec);
    }
    return out;
  }

  _parseSlot(content) {
    // Format: clientId \n username \n iso
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
    this._setStatus("Joining " + ROOM_LABELS[room] + "...");

    let presence;
    try {
      presence = await this._readPresence(room);
    } catch (e) {
      this._handleApiError(e, "read presence");
      return;
    }

    const anyFresh = presence.some(p => p && isFresh(p.iso));

    if (!anyFresh) {
      // Room is dead. Wipe the log and all presence files, then
      // claim slot 0. Two simultaneous joiners both attempt the wipe;
      // empty-over-empty is idempotent and harmless.
      this._setStatus("Resetting dead room...");

      // Wipe log.
      try {
        const log = await this._readFile("data/" + room + "/log.txt");
        if (log && log.content !== "") {
          await this._writeFile(
            "data/" + room + "/log.txt",
            "",
            log.sha,
            "reset " + room + " log"
          );
        }
      } catch (e) {
        if (e.message !== "CONFLICT") {
          this._handleApiError(e, "reset log");
          return;
        }
        // Conflict on reset is fine; someone else is resetting.
      }

      // Wipe all slots that are non-empty. We only need to clear
      // ones with content; empty ones are already fine.
      for (let s = 0; s < SLOTS; s++) {
        const path = "data/" + room + "/presence/slot" + s + ".txt";
        if (!presence[s]) continue;
        try {
          const r = await this._readFile(path);
          if (r && r.content !== "") {
            await this._writeFile(path, "", r.sha, "reset slot " + s);
          }
        } catch (e) {
          if (e.message === "BAD_TOKEN") {
            this._handleApiError(e, "reset presence");
            return;
          }
          // Ignore other errors on wipe; we will re-read anyway.
        }
      }

      // Re-read after wipe so our slot scan sees the clean state.
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
      this._clearStatusDelayed(3000);
      return;
    }

    this.room = room;
    this.slot = slot;
    this.messages = [];
    this.seenKeys = new Set();
    this.users = [];

    this.roomTitleLabel.text = ROOM_LABELS[room];
    this.inputText = "";
    this.inputLabel.setText("");

    this._pushScreen("chat");
    this._clearStatus();

    // Initial sync, then timers.
    try {
      await this._sync();
    } catch (e) {
      this._handleApiError(e, "initial sync");
    }
    this._startTimers();
  }

  // Find the lowest free slot, write ourselves into it, re-read to
  // confirm ownership. Returns the slot index or null if full.
  async _claimSlot(room, presence) {
    for (let s = 0; s < SLOTS; s++) {
      const cur = presence[s];
      if (cur && isFresh(cur.iso) && cur.clientId !== this.clientId) {
        continue; // occupied by someone else
      }
      // Free or stale. Try to claim it.
      const path = "data/" + room + "/presence/slot" + s + ".txt";

      // Read current sha so we can write (may be stale-record sha).
      let sha = null;
      try {
        const r = await this._readFile(path);
        if (r) sha = r.sha;
      } catch (e) {
        if (e.message === "BAD_TOKEN") throw e;
        // Otherwise treat as no file; the write may 422 and we retry.
      }

      try {
        await this._writeFile(
          path,
          this._serializeSlot(this.clientId, this.username, nowIso()),
          sha,
          "claim slot " + s
        );
      } catch (e) {
        if (e.message === "BAD_TOKEN") throw e;
        // Conflict or race; try the next slot.
        continue;
      }

      // Settle and confirm.
      await this._sleep(CLAIM_SETTLE_MS);

      let confirm;
      try {
        confirm = await this._readFile(path);
      } catch (e) {
        if (e.message === "BAD_TOKEN") throw e;
        continue;
      }

      if (!confirm) continue;
      const parsed = this._parseSlot(confirm.content);
      if (parsed && parsed.clientId === this.clientId) {
        return s;
      }
      // Someone raced us. Try next slot.
    }
    return null;
  }

  // ---------- Leave ----------

  async _leaveRoom() {
    await this._leaveRoomInternal();
    // Walk the stack back to the room list.
    while (this.stack.length > 1 && this.stack[this.stack.length - 1] !== "room") {
      this.stack.pop();
    }
    this._applyScreen("room");
  }

  // Clear our own slot. Best-effort: if it fails, the staleness
  // rule will eventually clear it.
  async _leaveRoomInternal() {
    this._stopTimers();

    if (this.room !== null && this.slot !== null) {
      const room = this.room;
      const slot = this.slot;
      this.room = null;
      this.slot = null;

      const path = "data/" + room + "/presence/slot" + slot + ".txt";
      try {
        const r = await this._readFile(path);
        if (r && r.content) {
          const parsed = this._parseSlot(r.content);
          // Only clear if it is still ours.
          if (parsed && parsed.clientId === this.clientId) {
            await this._writeFile(path, "", r.sha, "leave slot " + slot);
          }
        }
      } catch (e) {
        // Best-effort. Staleness handles the rest.
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
    const path = "data/" + this.room + "/presence/slot" + this.slot + ".txt";

    for (let attempt = 0; attempt < PUT_MAX_RETRIES; attempt++) {
      try {
        const r = await this._readFile(path);
        if (!r) return;
        const parsed = this._parseSlot(r.content);
        // Only beat if the slot is still ours. If someone else took
        // it, stop beating; we are effectively evicted.
        if (!parsed || parsed.clientId !== this.clientId) {
          this._setStatus("Your slot was taken. Leaving...");
          await this._leaveRoom();
          return;
        }
        await this._writeFile(
          path,
          this._serializeSlot(this.clientId, this.username, nowIso()),
          r.sha,
          "heartbeat slot " + this.slot
        );
        return;
      } catch (e) {
        if (e.message === "BAD_TOKEN") {
          this._handleApiError(e, "heartbeat");
          return;
        }
        await this._sleep(50 + Math.random() * PUT_BACKOFF_MS);
      }
    }
  }

  // ---------- Sync ----------

  async _manualUpdate() {
    const now = Date.now();
    if (now - this._lastUpdate < UPDATE_THROTTLE) {
      const remain = Math.ceil((UPDATE_THROTTLE - (now - this._lastUpdate)) / 1000);
      this._setStatus("Please wait " + remain + "s before updating again.");
      this._clearStatusDelayed(2000);
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

    // Read the log.
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

    // Read presence.
    let presence;
    try {
      presence = await this._readPresence(this.room);
    } catch (e) {
      if (e.message === "BAD_TOKEN") { this._handleApiError(e, "sync presence"); return; }
      throw e;
    }

    this.users = [];
    for (let s = 0; s < SLOTS; s++) {
      const p = presence[s];
      if (p && isFresh(p.iso)) {
        this.users.push({ slot: s, username: p.username, clientId: p.clientId });
      }
    }

    this._renderMessages();
    this._renderUsers();
  }

  _parseMessageLine(line) {
    // username|ISO8601|text
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
    // Show the last N messages, oldest at top.
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
      // Format: "[HH:MM] username: text". We render as one string
      // in monospace. Coloring the pieces separately would need
      // multiple Text nodes per line; not worth it for now.
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
      const name = u.username;
      const pad  = String(s) + ".";
      t.text = pad + " " + name;
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
      this._clearStatusDelayed(2000);
      return;
    }

    // Strip pipe and newline so the line format stays parseable.
    const safe = text.replace(/\|/g, "/").replace(/\n/g, " ").replace(/\r/g, " ");
    const line = this.username + "|" + nowIso() + "|" + safe + "\n";

    const path = "data/" + this.room + "/log.txt";

    for (let attempt = 0; attempt < PUT_MAX_RETRIES; attempt++) {
      try {
        const r = await this._readFile(path);
        const baseContent = r ? r.content : "";
        const sha = r ? r.sha : null;
        const newContent = baseContent + line;

        await this._writeFile(path, newContent, sha, "chat from " + this.username);

        this._lastSend = now;
        this.inputText = "";
        this.inputLabel.setText("");
        this._clearStatus();

        // Optimistic local echo, then sync to pick up anyone else's
        // messages that landed since our read.
        await this._sync();
        return;
      } catch (e) {
        if (e.message === "BAD_TOKEN") {
          this._handleApiError(e, "send");
          return;
        }
        if (e.message === "CONFLICT") {
          await this._sleep(50 + Math.random() * PUT_BACKOFF_MS);
          continue;
        }
        this._setStatus("Send failed. Try again.");
        this._clearStatusDelayed(3000);
        return;
      }
    }

    this._setStatus("Could not send after several tries. Try again.");
    this._clearStatusDelayed(4000);
  }

  // ---------- Keyboard input ----------

  onEvent(e) {
    if (e.type !== "keydown") return;
    if (e.repeat) return;

    const top = this.stack[this.stack.length - 1];

    if (top === "token") {
      this._handleFieldKey(e, "_tokenBuffer", this.tokenFieldLabel);
      return;
    }
    if (top === "username") {
      this._handleFieldKey(e, "_usernameBuffer", this.usernameFieldLabel);
      return;
    }
    if (top === "chat") {
      this._handleChatKey(e);
      return;
    }
  }

  _handleFieldKey(e, bufName, label) {
    if (e.key === "Backspace") {
      this[bufName] = this[bufName].slice(0, -1);
      label.setText(this[bufName]);
      return;
    }
    if (e.key === "Enter") {
      if (bufName === "_tokenBuffer")    this._submitToken();
      if (bufName === "_usernameBuffer") this._submitUsername();
      return;
    }
    if (e.key.length === 1) {
      this[bufName] += e.key;
      label.setText(this[bufName]);
    }
  }

  _handleChatKey(e) {
    if (e.key === "Backspace") {
      this.inputText = this.inputText.slice(0, -1);
      this.inputLabel.setText(this.inputText);
      return;
    }
    if (e.key === "Enter") {
      this._sendMessage();
      return;
    }
    if (e.key.length === 1) {
      this.inputText += e.key;
      this.inputLabel.setText(this.inputText);
    }
  }

  // ---------- Status helpers ----------

  _setStatus(msg) {
    this.statusLabel.text = msg || "";
  }

  _clearStatus() {
    this.statusLabel.text = "";
  }

  _clearStatusDelayed(ms) {
    setTimeout(() => this._clearStatus(), ms);
  }

  _handleApiError(e, where) {
    if (e && e.message === "BAD_TOKEN") {
      this._setStatus("Token was rejected. Returning to token screen.");
      this._saveToken("");
      this._stopTimers();
      this._leaveRoomInternal();
      this.stack = ["token"];
      this._applyScreen("token");
      this.tokenErrorLabel.text = "That token did not work. Check it and try again.";
      this._tokenBuffer = "";
      this.tokenFieldLabel.setText("");
      return;
    }
    this._setStatus("Error during " + where + ": " + (e && e.message ? e.message : "unknown"));
    this._clearStatusDelayed(4000);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ---------- App lifecycle ----------

  update(dt) {
    // Nothing per-frame. All timing is via setInterval.
  }

  _clearStatusUnused() {}
}