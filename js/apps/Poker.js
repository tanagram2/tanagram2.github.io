// Poker.js - Texas Hold'em for CanvasOS.
//
// Accounts live at data/Poker/accounts/accounts.txt. One line per
// account, pipe-separated. Fields are encrypted with a per-field
// random salt + keystream XOR so identical username/password pairs
// do not produce identical lines. Not crypto. Threat model is
// "leak-tolerant, friends-only, repo is public".
//
// Multiplayer tables live at data/Poker/<roomTier>/ with the same
// three-file shape as Battleship: presence.txt, game.txt, chat.txt.
//
// Singleplayer uses the same engine with a null transport: state
// lives in memory, bots step inline with a short think delay.
//
// Cycle is 30 seconds. On your turn you have 30 seconds; observing
// clients auto-fold an unresponsive acting player after 1:30,
// verified against the game file's own turnStartedIso. Two
// consecutive auto-folds -> kicked, results recorded.
//
// Text entry: every text field is a Button that opens a modal
// entry panel. One modal at a time. Cursor blink only in the
// open modal.

import { App }       from "./App.js";
import { Rect }      from "../primitives/Rect.js";
import { Circle }    from "../primitives/Circle.js";
import { Text }      from "../primitives/Text.js";
import { Line }      from "../primitives/Line.js";
import { Panel }     from "../composites/Panel.js";
import { Button }    from "../composites/Button.js";
import { Label }     from "../composites/Label.js";
import { Keyboard }  from "../composites/Keyboard.js";
import { Composite } from "../composites/Composite.js";
import { Viewport }  from "../systems/Viewport.js";

// ---------- Repo config ----------

const OWNER  = "tanagram2";
const REPO   = "tanagram2.github.io";
const BRANCH = "main";

const DATA_ROOT     = "data/Poker/";
const ACCOUNTS_FILE = DATA_ROOT + "accounts/accounts.txt";

// ---------- Tunables ----------

const STALE_MS          = 2 * 60 * 1000;
const CYCLE_MS          = 30 * 1000;
const UPDATE_THROTTLE   = 10 * 1000;
const CHAT_COOLDOWN     = 8 * 1000;
const PUT_MAX_RETRIES   = 6;
const PUT_BACKOFF_MS    = 250;

const STAGGER_MIN_MS    = 500;
const STAGGER_MAX_MS    = 3000;
const PRESTAGGER_MAX_MS = 2000;

const LEAVE_TIMESTAMP = "1970-01-01T00:00:00.000Z";

const CURSOR_MS = 500;

const SESSION_KEY    = "canvasos.session.id";
const POKER_USER_KEY = "canvasos.poker.user";

const API = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/";

const RECONNECT_GRACE_MS = 2 * 60 * 1000;

const AUTO_FOLD_MS   = 90 * 1000;
const AUTO_FOLD_KICK_COUNT = 2;

// Bot think time.
const BOT_THINK_MIN_MS = 800;
const BOT_THINK_MAX_MS = 2000;

// Auto-deal next hand delay.
const NEXT_HAND_DELAY_MS = 5000;

// ---------- Table limits ----------

const TABLE_TIERS = [
  { key: "t2",    label: "2-20",          smallBlind: 1,    bigBlind: 2,    maxBuyIn: 200,    scale: 1    },
  { key: "t20",   label: "20-200",        smallBlind: 10,   bigBlind: 20,   maxBuyIn: 2000,   scale: 10   },
  { key: "t200",  label: "200-2,000",     smallBlind: 100,  bigBlind: 200,  maxBuyIn: 20000,  scale: 100  },
  { key: "t2000", label: "2,000-20,000",  smallBlind: 1000, bigBlind: 2000, maxBuyIn: 200000, scale: 1000 },
];

const MP_ROOMS = [
  { key: "room_t2",    tier: "t2",    label: "2-20"          },
  { key: "room_t20",   tier: "t20",   label: "20-200"        },
  { key: "room_t200",  tier: "t200",  label: "200-2,000"     },
  { key: "room_t2000", tier: "t2000", label: "2,000-20,000"  },
];

const SEATS = 11;
const START_BANK = 10000;

// ---------- Chip denominations ----------

const BASE_CHIPS = [
  { value: 100, fill: "#101010", stroke: "#505050", label: "100" },
  { value: 25,  fill: "#9ed060", stroke: "#c8ee9a", label: "25"  },
  { value: 10,  fill: "#7ec8e8", stroke: "#b0e2f5", label: "10"  },
  { value: 5,   fill: "#d04040", stroke: "#f08080", label: "5"   },
  { value: 1,   fill: "#f0f0f0", stroke: "#a0a0a0", label: "1"   },
];

// ---------- Colors ----------

const BG_SCREEN   = "#323232";
const BG_INSET    = "#3e3e3e";
const BG_PANEL    = "#2a2a2a";
const BG_CHAT     = "#2a2a2a";

const STROKE_INSET = "#606060";
const STROKE_PANEL = "#6e6e6e";

const FELT_GREEN  = "#1e6a3a";
const FELT_EDGE   = "#0d3a20";
const FELT_STRIPE = "#2a8a4e";

const SEAT_IDLE_FILL    = "#f0e6c8";
const SEAT_IDLE_STROKE  = "#000000";
const SEAT_ACTIVE_FILL  = "#ffe680";
const SEAT_FOLDED_FILL  = "#5a5a5a";
const SEAT_BUSTED_FILL  = "#303030";
const SEAT_YOU_FILL     = "#c8e0ff";

const DEALER_FILL   = "#d02020";
const DEALER_STROKE = "#000000";

const CARD_FACE_FILL = "#f8f8f0";
const CARD_FACE_EDGE = "#101010";
const CARD_BACK_FILL = "#2a5a9a";
const CARD_BACK_EDGE = "#101010";
const CARD_BACK_DECO = "#4a8ada";

const TEXT_PRIMARY   = "#eef2f8";
const TEXT_SECONDARY = "#b8c8e0";
const TEXT_DIM       = "#8a9ab0";
const TEXT_TURN      = "#70aaff";
const TEXT_MONEY     = "#ffd040";
const TEXT_CHAT      = "#e0e8f0";
const TEXT_ERROR     = "#ff6060";
const TEXT_BADGE     = "#ff4040";

const SUIT_RED   = "#c02020";
const SUIT_BLACK = "#101010";

const BTN_BLUE_FILL    = "#2a4a80";
const BTN_BLUE_STROKE  = "#4a9aff";
const BTN_GREEN_FILL   = "#1f8a3f";
const BTN_GREEN_STROKE = "#4fd97a";
const BTN_RED_FILL     = "#c02020";
const BTN_RED_STROKE   = "#ff5050";

const BUSY_FILL   = "#5a5a5a";
const BUSY_STROKE = "#a8a8a8";

// ---------- Cards ----------

const SUITS = ["s", "h", "d", "c"];
const RANKS = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];

const RANK_VALUE = {
  "2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"T":10,
  "J":11,"Q":12,"K":13,"A":14,
};

const SUIT_RED_SET = { h: true, d: true };

// ---------- Bot personalities ----------

const BOT_PERSONALITIES = ["timid", "straight", "aggressive"];

const BOT_NAMES = [
  "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot",
  "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima",
];

// ---------- Helpers ----------

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

function nowIso() { return new Date().toISOString(); }

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

function formatMoney(n) {
  const neg = n < 0;
  const abs = Math.abs(Math.round(n));
  const s = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-$" : "$") + s;
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n);
}

// ---------- Encryption ----------

function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function buildKeystream(seed, len) {
  const out = new Uint8Array(len);
  let acc = fnv1a32(seed);
  for (let i = 0; i < len; i++) {
    acc = (acc + 0x9e3779b9) >>> 0;
    let x = acc;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;  x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

function randHex(bytes) {
  const arr = new Uint8Array(bytes);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  let s = "";
  for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, "0");
  return s;
}

const CRYPTO_CONST = "canvasos.poker.v1";

function encField(plaintext, fieldName) {
  const salt = randHex(8);
  const seed = salt + "|" + fieldName + "|" + CRYPTO_CONST;
  const ks   = buildKeystream(seed, plaintext.length);
  const bytes = new TextEncoder().encode(plaintext);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ^ ks[i]).toString(16).padStart(2, "0");
  }
  return salt + ":" + hex;
}

function decField(blob, fieldName) {
  if (!blob || blob.indexOf(":") < 0) return "";
  const parts = blob.split(":");
  const salt = parts[0];
  const hex  = parts[1];
  const seed = salt + "|" + fieldName + "|" + CRYPTO_CONST;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  const ks = buildKeystream(seed, bytes.length);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ ks[i];
  return new TextDecoder().decode(out);
}

// ---------- Deck ----------

function newDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) deck.push(r + s);
  }
  return deck;
}

// ---------- Hand evaluation ----------

function evalHand(cards) {
  const vals = cards.map(c => RANK_VALUE[c[0]]);
  const suits = cards.map(c => c[1]);

  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.keys(counts).map(k => ({ v: parseInt(k, 10), n: counts[k] }));
  groups.sort((a, b) => (b.n - a.n) || (b.v - a.v));

  const isFlush = suits.every(s => s === suits[0]);

  const uniqVals = Array.from(new Set(vals)).sort((a, b) => a - b);
  let straightHigh = 0;
  if (uniqVals.length === 5) {
    if (uniqVals[4] - uniqVals[0] === 4) straightHigh = uniqVals[4];
    else if (uniqVals[0] === 2 && uniqVals[1] === 3 && uniqVals[2] === 4
             && uniqVals[3] === 5 && uniqVals[4] === 14) straightHigh = 5;
  }

  if (isFlush && straightHigh) return { rank: 8, tiebreak: [straightHigh], name: "Straight Flush" };
  if (groups[0].n === 4) return { rank: 7, tiebreak: [groups[0].v, groups[1].v], name: "Four of a Kind" };
  if (groups[0].n === 3 && groups[1] && groups[1].n === 2) {
    return { rank: 6, tiebreak: [groups[0].v, groups[1].v], name: "Full House" };
  }
  if (isFlush) return { rank: 5, tiebreak: vals.slice().sort((a, b) => b - a), name: "Flush" };
  if (straightHigh) return { rank: 4, tiebreak: [straightHigh], name: "Straight" };
  if (groups[0].n === 3) {
    const kick = groups.slice(1).map(g => g.v).sort((a, b) => b - a);
    return { rank: 3, tiebreak: [groups[0].v, ...kick], name: "Three of a Kind" };
  }
  if (groups[0].n === 2 && groups[1] && groups[1].n === 2) {
    const hi = Math.max(groups[0].v, groups[1].v);
    const lo = Math.min(groups[0].v, groups[1].v);
    const kick = groups[2] ? groups[2].v : 0;
    return { rank: 2, tiebreak: [hi, lo, kick], name: "Two Pair" };
  }
  if (groups[0].n === 2) {
    const kick = groups.slice(1).map(g => g.v).sort((a, b) => b - a);
    return { rank: 1, tiebreak: [groups[0].v, ...kick], name: "One Pair" };
  }
  return { rank: 0, tiebreak: vals.slice().sort((a, b) => b - a), name: "High Card" };
}

function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreak[i] || 0;
    const bv = b.tiebreak[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function bestHand(seven) {
  let best = null;
  const n = seven.length;
  for (let a = 0; a < n; a++)
  for (let b = a + 1; b < n; b++)
  for (let c = b + 1; c < n; c++)
  for (let d = c + 1; d < n; d++)
  for (let e = d + 1; e < n; e++) {
    const hand = evalHand([seven[a], seven[b], seven[c], seven[d], seven[e]]);
    if (!best || compareHands(hand, best) > 0) best = hand;
  }
  return best;
}

function chipBreakdown(amount) {
  const out = [];
  let rem = Math.max(0, Math.round(amount));
  for (const c of BASE_CHIPS) {
    if (rem >= c.value) {
      const n = Math.floor(rem / c.value);
      rem -= n * c.value;
      out.push({ value: c.value, count: n, fill: c.fill, stroke: c.stroke });
    }
  }
  return out;
}

// =====================================================================
// App class.
// =====================================================================

export class Poker extends App {
  static displayName = "Poker";

  init() {
    this.mobile = Viewport.isMobile;
    this.orientation = "portrait";

    this.session = this._loadSession();

    this.account = null;

    this.stack = ["login"];

    // Login screen values (kept even though entry is via modal).
    this.loginUsername = "";
    this.loginPassword = "";
    this.loginError    = "";

    // Create-account values.
    this.createUsername = "";
    this.createPassword = "";
    this.createEmail    = "";
    this.createUsernameState = "empty";   // "empty" | "checking" | "taken" | "available"
    this.createError    = "";

    // Modal entry state.
    this.entryOpen    = false;
    this.entryTarget  = null;      // "loginUsername" | "loginPassword" | "createUsername" | "createPassword" | "createEmail" | "displayName"
    this.entryBuffer  = "";
    this.entryTitle   = "";
    this.entryPassword = false;
    this._entryCheckPromise = null;

    // Options.
    this.optionsField = null;

    // Balance.
    this.balancePendingBuy = 0;

    // Table state.
    this.tier         = null;
    this.tableMode    = null;
    this.roomKey      = null;
    this.tableId      = null;
    this.mySeat       = null;
    this.table        = null;
    this.chatLines    = [];
    this.spTierChoice = null;

    this.reconnectOffer = null;

    // Schedulers.
    this._cycleTimer     = null;
    this._cycleDelay     = CYCLE_MS;
    this._nextCycleAt    = 0;

    this._botTimer       = null;
    this._nextHandTimer  = null;

    this._lastUpdate = 0;
    this._lastSend   = 0;

    // In-flight flags.
    this._sending           = false;
    this._updating          = false;
    this._joining           = false;
    this._leaving           = false;
    this._creating          = false;
    this._loggingIn         = false;
    this._buyingChips       = false;
    this._betInFlight       = false;
    this._pendingResultUpdate = null;

    // Engine scratch.
    this._highestBet = 0;
    this._lastRaiser = null;

    // Cursor blink.
    this._cursorOn    = true;
    this._cursorTimer = 0;

    this._opChain = Promise.resolve();

    // Chat.
    this.chatOpen = false;
    this.unread   = 0;
    this.inputText = "";
    this._seenChatCount = 0;

    // Build screens.
    this.loginScreen   = this._buildLoginScreen();
    this.createScreen  = this._buildCreateScreen();
    this.menuScreen    = this._buildMenuScreen();
    this.optionsScreen = this._buildOptionsScreen();
    this.balanceScreen = this._buildBalanceScreen();
    this.spModeScreen  = this._buildSPModeScreen();
    this.spTierScreen  = this._buildSPTierScreen();
    this.spCountScreen = this._buildSPCountScreen();
    this.mpRoomScreen  = this._buildMPRoomScreen();
    this.tableScreen   = this._buildTableScreen();

    this.root.add(this.loginScreen);
    this.root.add(this.createScreen);
    this.root.add(this.menuScreen);
    this.root.add(this.optionsScreen);
    this.root.add(this.balanceScreen);
    this.root.add(this.spModeScreen);
    this.root.add(this.spTierScreen);
    this.root.add(this.spCountScreen);
    this.root.add(this.mpRoomScreen);
    this.root.add(this.tableScreen);

    // Modal entry overlay - built last so it draws on top.
    this._entryOverlay = this._buildEntryOverlay();
    this.root.add(this._entryOverlay);

    this._applyScreen("login");
    this._refreshAllFields();

    this._autoLogin();
  }

  // ---------- Session ----------

  _loadSession() {
    try { return localStorage.getItem(SESSION_KEY) || ""; }
    catch (e) { return ""; }
  }

  _loadPersistedUser() {
    try { return localStorage.getItem(POKER_USER_KEY) || ""; }
    catch (e) { return ""; }
  }

  _savePersistedUser(name) {
    try {
      if (name) localStorage.setItem(POKER_USER_KEY, name);
      else localStorage.removeItem(POKER_USER_KEY);
    } catch (e) {}
  }

  // ---------- Serialize ----------

  _serialize(fn) {
    const next = this._opChain.then(fn, fn);
    this._opChain = next.catch(() => {});
    return next;
  }

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

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =================================================================
  // Git Data API.
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
      if (entry.type === "blob") map.set(entry.path, { sha: entry.sha, mode: entry.mode });
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
      path: path, mode: "100644", type: "blob", sha: blobSha,
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

      let currentCommitSha, treeSha, entries, currentContent = null;
      let hintUsed = false;

      if (attempt === 0 && hint && hint.commitSha && hint.entries) {
        let liveRef;
        try { liveRef = await this._readRef(); }
        catch (e) { if (e.message === "BAD_SESSION") throw e; liveRef = null; }

        if (liveRef !== null && liveRef === hint.commitSha) {
          currentCommitSha = hint.commitSha;
          treeSha = hint.treeSha;
          entries = hint.entries;
          currentContent = hint.content !== undefined ? hint.content : null;
          hintUsed = true;
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
          try { currentContent = await this._readBlob(entry.sha); }
          catch (e) {
            if (e.message === "BAD_SESSION") throw e;
            lastError = e;
            await this._sleep(Math.random() * PUT_BACKOFF_MS);
            continue;
          }
        }
      }

      const toWrite = buildContent(currentContent);
      if (toWrite === null) return { ok: false, retried };

      let newBlobSha, newTreeSha, newCommitSha;
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
      try { verifyRef = await this._readRef(); }
      catch (e) {
        if (e.message === "BAD_SESSION") throw e;
        lastError = e;
        await this._sleep(Math.random() * PUT_BACKOFF_MS);
        continue;
      }

      if (verifyRef === newCommitSha) return { ok: true, retried };

      if (verifyRef !== currentCommitSha) {
        lastError = new Error("CONFLICT");
        await this._sleep(Math.random() * PUT_BACKOFF_MS);
        continue;
      }

      try { await this._patchRef(newCommitSha); }
      catch (e) {
        if (e.message === "BAD_SESSION") throw e;
        try {
          const postRef = await this._readRef();
          if (postRef === newCommitSha) return { ok: true, retried };
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
  // Presence helpers.
  // =================================================================

  _parsePresence(content, slots) {
    const lines = content ? content.split("\n") : [];
    const out = [];
    for (let i = 0; i < slots; i++) {
      const line = lines[i] !== undefined ? lines[i] : "";
      if (!line.trim()) { out.push(null); continue; }
      const parts = line.split("|");
      if (parts.length < 3) { out.push(null); continue; }
      const slotNum = parseInt(parts[0].replace(/^slot/, ""), 10);
      if (Number.isNaN(slotNum) || slotNum !== i) { out.push(null); continue; }
      if (!parts[1] || !parts[2]) { out.push(null); continue; }
      out.push({ slot: i, username: parts[1], iso: parts[2] });
    }
    return out;
  }

  _splicePresenceLine(content, slotIndex, newLine) {
    const lines = content ? content.split("\n") : [];
    while (lines.length <= slotIndex) lines.push("");
    lines[slotIndex] = newLine;
    return lines.join("\n");
  }

  _countPresent(content, slots) {
    const entries = this._parsePresence(content, slots);
    let n = 0;
    for (const e of entries) { if (e && isPresent(e.iso)) n++; }
    return n;
  }

  _firstFreeSlot(entries) {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || !isPresent(e.iso)) return i;
    }
    return -1;
  }

  // =================================================================
  // Accounts.
  // =================================================================

  _encAccountLine(acc) {
    const parts = [
      encField(acc.username,    "username"),
      encField(acc.password,    "password"),
      encField(acc.displayName, "displayName"),
      acc.email || "",
      String(acc.bank        | 0),
      String(acc.lifetime    | 0),
      String(acc.wins        | 0),
      String(acc.losses      | 0),
      String(acc.handsPlayed | 0),
      acc.createdIso     || "",
      acc.lastSeenIso    || "",
      acc.currentRoom    || "",
      String(acc.autoFolds   | 0),
    ];
    return parts.join("|");
  }

  _decAccountLine(line) {
    const parts = line.split("|");
    if (parts.length < 13) return null;
    return {
      username:     decField(parts[0], "username"),
      password:     decField(parts[1], "password"),
      displayName:  decField(parts[2], "displayName"),
      email:        parts[3] || "",
      bank:         parseInt(parts[4], 10) || 0,
      lifetime:     parseInt(parts[5], 10) || 0,
      wins:         parseInt(parts[6], 10) || 0,
      losses:       parseInt(parts[7], 10) || 0,
      handsPlayed:  parseInt(parts[8], 10) || 0,
      createdIso:   parts[9]  || "",
      lastSeenIso:  parts[10] || "",
      currentRoom:  parts[11] || "",
      autoFolds:    parseInt(parts[12], 10) || 0,
    };
  }

  async _readAccounts() {
    return await this._serialize(async () => {
      const ctx = await this._fetchTreeContext();
      const entry = ctx.entries.get(ACCOUNTS_FILE);
      let content = "";
      if (entry) content = await this._readBlob(entry.sha);
      const lines = content ? content.split("\n").filter(l => l.length > 0) : [];
      const accounts = [];
      for (const line of lines) {
        const acc = this._decAccountLine(line);
        if (acc) accounts.push(acc);
      }
      return { accounts, ctx };
    });
  }

  _findAccount(accounts, username) {
    const lc = username.toLowerCase();
    for (const a of accounts) if (a.username.toLowerCase() === lc) return a;
    return null;
  }

  _makeNewAccount(username, password, email) {
    return {
      username,
      password,
      displayName:  "DisplayName" + String(Math.floor(Math.random() * 10000)).padStart(4, "0"),
      email:        email || "",
      bank:         START_BANK,
      lifetime:     START_BANK,
      wins:         0,
      losses:       0,
      handsPlayed:  0,
      createdIso:   nowIso(),
      lastSeenIso:  nowIso(),
      currentRoom:  "",
      autoFolds:    0,
    };
  }

  async _autoLogin() {
    const name = this._loadPersistedUser();
    if (!name) return;
    try {
      const r = await this._readAccounts();
      const acc = this._findAccount(r.accounts, name);
      if (!acc) { this._savePersistedUser(""); return; }
      this._finishLogin(acc);
    } catch (e) {
      // Silent.
    }
  }

  _finishLogin(acc) {
    this.account = acc;
    this._savePersistedUser(acc.username);

    const lastSeen = Date.parse(acc.lastSeenIso || "");
    const recent = !Number.isNaN(lastSeen) && (Date.now() - lastSeen) < RECONNECT_GRACE_MS;
    if (recent && acc.currentRoom && acc.currentRoom.indexOf("|") >= 0) {
      const parts = acc.currentRoom.split("|");
      if (parts.length === 3) {
        this.reconnectOffer = { tier: parts[0], roomKey: parts[1], tableId: parts[2] };
      }
    }

    this._pushScreen("menu");
    this._refreshAllFields();
    this._refreshMenuLabels();
  }

  _logout() {
    this.account = null;
    this._savePersistedUser("");
    while (this.stack.length > 1) this.stack.pop();
    this._applyScreen("login");
    this._refreshAllFields();
  }

  // ---------- Create account ----------

  _canCreateAccount() {
    return this.createUsername.length > 0
        && this.createPassword.length > 0
        && this.createUsernameState === "available";
  }

  async _submitCreateAccount() {
    if (this._creating) return;
    if (!this._canCreateAccount()) return;

    this._creating = true;
    this.createError = "";
    this._refreshCreateScreen();

    const name  = this.createUsername;
    const pw    = this.createPassword;
    const email = this.createEmail;

    try {
      let created = null;

      await this._serialize(async () => {
        const ctx = await this._fetchTreeContext();
        const entry = ctx.entries.get(ACCOUNTS_FILE);
        let content = "";
        if (entry) content = await this._readBlob(entry.sha);
        const lines = content ? content.split("\n").filter(l => l.length > 0) : [];
        const accounts = [];
        for (const line of lines) {
          const a = this._decAccountLine(line);
          if (a) accounts.push(a);
        }

        if (this._findAccount(accounts, name)) return;

        const acc = this._makeNewAccount(name, pw, email);
        accounts.push(acc);

        const body = accounts.map(a => this._encAccountLine(a)).join("\n") + "\n";
        const hint = { commitSha: ctx.commitSha, treeSha: ctx.treeSha, entries: ctx.entries, content };

        const result = await this._writeWithRetry(
          ACCOUNTS_FILE,
          () => body,
          "create account " + name,
          hint
        );
        if (result.ok) created = acc;
      });

      if (!created) {
        this.createError = "Username taken. Try another.";
        this.createUsernameState = "taken";
        return;
      }

      this.createUsername = "";
      this.createPassword = "";
      this.createEmail    = "";
      this.createUsernameState = "empty";
      this.createError    = "";

      this._finishLogin(created);
    } catch (e) {
      this.createError = (e && e.message === "BAD_SESSION")
        ? "Session unavailable."
        : "Create failed. Try again.";
    } finally {
      this._creating = false;
      this._refreshCreateScreen();
    }
  }

  // ---------- Login ----------

  async _submitLogin() {
    if (this._loggingIn) return;
    if (!this.loginUsername || !this.loginPassword) {
      this.loginError = "Enter username and password.";
      this._refreshLoginScreen();
      return;
    }

    this._loggingIn = true;
    this.loginError = "";
    this._refreshLoginScreen();

    try {
      const r = await this._readAccounts();
      const acc = this._findAccount(r.accounts, this.loginUsername);
      if (!acc || acc.password !== this.loginPassword) {
        this.loginError = "Invalid username or password.";
        return;
      }
      this.loginUsername = "";
      this.loginPassword = "";
      this._finishLogin(acc);
    } catch (e) {
      this.loginError = (e && e.message === "BAD_SESSION")
        ? "Session unavailable."
        : "Login failed. Try again.";
    } finally {
      this._loggingIn = false;
      this._refreshLoginScreen();
    }
  }

  // ---------- Buy chips ----------

  async _confirmBuyChips(amount) {
    if (this._buyingChips) return;
    if (!this.account) return;
    if (amount <= 0) return;

    this._buyingChips = true;
    this._setStatus("Buying chips...");
    this._refreshBalanceScreen();

    try {
      let updated = null;
      await this._serialize(async () => {
        const ctx = await this._fetchTreeContext();
        const entry = ctx.entries.get(ACCOUNTS_FILE);
        let content = "";
        if (entry) content = await this._readBlob(entry.sha);
        const lines = content ? content.split("\n").filter(l => l.length > 0) : [];
        const accounts = [];
        for (const line of lines) {
          const a = this._decAccountLine(line);
          if (a) accounts.push(a);
        }
        const idx = accounts.findIndex(a => a.username.toLowerCase() === this.account.username.toLowerCase());
        if (idx < 0) return;

        accounts[idx].bank     += amount;
        accounts[idx].lifetime -= amount;
        accounts[idx].lastSeenIso = nowIso();
        updated = accounts[idx];

        const body = accounts.map(a => this._encAccountLine(a)).join("\n") + "\n";
        const hint = { commitSha: ctx.commitSha, treeSha: ctx.treeSha, entries: ctx.entries, content };

        const result = await this._writeWithRetry(ACCOUNTS_FILE, () => body, "buy chips " + amount, hint);
        if (!result.ok) updated = null;
      });

      if (updated) this.account = updated;
      this.balancePendingBuy = 0;
      this._setStatus("");
    } catch (e) {
      this._setStatus("Buy failed. Try again.");
      setTimeout(() => this._setStatus(""), 2500);
    } finally {
      this._buyingChips = false;
      this._refreshBalanceScreen();
      this._refreshMenuLabels();
    }
  }

  // =================================================================
  // Screen plumbing.
  // =================================================================

  _applyScreen(name) {
    this.loginScreen.visible   = name === "login";
    this.createScreen.visible  = name === "create";
    this.menuScreen.visible    = name === "menu";
    this.optionsScreen.visible = name === "options";
    this.balanceScreen.visible = name === "balance";
    this.spModeScreen.visible  = name === "spMode";
    this.spTierScreen.visible  = name === "spTier";
    this.spCountScreen.visible = name === "spCount";
    this.mpRoomScreen.visible  = name === "mpRooms";
    this.tableScreen.visible   = name === "table";

    this._cursorOn    = true;
    this._cursorTimer = 0;

    if (name !== "table") {
      this._stopCycle();
      this._cancelBotTimer();
      this._cancelNextHandTimer();
    }

    this._closeEntry();
  }

  _pushScreen(name) {
    this.stack.push(name);
    this._applyScreen(name);
  }

  _popScreen() {
    if (this.stack.length <= 1) return;
    this.stack.pop();
    this._applyScreen(this.stack[this.stack.length - 1]);
  }

  _refreshAllFields() {
    this._refreshLoginScreen();
    this._refreshCreateScreen();
    this._refreshOptionsScreen();
    this._refreshBalanceScreen();
  }

  _renderField(label, buffer) {
    if (!label) return;
    label.setText(buffer + (this._cursorOn ? "|" : " "));
  }

  _renderPasswordField(label, buffer) {
    if (!label) return;
    const stars = "*".repeat(buffer.length);
    label.setText(stars + (this._cursorOn ? "|" : " "));
  }

  // =================================================================
  // Modal entry overlay.
  // =================================================================

  _buildEntryOverlay() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mob = this.mobile;

    const ov = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      self: new Rect({ fill: "rgba(0,0,0,0.65)", stroke: null }),
    });
    ov.visible = false;

    const bw = mob ? W - 80 : 620;
    const bh = mob ? 300 : 260;
    const bx = (W - bw) / 2;
    const by = (H - bh) / 2;

    const box = new Panel({
      x: bx, y: by, w: bw, h: bh,
      fill: BG_PANEL, stroke: STROKE_PANEL, strokeWidth: 3, radius: 12,
    });
    ov.add(box);

    this.entryTitleLabel = new Text({
      x: bw / 2, y: 30,
      text: "",
      font: mob ? "bold 24px sans-serif" : "bold 22px sans-serif",
      color: TEXT_PRIMARY, align: "center", baseline: "middle",
    });
    box.add(this.entryTitleLabel);

    const fieldW = bw - 60;
    const fieldH = mob ? 64 : 52;
    const fieldX = (bw - fieldW) / 2;
    const fieldY = 70;

    const fieldPanel = new Panel({
      x: fieldX, y: fieldY, w: fieldW, h: fieldH,
      fill: "#0a1018", stroke: "#3a4d70", strokeWidth: 2, radius: 6,
    });
    box.add(fieldPanel);

    this.entryValueLabel = new Label({
      x: 0, y: 0, w: "100%", h: "100%",
      text: "",
      textOptions: {
        font: mob ? "22px monospace" : "20px monospace",
        color: TEXT_PRIMARY, align: "left", baseline: "middle",
      },
    });
    this.entryValueLabel.text.x = 14;
    this.entryValueLabel.text.y = "50%";
    fieldPanel.add(this.entryValueLabel);

    this.entryHintLabel = new Text({
      x: bw / 2, y: fieldY + fieldH + 20,
      text: "",
      font: mob ? "16px monospace" : "14px monospace",
      color: TEXT_SECONDARY, align: "center", baseline: "middle",
    });
    box.add(this.entryHintLabel);

    const cW = mob ? 200 : 160;
    const cH = mob ? 60 : 52;
    const cGap = 16;
    const totalCW = cW * 2 + cGap;
    const cX0 = (bw - totalCW) / 2;
    const cY = bh - cH - 20;

    this.entryConfirmBtn = new Button({
      x: cX0, y: cY, w: cW, h: cH,
      text: "Confirm",
      fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: mob ? "bold 22px sans-serif" : "bold 20px sans-serif", color: "#ffffff" },
      onClick: () => this._confirmEntry(),
    });
    box.add(this.entryConfirmBtn);

    this.entryCancelBtn = new Button({
      x: cX0 + cW + cGap, y: cY, w: cW, h: cH,
      text: "Cancel",
      fill: BTN_RED_FILL, stroke: BTN_RED_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: mob ? "bold 22px sans-serif" : "bold 20px sans-serif", color: "#ffffff" },
      onClick: () => this._closeEntry(),
    });
    box.add(this.entryCancelBtn);

    // Optional on-canvas keyboard (mobile).
    if (mob) {
      const kbW = W - 80;
      const kbH_guess = 200;
      const kbY = by + bh + 20;
      const kbH_avail = H - kbY - 10;
      if (kbH_avail >= kbH_guess) {
        this.entryKeyboard = new Keyboard({
          x: 40, y: kbY, w: kbW,
          onKey: (ch) => this._handleEntryKey({ key: ch, length: 1 }),
        });
        ov.add(this.entryKeyboard);
      } else {
        this.entryKeyboard = null;
      }
    } else {
      this.entryKeyboard = null;
    }

    return ov;
  }

  _openEntry(target, title, password) {
    this.entryOpen     = true;
    this.entryTarget   = target;
    this.entryTitle    = title;
    this.entryPassword = !!password;
    this.entryBuffer   = "";
    this.entryHintLabel.text = "";
    this._entryOverlay.visible = true;
    this._cursorOn    = true;
    this._cursorTimer = 0;
    this._refreshEntry();
  }

  _closeEntry() {
    this.entryOpen   = false;
    this.entryTarget = null;
    this.entryBuffer = "";
    if (this._entryOverlay) this._entryOverlay.visible = false;
  }

  _refreshEntry() {
    if (!this.entryOpen) return;
    if (this.entryTitleLabel) this.entryTitleLabel.text = this.entryTitle;
    if (this.entryPassword) {
      this._renderPasswordField(this.entryValueLabel, this.entryBuffer);
    } else {
      this._renderField(this.entryValueLabel, this.entryBuffer);
    }
  }

  _handleEntryKey(e) {
    if (!this.entryOpen) return;
    const k = e.key;
    if (k === "Backspace") {
      this.entryBuffer = this.entryBuffer.slice(0, -1);
      this._refreshEntry();
      return;
    }
    if (k === "Enter")   { this._confirmEntry(); return; }
    if (k === "Escape")  { this._closeEntry();   return; }
    if (k.length === 1) {
      this.entryBuffer += k;
      this._refreshEntry();
    }
  }

  async _confirmEntry() {
    const v = this.entryBuffer;
    const target = this.entryTarget;
    if (!target) { this._closeEntry(); return; }

    if (target === "loginUsername") {
      this.loginUsername = v;
      this.loginError    = "";
      this._closeEntry();
      this._refreshLoginScreen();
      return;
    }

    if (target === "loginPassword") {
      this.loginPassword = v;
      this.loginError    = "";
      this._closeEntry();
      this._refreshLoginScreen();
      return;
    }

    if (target === "createUsername") {
      if (!v) { this.entryHintLabel.text = "Cannot be empty."; return; }
      this.entryHintLabel.text = "Checking...";
      let taken = false;
      try {
        const r = await this._readAccounts();
        taken = !!this._findAccount(r.accounts, v);
      } catch (e) {
        this.entryHintLabel.text = "Check failed. Try again.";
        return;
      }
      if (taken) {
        this.entryHintLabel.text = "That username is taken.";
        this.createUsernameState = "taken";
        return;
      }
      this.createUsername = v;
      this.createUsernameState = "available";
      this._closeEntry();
      this._refreshCreateScreen();
      return;
    }

    if (target === "createPassword") {
      if (!v) { this.entryHintLabel.text = "Cannot be empty."; return; }
      this.createPassword = v;
      this._closeEntry();
      this._refreshCreateScreen();
      return;
    }

    if (target === "createEmail") {
      this.createEmail = v;
      this._closeEntry();
      this._refreshCreateScreen();
      return;
    }

    if (target === "displayName") {
      if (!v) { this.entryHintLabel.text = "Cannot be empty."; return; }
      this._closeEntry();
      await this._saveDisplayName(v);
      return;
    }

    this._closeEntry();
  }

  // =================================================================
  // Login screen.
  // =================================================================

  _buildLoginScreen() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mob = this.mobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: BG_SCREEN, stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: BTN_RED_FILL, stroke: BTN_RED_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this.exit(),
    }));

    screen.add(new Text({
      x: W / 2, y: mob ? 120 : 90,
      text: "Texas Hold'em Poker",
      font: mob ? "bold 44px sans-serif" : "bold 40px sans-serif",
      color: TEXT_PRIMARY, align: "center", baseline: "middle",
    }));

    const boxW = mob ? W - 80 : 540;
    const boxH = mob ? 480 : 420;
    const boxX = (W - boxW) / 2;
    const boxY = mob ? 200 : 170;

    const box = new Panel({
      x: boxX, y: boxY, w: boxW, h: boxH,
      fill: "#a8e0e8", stroke: "#000000", strokeWidth: 3, radius: 12,
    });
    screen.add(box);

    box.add(new Text({
      x: boxW / 2, y: 30,
      text: "Log In",
      font: mob ? "bold 30px sans-serif" : "bold 26px sans-serif",
      color: "#101820", align: "center", baseline: "middle",
    }));

    const fieldH = mob ? 60 : 48;
    const row1Y = mob ? 80 : 70;
    const row2Y = row1Y + fieldH + 16;
    const labelW = mob ? 140 : 130;

    box.add(new Text({
      x: 20, y: row1Y + fieldH / 2,
      text: "Username:",
      font: mob ? "bold 22px sans-serif" : "bold 18px sans-serif",
      color: "#101820", align: "left", baseline: "middle",
    }));
    this.loginUsernameBtn = new Button({
      x: labelW, y: row1Y, w: boxW - labelW - 20, h: fieldH,
      text: "(click to enter)",
      fill: "#ffffff", stroke: "#000000", strokeWidth: 2, radius: 4,
      textOptions: { font: mob ? "20px monospace" : "18px monospace", color: "#101820" },
      onClick: () => this._openEntry("loginUsername", "Enter Username", false),
    });
    box.add(this.loginUsernameBtn);

    box.add(new Text({
      x: 20, y: row2Y + fieldH / 2,
      text: "Password:",
      font: mob ? "bold 22px sans-serif" : "bold 18px sans-serif",
      color: "#101820", align: "left", baseline: "middle",
    }));
    this.loginPasswordBtn = new Button({
      x: labelW, y: row2Y, w: boxW - labelW - 20, h: fieldH,
      text: "(click to enter)",
      fill: "#ffffff", stroke: "#000000", strokeWidth: 2, radius: 4,
      textOptions: { font: mob ? "20px monospace" : "18px monospace", color: "#101820" },
      onClick: () => this._openEntry("loginPassword", "Enter Password", true),
    });
    box.add(this.loginPasswordBtn);

    this.loginErrorLabel = new Text({
      x: boxW / 2, y: row2Y + fieldH + 24,
      text: "",
      font: mob ? "16px monospace" : "14px monospace",
      color: "#c02020", align: "center", baseline: "middle",
    });
    box.add(this.loginErrorLabel);

    const btnW = mob ? 240 : 200;
    const btnH = mob ? 64 : 52;
    const btnX = (boxW - btnW) / 2;
    const btnY1 = row2Y + fieldH + 56;
    const btnY2 = btnY1 + btnH + 20;

    this.loginBtn = new Button({
      x: btnX, y: btnY1, w: btnW, h: btnH,
      text: "Log In",
      fill: "#7ec8e8", stroke: "#2a4a80", strokeWidth: 2, radius: 10,
      textOptions: { font: mob ? "bold 24px sans-serif" : "bold 20px sans-serif", color: "#101820" },
      onClick: () => this._submitLogin(),
    });
    box.add(this.loginBtn);

    box.add(new Button({
      x: btnX, y: btnY2, w: btnW, h: btnH,
      text: "Create Account",
      fill: "#7ec8e8", stroke: "#2a4a80", strokeWidth: 2, radius: 10,
      textOptions: { font: mob ? "bold 22px sans-serif" : "bold 18px sans-serif", color: "#101820" },
      onClick: () => {
        this.createUsername = "";
        this.createPassword = "";
        this.createEmail    = "";
        this.createUsernameState = "empty";
        this.createError    = "";
        this._pushScreen("create");
        this._refreshCreateScreen();
      },
    }));

    box.add(new Text({
      x: boxW / 2, y: btnY2 + btnH + 26,
      text: "Forgot password?",
      font: mob ? "bold 18px sans-serif" : "16px sans-serif",
      color: "#101820", align: "center", baseline: "middle",
    }));

    box.add(new Button({
      x: (boxW - 180) / 2, y: btnY2 + btnH + 46, w: 180, h: mob ? 44 : 36,
      text: "Reset password",
      fill: "#a8e0e8", stroke: "#2a4a80", strokeWidth: 1, radius: 6,
      textOptions: { font: mob ? "bold 16px sans-serif" : "14px sans-serif", color: "#101820" },
      onClick: () => {
        this.loginError = "Password reset is not available yet.";
        this._refreshLoginScreen();
      },
    }));

    return screen;
  }

  _refreshLoginScreen() {
    if (this.loginUsernameBtn) {
      this.loginUsernameBtn.setText(this.loginUsername || "(click to enter)");
    }
    if (this.loginPasswordBtn) {
      const stars = "*".repeat(this.loginPassword.length);
      this.loginPasswordBtn.setText(stars || "(click to enter)");
    }
    if (this.loginErrorLabel) this.loginErrorLabel.text = this.loginError || "";
    if (this.loginBtn) {
      if (this._loggingIn) this._busyStart(this.loginBtn);
      else this._busyEnd(this.loginBtn);
    }
  }

  // =================================================================
  // Create Account screen.
  // =================================================================

  _buildCreateScreen() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mob = this.mobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: BG_SCREEN, stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: BTN_RED_FILL, stroke: BTN_RED_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => {
        this.createUsername = "";
        this.createPassword = "";
        this.createEmail    = "";
        this.createUsernameState = "empty";
        this.createError    = "";
        this._popScreen();
      },
    }));

    screen.add(new Text({
      x: W / 2, y: mob ? 120 : 90,
      text: "Texas Hold'em Poker",
      font: mob ? "bold 44px sans-serif" : "bold 40px sans-serif",
      color: TEXT_PRIMARY, align: "center", baseline: "middle",
    }));

    const boxW = mob ? W - 80 : 620;
    const boxH = mob ? 600 : 500;
    const boxX = (W - boxW) / 2;
    const boxY = mob ? 190 : 160;

    const box = new Panel({
      x: boxX, y: boxY, w: boxW, h: boxH,
      fill: "#a8e0e8", stroke: "#000000", strokeWidth: 3, radius: 12,
    });
    screen.add(box);

    box.add(new Text({
      x: boxW / 2, y: 30,
      text: "Create Account",
      font: mob ? "bold 30px sans-serif" : "bold 26px sans-serif",
      color: "#101820", align: "center", baseline: "middle",
    }));

    const fieldH = mob ? 56 : 44;
    const labelW = mob ? 180 : 170;
    const row1Y = mob ? 76 : 68;
    const row2Y = row1Y + fieldH + 16;
    const row3Y = row2Y + fieldH + 16;

    box.add(new Text({
      x: 20, y: row1Y + fieldH / 2,
      text: "Username:",
      font: mob ? "bold 22px sans-serif" : "bold 18px sans-serif",
      color: "#101820", align: "left", baseline: "middle",
    }));
    this.createUsernameBtn = new Button({
      x: labelW, y: row1Y, w: boxW - labelW - 20, h: fieldH,
      text: "(click to enter)",
      fill: "#ffffff", stroke: "#000000", strokeWidth: 2, radius: 4,
      textOptions: { font: mob ? "20px monospace" : "18px monospace", color: "#101820" },
      onClick: () => this._openEntry("createUsername", "Enter Username", false),
    });
    box.add(this.createUsernameBtn);

    box.add(new Text({
      x: 20, y: row2Y + fieldH / 2,
      text: "Password:",
      font: mob ? "bold 22px sans-serif" : "bold 18px sans-serif",
      color: "#101820", align: "left", baseline: "middle",
    }));
    this.createPasswordBtn = new Button({
      x: labelW, y: row2Y, w: boxW - labelW - 20, h: fieldH,
      text: "(click to enter)",
      fill: "#ffffff", stroke: "#000000", strokeWidth: 2, radius: 4,
      textOptions: { font: mob ? "20px monospace" : "18px monospace", color: "#101820" },
      onClick: () => this._openEntry("createPassword", "Enter Password", true),
    });
    box.add(this.createPasswordBtn);

    box.add(new Text({
      x: 20, y: row3Y + fieldH / 2,
      text: "Email (optional):",
      font: mob ? "bold 18px sans-serif" : "bold 16px sans-serif",
      color: "#101820", align: "left", baseline: "middle",
    }));
    this.createEmailBtn = new Button({
      x: labelW, y: row3Y, w: boxW - labelW - 20, h: fieldH,
      text: "(click to enter)",
      fill: "#ffffff", stroke: "#000000", strokeWidth: 2, radius: 4,
      textOptions: { font: mob ? "20px monospace" : "18px monospace", color: "#101820" },
      onClick: () => this._openEntry("createEmail", "Enter Email (optional)", false),
    });
    box.add(this.createEmailBtn);

    box.add(new Text({
      x: labelW + 4, y: row3Y + fieldH + 6,
      text: "Note: if you want your account to be recoverable,",
      font: mob ? "13px sans-serif" : "12px sans-serif",
      color: "#101820", align: "left", baseline: "top",
    }));
    box.add(new Text({
      x: labelW + 4, y: row3Y + fieldH + 22,
      text: "provide an email address now.",
      font: mob ? "13px sans-serif" : "12px sans-serif",
      color: "#101820", align: "left", baseline: "top",
    }));

    const warnY = row3Y + fieldH + 56;
    box.add(new Text({
      x: boxW / 2, y: warnY,
      text: "Not secure. Do not use a real password.",
      font: mob ? "bold 16px sans-serif" : "bold 14px sans-serif",
      color: "#8a2020", align: "center", baseline: "middle",
    }));
    box.add(new Text({
      x: boxW / 2, y: warnY + 22,
      text: "Feel free to reuse your username as your password.",
      font: mob ? "14px sans-serif" : "12px sans-serif",
      color: "#8a2020", align: "center", baseline: "middle",
    }));

    this.createErrorLabel = new Text({
      x: boxW / 2, y: warnY + 50,
      text: "",
      font: mob ? "16px monospace" : "14px monospace",
      color: "#c02020", align: "center", baseline: "middle",
    });
    box.add(this.createErrorLabel);

    const btnW = mob ? 260 : 220;
    const btnH = mob ? 64 : 52;
    const btnX = (boxW - btnW) / 2;
    const btnY = warnY + 80;

    this.createSubmitBtn = new Button({
      x: btnX, y: btnY, w: btnW, h: btnH,
      text: "Create Account",
      fill: "#7ec8e8", stroke: "#2a4a80", strokeWidth: 2, radius: 10,
      textOptions: { font: mob ? "bold 22px sans-serif" : "bold 20px sans-serif", color: "#101820" },
      onClick: () => this._submitCreateAccount(),
    });
    box.add(this.createSubmitBtn);

    return screen;
  }

  _refreshCreateScreen() {
    if (this.createUsernameBtn) {
      this.createUsernameBtn.setText(this.createUsername || "(click to enter)");
      if (this.createUsernameState === "available") {
        this.createUsernameBtn.setBaseStyle({ fill: "#c8f0c8", stroke: "#2a8a2a" });
      } else if (this.createUsernameState === "taken") {
        this.createUsernameBtn.setBaseStyle({ fill: "#f0c8c8", stroke: "#8a2020" });
      } else {
        this.createUsernameBtn.setBaseStyle({ fill: "#ffffff", stroke: "#000000" });
      }
    }
    if (this.createPasswordBtn) {
      const stars = "*".repeat(this.createPassword.length);
      this.createPasswordBtn.setText(stars || "(click to enter)");
    }
    if (this.createEmailBtn) {
      this.createEmailBtn.setText(this.createEmail || "(click to enter)");
    }
    if (this.createErrorLabel) this.createErrorLabel.text = this.createError || "";

    if (this.createSubmitBtn) {
      if (this._creating) {
        this._busyStart(this.createSubmitBtn);
      } else if (!this._canCreateAccount()) {
        this.createSubmitBtn.setBusy(true);
        this.createSubmitBtn.self.fill   = BUSY_FILL;
        this.createSubmitBtn.self.stroke = BUSY_STROKE;
      } else {
        this._busyEnd(this.createSubmitBtn);
      }
    }
  }

  // =================================================================
  // Main menu.
  // =================================================================

  _buildMenuScreen() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mob = this.mobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: BG_SCREEN, stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: BTN_RED_FILL, stroke: BTN_RED_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._logout(),
    }));

    screen.add(new Text({
      x: W / 2, y: mob ? 120 : 90,
      text: "Texas Hold'em Poker",
      font: mob ? "bold 44px sans-serif" : "bold 40px sans-serif",
      color: TEXT_PRIMARY, align: "center", baseline: "middle",
    }));

    const boxW = mob ? W - 80 : 540;
    const boxH = mob ? 480 : 400;
    const boxX = (W - boxW) / 2;
    const boxY = mob ? 210 : 170;

    const box = new Panel({
      x: boxX, y: boxY, w: boxW, h: boxH,
      fill: "#a8e0e8", stroke: "#000000", strokeWidth: 3, radius: 12,
    });
    screen.add(box);

    const btnW = mob ? boxW - 60 : boxW - 80;
    const btnH = mob ? 72 : 60;
    const gap  = mob ? 18 : 16;
    const btnX = (boxW - btnW) / 2;
    const startY = 30;

    const mkBtn = (label, y, onClick) => new Button({
      x: btnX, y, w: btnW, h: btnH,
      text: label,
      fill: "#7ec8e8", stroke: "#2a4a80", strokeWidth: 2, radius: 10,
      textOptions: { font: mob ? "bold 26px sans-serif" : "bold 22px sans-serif", color: "#101820" },
      onClick,
    });

    box.add(mkBtn("Singleplayer",    startY + 0 * (btnH + gap), () => this._pushScreen("spMode")));
    box.add(mkBtn("Multiplayer",     startY + 1 * (btnH + gap), () => { this._pushScreen("mpRooms"); this._refreshMPRooms(); }));
    box.add(mkBtn("Account Balance", startY + 2 * (btnH + gap), () => { this._pushScreen("balance"); this._refreshBalanceScreen(); }));
    box.add(mkBtn("Options",         startY + 3 * (btnH + gap), () => { this._pushScreen("options"); this._refreshOptionsScreen(); }));

    screen.add(new Text({
      x: 30, y: H - 90,
      text: "Welcome:",
      font: "16px sans-serif",
      color: TEXT_SECONDARY, align: "left", baseline: "middle",
    }));
    this.menuUsernameLabel = new Text({
      x: 30, y: H - 68,
      text: "",
      font: "bold 18px monospace",
      color: TEXT_PRIMARY, align: "left", baseline: "middle",
    });
    screen.add(this.menuUsernameLabel);

    screen.add(new Text({
      x: W - 30, y: H - 90,
      text: "Bank total:",
      font: "16px sans-serif",
      color: TEXT_SECONDARY, align: "right", baseline: "middle",
    }));
    this.menuBankValue = new Text({
      x: W - 30, y: H - 68,
      text: "",
      font: "bold 22px monospace",
      color: TEXT_MONEY, align: "right", baseline: "middle",
    });
    screen.add(this.menuBankValue);

    return screen;
  }

  _refreshMenuLabels() {
    if (!this.account) return;
    this.menuUsernameLabel.text = this.account.username;
    this.menuBankValue.text     = formatMoney(this.account.bank);
  }

  // =================================================================
  // Options.
  // =================================================================

  _buildOptionsScreen() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mob = this.mobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: BG_SCREEN, stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => { this.optionsField = null; this._popScreen(); this._refreshMenuLabels(); },
    }));

    screen.add(new Text({
      x: W / 2, y: mob ? 120 : 90,
      text: "Options",
      font: mob ? "bold 40px sans-serif" : "bold 36px sans-serif",
      color: TEXT_PRIMARY, align: "center", baseline: "middle",
    }));

    const boxW = mob ? W - 80 : 540;
    const boxH = mob ? 420 : 300;
    const boxX = (W - boxW) / 2;
    const boxY = mob ? 210 : 170;

    const box = new Panel({
      x: boxX, y: boxY, w: boxW, h: boxH,
      fill: "#a8e0e8", stroke: "#000000", strokeWidth: 3, radius: 12,
    });
    screen.add(box);

    const btnW = boxW - 60;
    const btnH = mob ? 64 : 54;
    const btnX = (boxW - btnW) / 2;
    let y = 24;

    box.add(new Text({
      x: boxW / 2, y,
      text: "Display Name",
      font: mob ? "bold 22px sans-serif" : "bold 20px sans-serif",
      color: "#101820", align: "center", baseline: "middle",
    }));
    y += 30;

    this.displayNameBtn = new Button({
      x: btnX, y, w: btnW, h: btnH,
      text: "",
      fill: "#7ec8e8", stroke: "#2a4a80", strokeWidth: 2, radius: 10,
      textOptions: { font: mob ? "bold 22px sans-serif" : "bold 20px sans-serif", color: "#101820" },
      onClick: () => this._openEntry("displayName", "Enter New Display Name", false),
    });
    box.add(this.displayNameBtn);
    y += btnH + 16;

    if (mob) {
      box.add(new Text({
        x: boxW / 2, y,
        text: "Orientation",
        font: "bold 22px sans-serif",
        color: "#101820", align: "center", baseline: "middle",
      }));
      y += 30;

      this.orientationBtn = new Button({
        x: btnX, y, w: btnW, h: btnH,
        text: "",
        fill: "#7ec8e8", stroke: "#2a4a80", strokeWidth: 2, radius: 10,
        textOptions: { font: "bold 22px sans-serif", color: "#101820" },
        onClick: () => this._requestOrientationChange(),
      });
      box.add(this.orientationBtn);
      y += btnH + 16;
    } else {
      this.orientationBtn = null;
    }

    this.optionsErrorLabel = new Text({
      x: boxW / 2, y: y + 10,
      text: "",
      font: mob ? "16px sans-serif" : "14px sans-serif",
      color: "#8a2020", align: "center", baseline: "middle",
    });
    box.add(this.optionsErrorLabel);

    return screen;
  }

  _refreshOptionsScreen() {
    if (this.displayNameBtn && this.account) {
      this.displayNameBtn.setText("Display Name: " + this.account.displayName);
    }
    if (this.orientationBtn) {
      this.orientationBtn.setText("Orientation Mode: " + this.orientation);
    }
  }

  async _saveDisplayName(name) {
    if (!name) return;
    if (!this.account) return;

    this.optionsErrorLabel.text = "Saving...";
    try {
      let updated = null;
      await this._serialize(async () => {
        const ctx = await this._fetchTreeContext();
        const entry = ctx.entries.get(ACCOUNTS_FILE);
        let content = "";
        if (entry) content = await this._readBlob(entry.sha);
        const lines = content ? content.split("\n").filter(l => l.length > 0) : [];
        const accounts = [];
        for (const line of lines) {
          const a = this._decAccountLine(line);
          if (a) accounts.push(a);
        }
        const idx = accounts.findIndex(a => a.username.toLowerCase() === this.account.username.toLowerCase());
        if (idx < 0) return;
        accounts[idx].displayName = name;
        accounts[idx].lastSeenIso = nowIso();
        updated = accounts[idx];
        const body = accounts.map(a => this._encAccountLine(a)).join("\n") + "\n";
        const hint = { commitSha: ctx.commitSha, treeSha: ctx.treeSha, entries: ctx.entries, content };
        const result = await this._writeWithRetry(ACCOUNTS_FILE, () => body, "set display name", hint);
        if (!result.ok) updated = null;
      });

      if (updated) {
        this.account = updated;
        this.optionsErrorLabel.text = "";
        this._refreshOptionsScreen();
        this._refreshMenuLabels();
      } else {
        this.optionsErrorLabel.text = "Save failed.";
      }
    } catch (e) {
      this.optionsErrorLabel.text = "Save failed.";
    }
  }

  _requestOrientationChange() {
    if (!this.mobile) return;
    const next = this.orientation === "portrait" ? "landscape" : "portrait";

    const W = Viewport.width;
    const H = Viewport.height;
    if (!this._orientOverlay) {
      const ov = new Panel({
        x: 0, y: 0, w: "100%", h: "100%",
        self: new Rect({ fill: "rgba(0,0,0,0.55)", stroke: null }),
      });
      ov.visible = false;
      this.optionsScreen.add(ov);
      this._orientOverlay = ov;

      const bw = Math.min(W - 80, 520);
      const bh = 320;
      const bx = (W - bw) / 2;
      const by = (H - bh) / 2;

      const b = new Panel({
        x: bx, y: by, w: bw, h: bh,
        fill: BG_PANEL, stroke: STROKE_PANEL, strokeWidth: 3, radius: 12,
      });
      ov.add(b);

      b.add(new Text({
        x: bw / 2, y: 40,
        text: "Warning!",
        font: "bold 28px sans-serif",
        color: TEXT_ERROR, align: "center", baseline: "middle",
      }));
      b.add(new Text({
        x: bw / 2, y: 80,
        text: "Make sure you have locked",
        font: "18px sans-serif",
        color: TEXT_PRIMARY, align: "center", baseline: "middle",
      }));
      b.add(new Text({
        x: bw / 2, y: 104,
        text: "screen rotation first!",
        font: "18px sans-serif",
        color: TEXT_PRIMARY, align: "center", baseline: "middle",
      }));

      const pW = 180, pH = 60;
      const pY = bh - pH - 30;

      b.add(new Button({
        x: bw / 2 - pW - 10, y: pY, w: pW, h: pH,
        text: "Proceed",
        fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE, strokeWidth: 2, radius: 8,
        textOptions: { font: "bold 22px sans-serif", color: "#ffffff" },
        onClick: () => {
          this.orientation = next;
          this._orientOverlay.visible = false;
          this._refreshOptionsScreen();
        },
      }));
      b.add(new Button({
        x: bw / 2 + 10, y: pY, w: pW, h: pH,
        text: "Cancel",
        fill: BTN_RED_FILL, stroke: BTN_RED_STROKE, strokeWidth: 2, radius: 8,
        textOptions: { font: "bold 22px sans-serif", color: "#ffffff" },
        onClick: () => { this._orientOverlay.visible = false; },
      }));
    }
    this._orientOverlay.visible = true;
  }

  // =================================================================
  // Account Balance.
  // =================================================================

  _buildBalanceScreen() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mob = this.mobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: BG_SCREEN, stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._popScreen(),
    }));

    screen.add(new Text({
      x: W / 2, y: mob ? 120 : 90,
      text: "Account Balance",
      font: mob ? "bold 40px sans-serif" : "bold 36px sans-serif",
      color: TEXT_PRIMARY, align: "center", baseline: "middle",
    }));

    const boxW = mob ? W - 80 : 720;
    const boxH = mob ? 700 : 500;
    const boxX = (W - boxW) / 2;
    const boxY = mob ? 200 : 160;

    const box = new Panel({
      x: boxX, y: boxY, w: boxW, h: boxH,
      fill: "#a8e0e8", stroke: "#000000", strokeWidth: 3, radius: 12,
    });
    screen.add(box);

    box.add(new Text({
      x: 30, y: 40,
      text: "Bank total:",
      font: mob ? "bold 20px sans-serif" : "bold 18px sans-serif",
      color: "#101820", align: "left", baseline: "middle",
    }));
    this.balanceBankLabel = new Text({
      x: boxW - 30, y: 40,
      text: "",
      font: mob ? "bold 32px monospace" : "bold 28px monospace",
      color: "#1a6a20", align: "right", baseline: "middle",
    });
    box.add(this.balanceBankLabel);

    box.add(new Text({
      x: 30, y: 90,
      text: "Lifetime earnings:",
      font: mob ? "bold 18px sans-serif" : "bold 16px sans-serif",
      color: "#101820", align: "left", baseline: "middle",
    }));
    this.balanceLifetimeLabel = new Text({
      x: boxW - 30, y: 90,
      text: "",
      font: mob ? "bold 22px monospace" : "bold 20px monospace",
      color: "#101820", align: "right", baseline: "middle",
    });
    box.add(this.balanceLifetimeLabel);

    box.add(new Text({
      x: 30, y: 130,
      text: "Wins / Losses:",
      font: mob ? "bold 18px sans-serif" : "bold 16px sans-serif",
      color: "#101820", align: "left", baseline: "middle",
    }));
    this.balanceWL = new Text({
      x: boxW - 30, y: 130,
      text: "",
      font: mob ? "bold 22px monospace" : "bold 20px monospace",
      color: "#101820", align: "right", baseline: "middle",
    });
    box.add(this.balanceWL);

    box.add(new Text({
      x: 30, y: 170,
      text: "Hands played:",
      font: mob ? "bold 18px sans-serif" : "bold 16px sans-serif",
      color: "#101820", align: "left", baseline: "middle",
    }));
    this.balanceHands = new Text({
      x: boxW - 30, y: 170,
      text: "",
      font: mob ? "bold 22px monospace" : "bold 20px monospace",
      color: "#101820", align: "right", baseline: "middle",
    });
    box.add(this.balanceHands);

    const buyY = 220;
    box.add(new Text({
      x: boxW / 2, y: buyY,
      text: "Buy Chips:",
      font: mob ? "bold 26px sans-serif" : "bold 22px sans-serif",
      color: "#101820", align: "center", baseline: "middle",
    }));

    const cbW = mob ? 180 : 160;
    const cbH = mob ? 60 : 50;
    const cbGap = 12;
    const totalCBW = cbW * 3 + cbGap * 2;
    const cbX0 = (boxW - totalCBW) / 2;
    const cbY = buyY + 30;

    this.buyChipButtons = [];
    const amounts = [1000, 10000, 100000];
    for (let i = 0; i < 3; i++) {
      const b = new Button({
        x: cbX0 + i * (cbW + cbGap), y: cbY, w: cbW, h: cbH,
        text: formatMoney(amounts[i]),
        fill: "#7ec8e8", stroke: "#2a4a80", strokeWidth: 2, radius: 10,
        textOptions: { font: mob ? "bold 20px sans-serif" : "bold 18px sans-serif", color: "#101820" },
        onClick: () => { this.balancePendingBuy = amounts[i]; this._refreshBalanceScreen(); },
      });
      box.add(b);
      this.buyChipButtons.push(b);
    }

    this.balanceConfirmLabel = new Text({
      x: boxW / 2, y: cbY + cbH + 24,
      text: "",
      font: mob ? "bold 20px sans-serif" : "bold 18px sans-serif",
      color: "#101820", align: "center", baseline: "middle",
    });
    box.add(this.balanceConfirmLabel);

    const cW = mob ? 160 : 140;
    const cH = mob ? 60 : 50;
    this.balanceYesBtn = new Button({
      x: boxW / 2 - cW - 8, y: cbY + cbH + 46, w: cW, h: cH,
      text: "Yes",
      fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: mob ? "bold 22px sans-serif" : "bold 20px sans-serif", color: "#ffffff" },
      onClick: () => this._confirmBuyChips(this.balancePendingBuy),
    });
    box.add(this.balanceYesBtn);

    this.balanceNoBtn = new Button({
      x: boxW / 2 + 8, y: cbY + cbH + 46, w: cW, h: cH,
      text: "No",
      fill: BTN_RED_FILL, stroke: BTN_RED_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: mob ? "bold 22px sans-serif" : "bold 20px sans-serif", color: "#ffffff" },
      onClick: () => { this.balancePendingBuy = 0; this._refreshBalanceScreen(); },
    });
    box.add(this.balanceNoBtn);

    this.balanceStatusLabel = new Text({
      x: boxW / 2, y: cbY + cbH + 118,
      text: "",
      font: mob ? "16px monospace" : "14px monospace",
      color: "#101820", align: "center", baseline: "middle",
    });
    box.add(this.balanceStatusLabel);

    return screen;
  }

  _refreshBalanceScreen() {
    if (!this.account) return;
    this.balanceBankLabel.text     = formatMoney(this.account.bank);
    this.balanceLifetimeLabel.text = formatMoney(this.account.lifetime);
    this.balanceLifetimeLabel.color = this.account.lifetime < 0 ? "#c02020" : "#1a6a20";
    this.balanceWL.text     = this.account.wins + " / " + this.account.losses;
    this.balanceHands.text  = String(this.account.handsPlayed);

    if (this.balancePendingBuy > 0) {
      this.balanceConfirmLabel.text = "Confirm buy " + formatMoney(this.balancePendingBuy) + "?";
      this.balanceYesBtn.visible = true;
      this.balanceNoBtn.visible  = true;
    } else {
      this.balanceConfirmLabel.text = "";
      this.balanceYesBtn.visible = false;
      this.balanceNoBtn.visible  = false;
    }

    if (this._buyingChips) this._busyStart(this.balanceYesBtn);

    for (const b of this.buyChipButtons) {
      if (this._buyingChips) {
        b.setBusy(true);
        b.self.fill   = BUSY_FILL;
        b.self.stroke = BUSY_STROKE;
      } else {
        b.setBusy(false);
        b.setBaseStyle({ fill: "#7ec8e8", stroke: "#2a4a80" });
      }
    }
  }

  _setStatus(msg) {
    if (this.balanceStatusLabel) this.balanceStatusLabel.text = msg || "";
    if (this.tableStatusLabel)   this.tableStatusLabel.text   = msg || "";
  }

  // =================================================================
  // SP mode screen.
  // =================================================================

  _buildSPModeScreen() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mob = this.mobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: BG_SCREEN, stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._popScreen(),
    }));

    screen.add(new Text({
      x: W / 2, y: mob ? 140 : 110,
      text: "Singleplayer",
      font: mob ? "bold 42px sans-serif" : "bold 38px sans-serif",
      color: TEXT_PRIMARY, align: "center", baseline: "middle",
    }));

    const boxW = mob ? W - 80 : 480;
    const boxH = mob ? 360 : 300;
    const boxX = (W - boxW) / 2;
    const boxY = mob ? 240 : 200;

    const box = new Panel({
      x: boxX, y: boxY, w: boxW, h: boxH,
      fill: BG_PANEL, stroke: STROKE_PANEL, strokeWidth: 2, radius: 12,
    });
    screen.add(box);

    const btnW = boxW - 60;
    const btnH = mob ? 80 : 64;
    const btnX = (boxW - btnW) / 2;

    box.add(new Button({
      x: btnX, y: 40, w: btnW, h: btnH,
      text: "Classic",
      fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE, strokeWidth: 2, radius: 10,
      textOptions: { font: mob ? "bold 28px sans-serif" : "bold 24px sans-serif", color: "#ffffff" },
      onClick: () => { this._pushScreen("spTier"); },
    }));

    box.add(new Button({
      x: btnX, y: 40 + btnH + 24, w: btnW, h: btnH,
      text: "Spin-to-Win",
      fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 2, radius: 10,
      textOptions: { font: mob ? "bold 28px sans-serif" : "bold 24px sans-serif", color: "#ffffff" },
      onClick: () => {
        this.spinStubLabel.text = "Coming soon";
        setTimeout(() => { this.spinStubLabel.text = ""; }, 1500);
      },
    }));

    this.spinStubLabel = new Text({
      x: boxW / 2, y: boxH - 30,
      text: "",
      font: mob ? "18px sans-serif" : "16px sans-serif",
      color: TEXT_DIM, align: "center", baseline: "middle",
    });
    box.add(this.spinStubLabel);

    return screen;
  }

  // =================================================================
  // SP tier select.
  // =================================================================

  _buildSPTierScreen() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mob = this.mobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: BG_SCREEN, stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._popScreen(),
    }));

    screen.add(new Text({
      x: W / 2, y: mob ? 120 : 90,
      text: "Choose table limits:",
      font: mob ? "bold 32px sans-serif" : "bold 28px sans-serif",
      color: TEXT_PRIMARY, align: "center", baseline: "middle",
    }));

    const boxW = mob ? W - 80 : 540;
    const boxH = mob ? 560 : 440;
    const boxX = (W - boxW) / 2;
    const boxY = mob ? 200 : 170;

    const box = new Panel({
      x: boxX, y: boxY, w: boxW, h: boxH,
      fill: BG_PANEL, stroke: STROKE_PANEL, strokeWidth: 2, radius: 12,
    });
    screen.add(box);

    const btnW = boxW - 60;
    const btnH = mob ? 80 : 64;
    const btnX = (boxW - btnW) / 2;
    let y = 30;

    for (const tier of TABLE_TIERS) {
      const label = tier.label + "  (max buy-in " + formatMoney(tier.maxBuyIn) + ")";
      box.add(new Button({
        x: btnX, y, w: btnW, h: btnH,
        text: label,
        fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 2, radius: 10,
        textOptions: { font: mob ? "bold 20px sans-serif" : "bold 18px sans-serif", color: "#ffffff" },
        onClick: () => {
          this.spTierChoice = tier;
          this._pushScreen("spCount");
        },
      }));
      y += btnH + 16;
    }

    return screen;
  }

  // =================================================================
  // SP opponent count.
  // =================================================================

  _buildSPCountScreen() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mob = this.mobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: BG_SCREEN, stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._popScreen(),
    }));

    screen.add(new Text({
      x: W / 2, y: mob ? 100 : 80,
      text: "Number of opponents:",
      font: mob ? "bold 32px sans-serif" : "bold 28px sans-serif",
      color: TEXT_PRIMARY, align: "center", baseline: "middle",
    }));

    this.spCountPickLabel = new Text({
      x: W / 2, y: mob ? 150 : 120,
      text: "1",
      font: mob ? "bold 44px monospace" : "bold 40px monospace",
      color: TEXT_TURN, align: "center", baseline: "middle",
    });
    screen.add(this.spCountPickLabel);

    const gridTop = mob ? 220 : 180;
    const cols = 5;
    const cellW = mob ? 110 : 100;
    const cellH = mob ? 90 : 80;
    const gapX  = 14;
    const gapY  = 14;
    const totalW = cols * cellW + (cols - 1) * gapX;
    const gridX = (W - totalW) / 2;

    for (let i = 0; i < 10; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = gridX + col * (cellW + gapX);
      const y = gridTop + row * (cellH + gapY);
      const n = i + 1;
      screen.add(new Button({
        x, y, w: cellW, h: cellH,
        text: String(n),
        fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 2, radius: 10,
        textOptions: { font: mob ? "bold 32px sans-serif" : "bold 28px sans-serif", color: "#ffffff" },
        onClick: () => {
          this.spCountPickLabel.text = String(n);
          this._spCountPick = n;
        },
      }));
    }

    this._spCountPick = 1;

    const goW = mob ? 320 : 280;
    const goH = mob ? 80 : 64;
    screen.add(new Button({
      x: (W - goW) / 2, y: mob ? H - 180 : H - 140, w: goW, h: goH,
      text: "Start Game",
      fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE, strokeWidth: 2, radius: 10,
      textOptions: { font: mob ? "bold 28px sans-serif" : "bold 24px sans-serif", color: "#ffffff" },
      onClick: () => this._startSPGame(),
    }));

    return screen;
  }

  // =================================================================
  // MP room list.
  // =================================================================

  _buildMPRoomScreen() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mob = this.mobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: BG_SCREEN, stroke: null,
    });

    screen.add(new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Return",
      fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._popScreen(),
    }));

    screen.add(new Button({
      x: W - 164, y: 24, w: 140, h: 48,
      text: "Update",
      fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._manualUpdateRoomList(),
    }));

    screen.add(new Text({
      x: W / 2, y: mob ? 100 : 80,
      text: "Multiplayer Tables",
      font: mob ? "bold 34px sans-serif" : "bold 30px sans-serif",
      color: TEXT_PRIMARY, align: "center", baseline: "middle",
    }));

    this.mpRoomStatusLabel = new Text({
      x: 180, y: 48,
      text: "",
      font: "14px monospace",
      color: TEXT_SECONDARY, align: "left", baseline: "middle",
    });
    screen.add(this.mpRoomStatusLabel);

    const boxW = mob ? W - 80 : 620;
    const boxH = mob ? 620 : 460;
    const boxX = (W - boxW) / 2;
    const boxY = mob ? 160 : 140;

    const box = new Panel({
      x: boxX, y: boxY, w: boxW, h: boxH,
      fill: BG_PANEL, stroke: STROKE_PANEL, strokeWidth: 2, radius: 12,
    });
    screen.add(box);

    const btnW = boxW - 60;
    const btnH = mob ? 100 : 84;
    const btnX = (boxW - btnW) / 2;
    let y = 30;

    this.mpRoomButtons = {};
    for (const room of MP_ROOMS) {
      const b = new Button({
        x: btnX, y, w: btnW, h: btnH,
        text: room.label + "  ?/11",
        fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 2, radius: 10,
        textOptions: { font: mob ? "bold 24px sans-serif" : "bold 22px sans-serif", color: "#ffffff" },
        onClick: () => this._joinMultiplayerRoom(room),
      });
      box.add(b);
      this.mpRoomButtons[room.key] = b;
      y += btnH + 16;
    }

    return screen;
  }

  async _refreshMPRooms() {
    for (const room of MP_ROOMS) {
      this.mpRoomButtons[room.key].setText(room.label + "  ?/11");
    }
    try {
      const counts = await this._readAllRoomCounts();
      for (const room of MP_ROOMS) {
        const n = counts[room.key] || 0;
        this.mpRoomButtons[room.key].setText(room.label + "  " + n + "/11");
      }
    } catch (e) {
      this.mpRoomStatusLabel.text = "Could not read rooms.";
    }
  }

  async _readAllRoomCounts() {
    return await this._serialize(async () => {
      const ctx = await this._fetchTreeContext();
      const out = {};
      for (const room of MP_ROOMS) {
        const path  = DATA_ROOT + room.key + "/presence.txt";
        const entry = ctx.entries.get(path);
        let content = "";
        if (entry) content = await this._readBlob(entry.sha);
        out[room.key] = this._countPresent(content, SEATS);
      }
      return out;
    });
  }

  async _manualUpdateRoomList() {
    this.mpRoomStatusLabel.text = "Updating...";
    await this._refreshMPRooms();
    this.mpRoomStatusLabel.text = "";
  }

  // =================================================================
  // Table screen.
  // =================================================================

  _buildTableScreen() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mob = this.mobile;

    const screen = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: BG_SCREEN, stroke: null,
    });

    this.leaveBtn = new Button({
      x: 24, y: 24, w: 140, h: 48,
      text: "Leave",
      fill: BTN_RED_FILL, stroke: BTN_RED_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._leaveTable(),
    });
    screen.add(this.leaveBtn);

    this.tableTitleLabel = new Text({
      x: W / 2, y: 36,
      text: "",
      font: mob ? "bold 20px sans-serif" : "bold 18px sans-serif",
      color: TEXT_PRIMARY, align: "center", baseline: "middle",
    });
    screen.add(this.tableTitleLabel);

    this.tableStatusLabel = new Text({
      x: 180, y: 36,
      text: "",
      font: "14px monospace",
      color: TEXT_SECONDARY, align: "left", baseline: "middle",
    });
    screen.add(this.tableStatusLabel);

    this.tableBankLabel = new Text({
      x: W - 24, y: 36,
      text: "",
      font: "bold 18px monospace",
      color: TEXT_MONEY, align: "right", baseline: "middle",
    });
    screen.add(this.tableBankLabel);

    // Top-down vertical budget.
    //
    // Header: 80px from top.
    // Action-row strip: reserved at bottom of the layout area.
    // Felt: whatever is left in the middle.
    //
    // This guarantees the action row and raise entry panel are
    // always on-screen regardless of virtual height.
    const headerH = 80;
    const actionStripH = mob ? 300 : 260;
    const feltW_max = mob ? W - 40 : Math.min(W - 200, 900);

    const layoutTop    = headerH;
    const layoutBottom = H;
    const feltTop      = layoutTop + 10;
    const feltBottom   = layoutBottom - actionStripH;
    const feltH        = Math.max(180, feltBottom - feltTop);
    const feltW        = feltW_max;
    const feltX        = (W - feltW) / 2;
    const feltY        = feltTop;

    this._feltW = feltW;
    this._feltH = feltH;
    this._feltX = feltX;
    this._feltY = feltY;
    this._actionStripH = actionStripH;

    const felt = new Composite({ x: feltX, y: feltY, w: feltW, h: feltH });
    screen.add(felt);
    this._felt = felt;

    felt.add(new Circle({
      x: -8, y: -8, w: feltW + 16, h: feltH + 16,
      fill: FELT_EDGE, stroke: "#000000", strokeWidth: 2,
    }));
    felt.add(new Circle({
      x: 0, y: 0, w: feltW, h: feltH,
      fill: FELT_GREEN, stroke: null,
    }));
    felt.add(new Circle({
      x: feltW * 0.06, y: feltH * 0.06,
      w: feltW * 0.88, h: feltH * 0.88,
      fill: FELT_STRIPE, stroke: null,
    }));

    const cardW = mob ? 40 : 50;
    const cardH = mob ? 56 : 70;
    const cardGap = 8;
    const totalCW = cardW * 5 + cardGap * 4;
    const ccX = (feltW - totalCW) / 2;
    const ccY = feltH * 0.42;

    this._communityCardX0  = ccX;
    this._communityCardY   = ccY;
    this._communityCardW   = cardW;
    this._communityCardH   = cardH;
    this._communityCardGap = cardGap;

    this.communitySlots = [];
    for (let i = 0; i < 5; i++) {
      const r = new Rect({
        x: ccX + i * (cardW + cardGap), y: ccY,
        w: cardW, h: cardH,
        fill: null, stroke: "#000000", strokeWidth: 2, radius: 3,
      });
      felt.add(r);
      this.communitySlots.push(r);
    }

    this.potLabel = new Text({
      x: feltW / 2, y: ccY - 60,
      text: "",
      font: mob ? "bold 18px monospace" : "bold 16px monospace",
      color: TEXT_MONEY, align: "center", baseline: "middle",
    });
    felt.add(this.potLabel);

    this.potChips = new Composite({ x: 0, y: 0, w: 0, h: 0 });
    felt.add(this.potChips);

    this.dealerMarker = new Circle({
      x: feltW / 2 - 12, y: -34, w: 24, h: 24,
      fill: DEALER_FILL, stroke: DEALER_STROKE, strokeWidth: 2,
    });
    felt.add(this.dealerMarker);

    this.dealerLabel = new Text({
      x: feltW / 2, y: -50,
      text: "dealer",
      font: "bold 14px sans-serif",
      color: "#000000", align: "center", baseline: "middle",
    });
    felt.add(this.dealerLabel);

    this.seatComposites = [];
    this.communityOverlays = [];

    // Winner banner (center of felt, above the community cards).
    this.winnerLabel = new Text({
      x: feltW / 2, y: feltH * 0.16,
      text: "",
      font: mob ? "bold 20px sans-serif" : "bold 18px sans-serif",
      color: TEXT_PRIMARY, align: "center", baseline: "middle",
    });
    felt.add(this.winnerLabel);

    // Next-hand countdown label (below winner banner).
    this.nextHandLabel = new Text({
      x: feltW / 2, y: feltH * 0.22,
      text: "",
      font: mob ? "bold 16px sans-serif" : "bold 14px sans-serif",
      color: TEXT_SECONDARY, align: "center", baseline: "middle",
    });
    felt.add(this.nextHandLabel);

    // Action row occupies the reserved strip.
    const actionY = feltY + feltH + 16;
    this._actionY = actionY;
    this._buildActionRow(screen, actionY);

    this.chatBtn = new Button({
      x: W - 164, y: 24, w: 140, h: 48,
      text: "Chat",
      fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._toggleChat(),
    });
    screen.add(this.chatBtn);

    this.unreadBadge = new Text({
      x: W - 20, y: 12,
      text: "",
      font: "bold 22px sans-serif",
      color: TEXT_BADGE, align: "center", baseline: "middle",
    });
    screen.add(this.unreadBadge);

    this._buildChatPanel(screen);
    this._buildReconnectOverlay(screen);

    return screen;
  }

  _buildActionRow(screen, y) {
    const W = Viewport.width;
    const mob = this.mobile;

    const btnH = mob ? 60 : 52;
    const gap  = 12;

    const btns = [
      { key: "fold",  label: "Fold",  fill: BTN_RED_FILL,   stroke: BTN_RED_STROKE   },
      { key: "check", label: "Check", fill: BTN_BLUE_FILL,  stroke: BTN_BLUE_STROKE  },
      { key: "call",  label: "Call",  fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE },
      { key: "raise", label: "Raise", fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE },
    ];

    const totalW = mob ? W - 60 : 640;
    const btnW   = (totalW - gap * 3) / 4;
    const x0     = (W - totalW) / 2;

    this.actionButtons = {};
    for (let i = 0; i < btns.length; i++) {
      const def = btns[i];
      const b = new Button({
        x: x0 + i * (btnW + gap), y,
        w: btnW, h: btnH,
        text: def.label,
        fill: def.fill, stroke: def.stroke, strokeWidth: 2, radius: 8,
        textOptions: { font: mob ? "bold 22px sans-serif" : "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._onActionButton(def.key),
      });
      b.visible = false;
      screen.add(b);
      this.actionButtons[def.key] = b;
    }

    const rowY = y + btnH + 12;
    this.raiseAmountPanel = new Panel({
      x: (W - (mob ? 400 : 420)) / 2, y: rowY,
      w: mob ? 400 : 420, h: mob ? 70 : 60,
      fill: BG_INSET, stroke: STROKE_INSET, strokeWidth: 2, radius: 8,
    });
    this.raiseAmountPanel.visible = false;
    screen.add(this.raiseAmountPanel);

    this.raiseAmountLabel = new Label({
      x: 0, y: 0, w: "100%", h: "100%",
      text: "",
      textOptions: { font: mob ? "bold 22px monospace" : "bold 18px monospace", color: TEXT_PRIMARY, align: "center", baseline: "middle" },
    });
    this.raiseAmountLabel.text.x = "50%";
    this.raiseAmountLabel.text.y = "50%";
    this.raiseAmountPanel.add(this.raiseAmountLabel);

    const cW = mob ? 130 : 110;
    const cH = mob ? 60 : 52;
    const cGap = 12;
    const totalCW = cW * 2 + cGap;
    const cX0 = (W - totalCW) / 2;

    this.raiseConfirmBtn = new Button({
      x: cX0, y: rowY + (mob ? 80 : 70), w: cW, h: cH,
      text: "Confirm",
      fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: mob ? "bold 20px sans-serif" : "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._confirmRaise(),
    });
    this.raiseConfirmBtn.visible = false;
    screen.add(this.raiseConfirmBtn);

    this.raiseCancelBtn = new Button({
      x: cX0 + cW + cGap, y: rowY + (mob ? 80 : 70), w: cW, h: cH,
      text: "Cancel",
      fill: BTN_RED_FILL, stroke: BTN_RED_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: mob ? "bold 20px sans-serif" : "bold 18px sans-serif", color: "#ffffff" },
      onClick: () => this._cancelRaise(),
    });
    this.raiseCancelBtn.visible = false;
    screen.add(this.raiseCancelBtn);

    this._raiseBuffer = "";
    this._raiseMin = 0;
    this._raiseMax = 0;
  }

  _buildChatPanel(screen) {
    const W = Viewport.width;
    const H = Viewport.height;
    const mob = this.mobile;

    if (mob) {
      const panel = new Panel({
        x: 0, y: 0, w: W, h: H,
        fill: BG_CHAT, stroke: null,
      });
      panel.visible = false;
      screen.add(panel);
      this.chatPanel = panel;

      panel.add(new Text({
        x: 20, y: 30,
        text: "Table Chat",
        font: "bold 20px sans-serif",
        color: TEXT_SECONDARY, align: "left", baseline: "middle",
      }));

      panel.add(new Button({
        x: W - 140, y: 12, w: 120, h: 44,
        text: "Hide",
        fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 2, radius: 8,
        textOptions: { font: "bold 18px sans-serif", color: "#ffffff" },
        onClick: () => this._toggleChat(),
      }));

      const kbMargin = 40;
      const kbW = W - kbMargin * 2;
      const kbX = kbMargin;
      this.chatKeyboard = new Keyboard({
        x: kbX, y: 0, w: kbW,
        onKey: (ch) => this._handleChatKey({ key: ch, length: 1 }),
      });
      const kbH = this.chatKeyboard.h;
      const kbY = H - kbH - 20;
      this.chatKeyboard.x = kbX;
      this.chatKeyboard.y = kbY;
      this.chatKeyboard.visible = false;
      panel.add(this.chatKeyboard);

      const rowY = kbY - 70;
      const inputX = 20;
      const sendW = 110;
      const inputW = W - 40 - sendW - 12;

      const inputPanel = new Panel({
        x: inputX, y: rowY, w: inputW, h: 56,
        fill: BG_INSET, stroke: STROKE_INSET, strokeWidth: 2, radius: 6,
      });
      panel.add(inputPanel);

      this.inputLabel = new Label({
        x: 0, y: 0, w: "100%", h: "100%",
        text: "",
        textOptions: { font: "18px monospace", color: TEXT_PRIMARY, align: "left", baseline: "middle" },
      });
      this.inputLabel.text.x = 12;
      this.inputLabel.text.y = "50%";
      inputPanel.add(this.inputLabel);

      this.sendBtn = new Button({
        x: W - 20 - sendW, y: rowY, w: sendW, h: 56,
        text: "Send",
        fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE, strokeWidth: 2, radius: 6,
        textOptions: { font: "bold 20px sans-serif", color: "#ffffff" },
        onClick: () => this._sendChat(),
      });
      panel.add(this.sendBtn);

      const logX = 20;
      const logY = 70;
      const logH = rowY - logY - 12;
      this._chatMaxLines = Math.floor((logH - 8) / 22);

      this.chatMessageTexts = [];
      for (let i = 0; i < this._chatMaxLines; i++) {
        const t = new Text({
          x: logX + 4, y: logY + 4 + i * 22,
          text: "",
          font: "16px monospace",
          color: TEXT_CHAT, align: "left", baseline: "top",
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
        fill: BG_CHAT, stroke: STROKE_PANEL, strokeWidth: 2, radius: 8,
      });
      panel.visible = false;
      screen.add(panel);
      this.chatPanel = panel;

      panel.add(new Text({
        x: 12, y: 10,
        text: "Table Chat",
        font: "bold 14px sans-serif",
        color: TEXT_SECONDARY, align: "left", baseline: "top",
      }));

      panel.add(new Button({
        x: pw - 84, y: 6, w: 72, h: 26,
        text: "Hide",
        fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 1, radius: 4,
        textOptions: { font: "bold 12px sans-serif", color: "#ffffff" },
        onClick: () => this._toggleChat(),
      }));

      const logX = 12;
      const logY = 40;
      const logH = ph - 40 - 60;
      this._chatMaxLines = Math.floor((logH - 8) / 18);

      this.chatMessageTexts = [];
      for (let i = 0; i < this._chatMaxLines; i++) {
        const t = new Text({
          x: logX + 4, y: logY + 4 + i * 18,
          text: "",
          font: "13px monospace",
          color: TEXT_CHAT, align: "left", baseline: "top",
        });
        panel.add(t);
        this.chatMessageTexts.push(t);
      }

      const rowY = ph - 48;
      const inputX = 12;
      const inputW = pw - 24 - 96 - 8;

      const inputPanel = new Panel({
        x: inputX, y: rowY, w: inputW, h: 36,
        fill: BG_INSET, stroke: STROKE_INSET, strokeWidth: 1, radius: 4,
      });
      panel.add(inputPanel);

      this.inputLabel = new Label({
        x: 0, y: 0, w: "100%", h: "100%",
        text: "",
        textOptions: { font: "14px monospace", color: TEXT_PRIMARY, align: "left", baseline: "middle" },
      });
      this.inputLabel.text.x = 8;
      this.inputLabel.text.y = "50%";
      inputPanel.add(this.inputLabel);

      this.sendBtn = new Button({
        x: pw - 12 - 96, y: rowY, w: 96, h: 36,
        text: "Send",
        fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE, strokeWidth: 1, radius: 4,
        textOptions: { font: "bold 14px sans-serif", color: "#ffffff" },
        onClick: () => this._sendChat(),
      });
      panel.add(this.sendBtn);

      this.chatKeyboard = null;
    }
  }

  _buildReconnectOverlay(screen) {
    const W = Viewport.width;
    const H = Viewport.height;

    const ov = new Panel({
      x: 0, y: 0, w: "100%", h: "100%",
      self: new Rect({ fill: "rgba(0,0,0,0.65)", stroke: null }),
    });
    ov.visible = false;
    screen.add(ov);
    this.reconnectOverlay = ov;

    const bw = 520;
    const bh = 260;
    const bx = (W - bw) / 2;
    const by = (H - bh) / 2;

    const box = new Panel({
      x: bx, y: by, w: bw, h: bh,
      fill: BG_PANEL, stroke: STROKE_PANEL, strokeWidth: 3, radius: 12,
    });
    ov.add(box);

    box.add(new Text({
      x: bw / 2, y: 50,
      text: "Return to Current Game?",
      font: "bold 26px sans-serif",
      color: TEXT_PRIMARY, align: "center", baseline: "middle",
    }));

    box.add(new Button({
      x: bw / 2 - 170, y: bh - 100, w: 160, h: 60,
      text: "Yes",
      fill: BTN_GREEN_FILL, stroke: BTN_GREEN_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 22px sans-serif", color: "#ffffff" },
      onClick: () => this._acceptReconnect(),
    }));

    box.add(new Button({
      x: bw / 2 + 10, y: bh - 100, w: 160, h: 60,
      text: "No",
      fill: BTN_RED_FILL, stroke: BTN_RED_STROKE, strokeWidth: 2, radius: 8,
      textOptions: { font: "bold 22px sans-serif", color: "#ffffff" },
      onClick: () => this._declineReconnect(),
    }));
  }

  // =================================================================
  // Table rendering.
  // =================================================================

  _renderTable() {
    if (!this._felt) return;
    if (!this.table) return;

    const feltW = this._feltW;
    const feltH = this._feltH;

    for (const sc of this.seatComposites) this._felt.remove(sc);
    this.seatComposites = [];

    if (this.communityOverlays) {
      for (const o of this.communityOverlays) this._felt.remove(o);
    }
    this.communityOverlays = [];

    this.potChips.children.length = 0;

    const totalVisualSlots = 12;
    const angleForSlot = (i) => (Math.PI / 2) + (i * 2 * Math.PI / totalVisualSlots);

    const rx = feltW / 2 - 40;
    const ry = feltH / 2 - 40;

    const mySeat = (this.mySeat != null) ? this.mySeat : 0;

    const seatForVisual = (i) => {
      if (i === 0) return mySeat;
      if (i < 6)   return (mySeat + i) % 11;
      if (i === 6) return null;
      return (mySeat + i - 1) % 11;
    };

    for (let vi = 0; vi < totalVisualSlots; vi++) {
      const seat = seatForVisual(vi);
      if (seat === null) continue;

      const a  = angleForSlot(vi);
      const cx = feltW / 2 + rx * Math.cos(a);
      const cy = feltH / 2 + ry * Math.sin(a);

      const sc = this._buildSeatComposite(seat, cx, cy, vi);
      if (sc) { this._felt.add(sc); this.seatComposites.push(sc); }
    }

    const da  = angleForSlot(6);
    const dcx = feltW / 2 + (rx + 40) * Math.cos(da);
    const dcy = feltH / 2 + (ry + 40) * Math.sin(da);
    this.dealerMarker.x = dcx - 12;
    this.dealerMarker.y = dcy - 12;
    this.dealerLabel.x  = dcx;
    this.dealerLabel.y  = dcy - 30;

    const pot = this._currentPot();
    this.potLabel.text = pot > 0 ? "Pot: " + formatMoney(pot) : "";
    this._renderChipsInto(this.potChips, pot, feltW / 2, feltH / 2 - 40);

    this._renderCommunityCards();

    // Winner / next-hand labels.
    if (this.winnerLabel) {
      this.winnerLabel.text = this.table.handOver ? (this.table.winnerText || "") : "";
    }
    if (this.nextHandLabel) {
      this.nextHandLabel.text = this._nextHandLabelText || "";
    }
  }

  _buildSeatComposite(seat, cx, cy, visualSlot) {
    const sc = new Composite({ x: 0, y: 0, w: 0, h: 0 });

    const players = this.table.players || [];
    const p = players[seat] || null;
    const isMe = (seat === this.mySeat);

    const r = 34;
    const seatX = cx - r;
    const seatY = cy - r;

    let fill = SEAT_IDLE_FILL;
    let stroke = SEAT_IDLE_STROKE;
    if (isMe) fill = SEAT_YOU_FILL;
    if (!p) fill = SEAT_BUSTED_FILL;
    else if (p.folded) fill = SEAT_FOLDED_FILL;
    else if (this.table.turn === seat && !this.table.handOver) fill = SEAT_ACTIVE_FILL;

    sc.add(new Circle({
      x: seatX, y: seatY, w: r * 2, h: r * 2,
      fill, stroke, strokeWidth: 2,
    }));

    if (p) {
      const nm = truncate(p.displayName || p.name || ("Seat " + seat), 10);
      sc.add(new Text({
        x: cx, y: cy,
        text: nm,
        font: "bold 14px sans-serif",
        color: "#101820",
        align: "center", baseline: "middle",
      }));
    } else {
      sc.add(new Button({
        x: cx - 60, y: cy + r + 6, w: 120, h: 32,
        text: "Add Bot",
        fill: BTN_BLUE_FILL, stroke: BTN_BLUE_STROKE, strokeWidth: 1, radius: 6,
        textOptions: { font: "bold 14px sans-serif", color: "#ffffff" },
        onClick: () => this._addBotAtSeat(seat),
      }));
    }

    if (p && p.bank > 0) {
      const stackCx = cx + (cx < this._feltW / 2 ? 60 : -60);
      const stackCy = cy + 40;
      const stackComposite = new Composite({ x: 0, y: 0, w: 0, h: 0 });
      this._renderChipsInto(stackComposite, p.bank, stackCx, stackCy);
      sc.add(stackComposite);

      sc.add(new Text({
        x: stackCx, y: stackCy + 20,
        text: formatMoney(p.bank),
        font: "bold 13px monospace",
        color: TEXT_MONEY, align: "center", baseline: "middle",
      }));
    }

    if (p && p.committed > 0) {
      const betCx = cx + (cx < this._feltW / 2 ? 40 : -40);
      const betCy = cy - 40;
      const betComposite = new Composite({ x: 0, y: 0, w: 0, h: 0 });
      this._renderChipsInto(betComposite, p.committed, betCx, betCy);
      sc.add(betComposite);

      sc.add(new Text({
        x: betCx, y: betCy - 20,
        text: formatMoney(p.committed),
        font: "bold 12px monospace",
        color: TEXT_PRIMARY, align: "center", baseline: "middle",
      }));
    }

    if (p && p.hole && p.hole.length === 2 && !p.folded) {
      const cardW = 30;
      const cardH = 42;
      const cgap  = 4;
      const hcx   = cx - (cardW + cgap) + cgap / 2;
      const hcy   = cy + r + 6;
      const faceUp = isMe || p.showCards;
      for (let i = 0; i < 2; i++) {
        const cardX = hcx + i * (cardW + cgap);
        sc.add(this._buildCardRect(cardX, hcy, cardW, cardH, p.hole[i], faceUp));
      }
    }

    return sc;
  }

  _renderCommunityCards() {
    const cards = this.table.community || [];
    const x0 = this._communityCardX0;
    const y  = this._communityCardY;
    const cw = this._communityCardW;
    const ch = this._communityCardH;
    const g  = this._communityCardGap;

    for (let i = 0; i < cards.length && i < 5; i++) {
      const rect = this._buildCardRect(x0 + i * (cw + g), y, cw, ch, cards[i], true);
      this._felt.add(rect);
      this.communityOverlays.push(rect);
    }
  }

  _buildCardRect(x, y, w, h, cardCode, faceUp) {
    const comp = new Composite({ x: 0, y: 0, w: 0, h: 0 });
    if (!cardCode) return comp;

    if (!faceUp) {
      comp.add(new Rect({
        x, y, w, h,
        fill: CARD_BACK_FILL, stroke: CARD_BACK_EDGE, strokeWidth: 2, radius: 3,
      }));
      comp.add(new Line({
        x1: x + 4, y1: y + 4,
        x2: x + w - 4, y2: y + h - 4,
        stroke: CARD_BACK_DECO, strokeWidth: 2,
      }));
      comp.add(new Line({
        x1: x + w - 4, y1: y + 4,
        x2: x + 4, y2: y + h - 4,
        stroke: CARD_BACK_DECO, strokeWidth: 2,
      }));
      return comp;
    }

    const rank = cardCode[0];
    const suit = cardCode[1];
    const isRed = !!SUIT_RED_SET[suit];

    comp.add(new Rect({
      x, y, w, h,
      fill: CARD_FACE_FILL, stroke: CARD_FACE_EDGE, strokeWidth: 2, radius: 3,
    }));

    const rankFontSize = Math.max(12, Math.floor(h * 0.36));
    const suitFontSize = Math.max(12, Math.floor(h * 0.34));

    comp.add(new Text({
      x: x + 4, y: y + 4,
      text: rank,
      font: "bold " + rankFontSize + "px sans-serif",
      color: isRed ? SUIT_RED : SUIT_BLACK,
      align: "left", baseline: "top",
    }));
    comp.add(new Text({
      x: x + w - 4, y: y + h - 4,
      text: suit,
      font: "bold " + suitFontSize + "px sans-serif",
      color: isRed ? SUIT_RED : SUIT_BLACK,
      align: "right", baseline: "bottom",
    }));

    return comp;
  }

  _renderChipsInto(composite, amount, cx, cy) {
    if (amount <= 0) return;

    const breakdown = chipBreakdown(amount);
    const chipW = 18;
    const chipH = 10;

    const pileGap = 8;
    const totalPiles = breakdown.length;
    if (totalPiles === 0) return;

    const totalW = totalPiles * chipW + (totalPiles - 1) * pileGap;
    let px = cx - totalW / 2;

    for (const d of breakdown) {
      const n = Math.min(d.count, 6);
      for (let i = 0; i < n; i++) {
        const off = i * 2;
        composite.add(new Circle({
          x: px, y: cy - off,
          w: chipW, h: chipH,
          fill: d.fill, stroke: d.stroke, strokeWidth: 1,
        }));
      }
      if (d.count > n) {
        composite.add(new Text({
          x: px + chipW / 2, y: cy + 14,
          text: "x" + d.count,
          font: "bold 11px monospace",
          color: TEXT_PRIMARY, align: "center", baseline: "middle",
        }));
      }
      px += chipW + pileGap;
    }
  }

  // =================================================================
  // Table engine.
  // =================================================================

  _emptyTable(tier) {
    const players = [];
    for (let i = 0; i < SEATS; i++) players.push(null);
    return {
      handId: 0,
      started: false,
      turn: null,
      turnStartedIso: "",
      dealerSeat: 0,
      smallBlind: tier ? tier.smallBlind : 0,
      bigBlind:   tier ? tier.bigBlind   : 0,
      maxBuyIn:   tier ? tier.maxBuyIn   : 0,
      community: [],
      pot: 0,
      stage: "waiting",
      turnCount: 0,
      handOver: false,
      winnerText: "",
      players,
      autoFoldCount: {},
      seed: 0,
      dealtCount: 0,
    };
  }

  _seatedSeats() {
    const out = [];
    if (!this.table) return out;
    for (let i = 0; i < SEATS; i++) {
      if (this.table.players[i]) out.push(i);
    }
    return out;
  }

  _currentPot() {
    return this.table ? (this.table.pot || 0) : 0;
  }

  _canStartHand() {
    if (!this.table) return false;
    const seated = this._seatedSeats();
    const withMoney = seated.filter(s => this.table.players[s].bank > 0);
    return withMoney.length >= 2;
  }

  _startHand() {
    if (!this.table) return;
    if (!this._canStartHand()) {
      this.table.stage = "waiting";
      this.table.handOver = false;
      this.table.winnerText = "";
      this._renderTable();
      this._renderActionRow();
      return;
    }

    this._cancelBotTimer();
    this._cancelNextHandTimer();

    this.table.handId += 1;
    this.table.community = [];
    this.table.pot = 0;
    this.table.stage = "preflop";
    this.table.handOver = false;
    this.table.winnerText = "";
    this.table.turnCount += 1;
    this.table.seed = (Math.random() * 0xffffffff) >>> 0;
    this.table.dealtCount = 0;
    this._nextHandLabelText = "";

    for (let i = 0; i < SEATS; i++) {
      const p = this.table.players[i];
      if (!p) continue;
      p.committed = 0;
      p.folded = false;
      p.allIn = false;
      p.hole = [];
      p.showCards = false;
      p.lastAction = "";
      p.hasActed = false;
    }

    this.table.dealerSeat = this._nextSeatedWithChips(this.table.dealerSeat);

    const deck = this._deckFromSeed(this.table.seed, 0);
    this.table._deck = deck;

    const activeSeats = this._seatedSeats().filter(s => this.table.players[s].bank > 0);
    const holeCards = {};
    let di = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const s of activeSeats) {
        if (!holeCards[s]) holeCards[s] = [];
        holeCards[s].push(deck[deck.length - 1 - di]);
        di++;
      }
    }
    for (const s of activeSeats) {
      this.table.players[s].hole = holeCards[s];
    }

    const sbSeat = this._nextActiveFrom(this.table.dealerSeat);
    const bbSeat = this._nextActiveFrom(sbSeat);

    this._commitBlind(sbSeat, this.table.smallBlind);
    this._commitBlind(bbSeat, this.table.bigBlind);

    this._highestBet = Math.max(
      this.table.players[sbSeat].committed,
      this.table.players[bbSeat].committed
    );
    this._lastRaiser = bbSeat;

    this.table.turn = this._nextActiveFrom(bbSeat);
    this.table.turnStartedIso = nowIso();

    this._renderTable();
    this._renderActionRow();
    this._kickBotIfTurn();
  }

  _nextSeatedWithChips(fromSeat) {
    let s = fromSeat;
    for (let i = 0; i < SEATS; i++) {
      s = (s + 1) % SEATS;
      const p = this.table.players[s];
      if (p && p.bank > 0) return s;
    }
    return fromSeat;
  }

  _nextActiveFrom(fromSeat) {
    let s = fromSeat;
    for (let i = 0; i < SEATS; i++) {
      s = (s + 1) % SEATS;
      const p = this.table.players[s];
      if (p && !p.folded && p.bank > 0) return s;
    }
    return fromSeat;
  }

  _commitBlind(seat, amount) {
    const p = this.table.players[seat];
    if (!p) return;
    const actual = Math.min(amount, p.bank);
    p.bank -= actual;
    p.committed += actual;
    this.table.pot += actual;
    if (p.bank === 0) p.allIn = true;
  }

  // Schedule a bot move if the current turn seat is a bot. Single
  // source of truth for "kick the engine forward".
  _kickBotIfTurn() {
    this._cancelBotTimer();

    if (!this.table) return;
    if (this.table.handOver) return;
    if (this.table.turn == null) return;

    const p = this.table.players[this.table.turn];
    if (!p || !p.isBot) return;

    const delay = BOT_THINK_MIN_MS + Math.floor(Math.random() * (BOT_THINK_MAX_MS - BOT_THINK_MIN_MS));

    const self = this;
    this._botTimer = setTimeout(() => {
      self._botTimer = null;
      self._botAct();
    }, delay);
  }

  _cancelBotTimer() {
    if (this._botTimer) {
      clearTimeout(this._botTimer);
      this._botTimer = null;
    }
  }

  _botAct() {
    if (!this.table) return;
    if (this.table.handOver) return;
    const seat = this.table.turn;
    if (seat == null) return;
    const p = this.table.players[seat];
    if (!p || !p.isBot) return;

    const dec = this._decideBotAction(seat);
    const ok = this._applyActionToState(this.table, seat, dec.action, dec.amount);
    if (!ok) {
      // Bot could not legally take its preferred action. Fall back
      // to the least-bad legal option.
      if (dec.action === "check") {
        const toCall = Math.max(0, this._highestBet - p.committed);
        if (toCall > 0) {
          this._applyActionToState(this.table, seat, "fold", 0);
        }
      } else {
        this._applyActionToState(this.table, seat, "fold", 0);
      }
    }

    this._advanceState(this.table);
    this._renderTable();
    this._renderActionRow();
  }

  _onActionButton(key) {
    if (!this._isMyTurn()) return;
    if (this._betInFlight) return;

    if (key === "fold")  { this._submitAction("fold"); return; }
    if (key === "check") { this._submitAction("check"); return; }
    if (key === "call")  { this._submitAction("call"); return; }
    if (key === "raise") { this._openRaiseEntry(); return; }
  }

  _isMyTurn() {
    if (!this.table) return false;
    if (this.table.handOver) return false;
    if (this.mySeat == null) return false;
    return this.table.turn === this.mySeat;
  }

  _openRaiseEntry() {
    const toCall = this._amountToCall(this.mySeat);
    const minRaise = this._minRaiseAmount(this.mySeat);
    const maxRaise = this._maxRaiseAmount(this.mySeat);
    if (maxRaise <= toCall) return;
    this._raiseMin = Math.max(this._highestBet + minRaise, this._highestBet + this.table.bigBlind);
    this._raiseMax = maxRaise;
    this._raiseBuffer = String(this._raiseMin);
    this.raiseAmountPanel.visible = true;
    this.raiseConfirmBtn.visible = true;
    this.raiseCancelBtn.visible = true;
    this._refreshRaiseLabel();
  }

  _cancelRaise() {
    this.raiseAmountPanel.visible = false;
    this.raiseConfirmBtn.visible = false;
    this.raiseCancelBtn.visible = false;
    this._raiseBuffer = "";
  }

  _refreshRaiseLabel() {
    if (!this.raiseAmountLabel) return;
    const v = parseInt(this._raiseBuffer, 10);
    const shown = Number.isNaN(v) ? 0 : v;
    this.raiseAmountLabel.text =
      "Raise to " + formatMoney(shown) +
      "  (min " + formatMoney(this._raiseMin) +
      ", max " + formatMoney(this._raiseMax) + ")";
  }

  _handleRaiseKey(k) {
    if (k === "Backspace") {
      this._raiseBuffer = this._raiseBuffer.slice(0, -1);
      this._refreshRaiseLabel();
      return;
    }
    if (k === "Escape") { this._cancelRaise(); return; }
    if (k === "Enter")  { this._confirmRaise(); return; }
    if (k.length === 1 && k >= "0" && k <= "9") {
      if (this._raiseBuffer === "0" && k === "0") return;
      this._raiseBuffer += k;
      this._refreshRaiseLabel();
    }
  }

  _confirmRaise() {
    let v = parseInt(this._raiseBuffer, 10);
    if (Number.isNaN(v)) v = this._raiseMin;
    v = Math.max(this._raiseMin, Math.min(this._raiseMax, v));
    this._cancelRaise();
    this._submitAction("raise", v);
  }

  _amountToCall(seat) {
    const p = this.table.players[seat];
    if (!p) return 0;
    return Math.max(0, this._highestBet - p.committed);
  }

  _minRaiseAmount(seat) {
    return this.table.bigBlind;
  }

  _maxRaiseAmount(seat) {
    const p = this.table.players[seat];
    if (!p) return 0;
    return p.bank + p.committed;
  }

  _applyActionToState(state, seat, action, amount) {
    const p = state.players[seat];
    if (!p || p.folded) return false;

    if (action === "fold") {
      p.folded = true;
      p.lastAction = "fold";
      p.hasActed = true;
      return true;
    }

    if (action === "check") {
      const toCall = Math.max(0, this._highestBet - p.committed);
      if (toCall > 0) return false;
      p.lastAction = "check";
      p.hasActed = true;
      return true;
    }

    if (action === "call") {
      const toCall = Math.max(0, this._highestBet - p.committed);
      const actual = Math.min(toCall, p.bank);
      p.bank -= actual;
      p.committed += actual;
      state.pot += actual;
      if (p.bank === 0) p.allIn = true;
      p.lastAction = "call " + formatMoney(actual);
      p.hasActed = true;
      return true;
    }

    if (action === "raise") {
      const target = amount;
      if (target <= this._highestBet) return false;
      const need = target - p.committed;
      if (need <= 0) return false;
      const actual = Math.min(need, p.bank);
      p.bank -= actual;
      p.committed += actual;
      state.pot += actual;
      if (p.bank === 0) p.allIn = true;
      this._highestBet = p.committed;
      this._lastRaiser = seat;
      p.lastAction = "raise " + formatMoney(p.committed);
      p.hasActed = true;
      for (let i = 0; i < SEATS; i++) {
        const q = state.players[i];
        if (!q || q.folded) continue;
        if (i !== seat) q.hasActed = false;
      }
      return true;
    }

    return false;
  }

  _decideBotAction(seat) {
    const p = this.table.players[seat];
    if (!p) return { action: "fold" };

    const toCall = this._amountToCall(seat);
    const personality = p.personality || "straight";

    let strength = 0;
    if (this.table.stage === "preflop") {
      const r1 = RANK_VALUE[p.hole[0][0]];
      const r2 = RANK_VALUE[p.hole[1][0]];
      const hi = Math.max(r1, r2);
      const lo = Math.min(r1, r2);
      strength = (hi + lo) / 28;
      if (r1 === r2) strength += 0.15;
    } else {
      const seven = p.hole.concat(this.table.community);
      const best = bestHand(seven);
      strength = best.rank / 8;
      if (best.tiebreak[0]) strength += Math.min(0.1, best.tiebreak[0] / 140);
    }

    strength += (Math.random() - 0.5) * 0.15;

    const timid      = personality === "timid";
    const aggressive = personality === "aggressive";

    const foldThr = timid ? 0.55 : (aggressive ? 0.28 : 0.40);
    if (toCall > 0 && strength < foldThr) {
      if (aggressive && Math.random() < 0.20) {
        // bluff-call
      } else {
        return { action: "fold" };
      }
    }

    if (toCall === 0) {
      const raiseChance = aggressive ? 0.42 : (timid ? 0.10 : 0.22);
      if (Math.random() < raiseChance && this._maxRaiseAmount(seat) > this.table.bigBlind) {
        const target = Math.min(
          this._maxRaiseAmount(seat),
          Math.max(this._highestBet + this.table.bigBlind * 3, this.table.bigBlind * 3)
        );
        return { action: "raise", amount: target };
      }
      return { action: "check" };
    }

    const raiseChance = aggressive ? 0.35 : (timid ? 0.08 : 0.16);
    if (strength > 0.7 && Math.random() < raiseChance + 0.2) {
      const target = Math.min(
        this._maxRaiseAmount(seat),
        this._highestBet + this.table.bigBlind * 2
      );
      return { action: "raise", amount: target };
    }
    return { action: "call" };
  }

  async _submitAction(action, amount) {
    if (this.tableMode === "sp") {
      const ok = this._applyActionToState(this.table, this.mySeat, action, amount);
      if (!ok) return;
      this._advanceState(this.table);
      this._renderTable();
      this._renderActionRow();
      return;
    }

    if (this._betInFlight) return;
    this._betInFlight = true;
    this._renderActionRow();

    const seat = this.mySeat;
    const self = this;
    const gamePath = this._tableGamePath();

    try {
      await this._serialize(async () => {
        const ctx = await self._fetchTreeContext();
        const entry = ctx.entries.get(gamePath);
        let content = "";
        if (entry) content = await self._readBlob(entry.sha);
        const state = self._decodeGame(content, self.tier);

        if (state.turn !== seat || state.handOver) return;

        self._highestBet = self._highestCommitted(state);
        self._applyActionToState(state, seat, action, amount);
        self._advanceState(state);

        const body = self._encodeGame(state);
        const hint = { commitSha: ctx.commitSha, treeSha: ctx.treeSha, entries: ctx.entries, content };
        await self._writeWithRetry(gamePath, () => body, "action " + seat, hint);
      });

      await this._refreshTableMirror();
      this._renderTable();
      this._renderActionRow();
    } catch (e) {
      this._setStatus("Action failed.");
    } finally {
      this._betInFlight = false;
      this._renderActionRow();
    }
  }

  _highestCommitted(state) {
    let h = 0;
    for (const p of state.players) if (p) h = Math.max(h, p.committed);
    return h;
  }

  // Advance the turn, end the round, or end the hand. Does NOT
  // recursively step bots. That is _kickBotIfTurn's job.
  _advanceState(state) {
    const activeSeats = [];
    for (let i = 0; i < SEATS; i++) {
      const p = state.players[i];
      if (p && !p.folded) activeSeats.push(i);
    }

    if (activeSeats.length === 1) {
      this._endHandSingleWinner(state, activeSeats[0]);
      return;
    }

    let hb = 0;
    for (const s of activeSeats) hb = Math.max(hb, state.players[s].committed);

    let allMatched = true;
    let allActed = true;
    for (const s of activeSeats) {
      const p = state.players[s];
      if (p.allIn) continue;
      if (p.committed < hb) { allMatched = false; break; }
      if (!p.hasActed) { allActed = false; break; }
    }

    if (allMatched && allActed) {
      this._endRound(state);
      return;
    }

    const next = this._nextActiveFrom(state.turn);
    state.turn = next;
    state.turnStartedIso = nowIso();
    state.turnCount += 1;

    this._kickBotIfTurn();
  }

  _endRound(state) {
    for (let i = 0; i < SEATS; i++) {
      const p = state.players[i];
      if (!p) continue;
      p.committed = 0;
      p.lastAction = "";
      p.hasActed = false;
    }
    this._highestBet = 0;
    this._lastRaiser = null;

    const order = ["preflop", "flop", "turn", "river", "showdown"];
    const idx = order.indexOf(state.stage);
    const nextStage = order[Math.min(idx + 1, order.length - 1)];

    if (nextStage === "showdown") {
      this._showdown(state);
      return;
    }

    state.stage = nextStage;

    if (nextStage === "flop") {
      state.community.push(state._deck.pop());
      state.community.push(state._deck.pop());
      state.community.push(state._deck.pop());
      state.dealtCount += 3;
    } else if (nextStage === "turn" || nextStage === "river") {
      state.community.push(state._deck.pop());
      state.dealtCount += 1;
    }

    state.turn = this._nextActiveFrom(state.dealerSeat);
    state.turnStartedIso = nowIso();
    state.turnCount += 1;

    this._kickBotIfTurn();
  }

  _endHandSingleWinner(state, seat) {
    const p = state.players[seat];
    if (!p) return;
    p.bank += state.pot;
    state.winnerText = (p.displayName || p.name || ("Seat " + seat)) + " wins " + formatMoney(state.pot);
    state.pot = 0;
    this._finishHand(state);
  }

  _showdown(state) {
    const activeSeats = [];
    for (let i = 0; i < SEATS; i++) {
      const p = state.players[i];
      if (p && !p.folded) activeSeats.push(i);
    }
    if (activeSeats.length === 0) {
      this._finishHand(state);
      return;
    }

    const sevenFor = (s) => state.players[s].hole.concat(state.community);
    const ranked = activeSeats.map(s => ({ seat: s, hand: bestHand(sevenFor(s)) }));
    ranked.sort((a, b) => compareHands(b.hand, a.hand));
    const best = ranked[0].hand;
    const winners = ranked.filter(r => compareHands(r.hand, best) === 0);

    for (const s of activeSeats) state.players[s].showCards = true;

    const share = Math.floor(state.pot / winners.length);
    for (const w of winners) {
      state.players[w.seat].bank += share;
    }
    const names = winners.map(w => (state.players[w.seat].displayName || state.players[w.seat].name || ("Seat " + w.seat))).join(", ");
    state.winnerText = names + " win " + formatMoney(state.pot) + " (" + best.name + ")";
    state.pot = 0;
    this._finishHand(state);
  }

  _finishHand(state) {
    state.handOver = true;
    state.turn = null;
    state.stage = "showdown";
    this._cancelBotTimer();
    this._scheduleNextHand();
  }

  // ---------- Next-hand scheduler ----------

  _scheduleNextHand() {
    this._cancelNextHandTimer();

    if (!this.table) return;
    if (this.tableMode === "sp" && !this._canStartHand()) return;
    if (this.tableMode !== "sp") return;   // MP next-hand scheduling deferred.

    const startAt = Date.now() + NEXT_HAND_DELAY_MS;
    this._nextHandLabelText = "Next hand in " + Math.ceil(NEXT_HAND_DELAY_MS / 1000) + "...";

    const self = this;
    this._nextHandTimer = setTimeout(() => {
      self._nextHandTimer = null;
      self._nextHandLabelText = "";
      self._startHand();
    }, NEXT_HAND_DELAY_MS);
  }

  _cancelNextHandTimer() {
    if (this._nextHandTimer) {
      clearTimeout(this._nextHandTimer);
      this._nextHandTimer = null;
    }
    this._nextHandLabelText = "";
  }

  _renderActionRow() {
    if (!this.actionButtons) return;

    const isMyTurn = this._isMyTurn();

    for (const k of ["fold", "check", "call", "raise"]) {
      this.actionButtons[k].visible = false;
    }

    if (!isMyTurn) {
      this.raiseAmountPanel.visible = false;
      this.raiseConfirmBtn.visible = false;
      this.raiseCancelBtn.visible = false;
      return;
    }

    const toCall = this._amountToCall(this.mySeat);
    const canCheck = (toCall === 0);
    const canCall  = (toCall > 0 && this.table.players[this.mySeat].bank > 0);
    const canRaise = (this._maxRaiseAmount(this.mySeat) > this._highestBet)
                  && this.table.players[this.mySeat].bank > 0;

    this.actionButtons.fold.visible = true;
    if (canCheck) {
      this.actionButtons.check.visible = true;
    } else {
      this.actionButtons.call.visible = true;
      this.actionButtons.call.setText("Call " + formatMoney(toCall));
    }
    if (canRaise) this.actionButtons.raise.visible = true;
  }

  // =================================================================
  // Singleplayer flow.
  // =================================================================

  _startSPGame() {
    const tier = this.spTierChoice || TABLE_TIERS[0];
    const count = this._spCountPick || 1;

    this.tier       = tier;
    this.tableMode  = "sp";
    this.roomKey    = null;
    this.tableId    = null;
    this.chatLines  = [];

    this.table = this._emptyTable(tier);
    this.table.started = true;
    this.table.stage   = "waiting";
    this.mySeat        = 0;

    this.table.players[0] = {
      seat: 0,
      name: this.account.username,
      displayName: this.account.displayName,
      bank: Math.min(tier.maxBuyIn, this.account.bank),
      committed: 0,
      folded: false,
      allIn: false,
      hole: [],
      showCards: false,
      lastAction: "",
      hasActed: false,
      isBot: false,
      personality: null,
    };

    for (let i = 1; i <= count; i++) {
      this.table.players[i] = this._makeBotRecord(i, tier);
    }

    this.table.dealerSeat = 0;
    this._highestBet = 0;
    this._lastRaiser = null;
    this._betInFlight = false;

    this.tableTitleLabel.text = tier.label + "  (Blinds " + tier.smallBlind + " / " + tier.bigBlind + ")";

    this._pushScreen("table");
    this._renderTable();
    this._renderActionRow();
    this._refreshBankLabels();

    this._startHand();
  }

  _makeBotRecord(seat, tier) {
    const personality = BOT_PERSONALITIES[Math.floor(Math.random() * BOT_PERSONALITIES.length)];
    const name = BOT_NAMES[(seat * 3 + Math.floor(Math.random() * 3)) % BOT_NAMES.length]
               + String.fromCharCode(65 + (seat % 26));
    return {
      seat,
      name: "bot_" + seat,
      displayName: name,
      bank: tier.maxBuyIn,
      committed: 0,
      folded: false,
      allIn: false,
      hole: [],
      showCards: false,
      lastAction: "",
      hasActed: false,
      isBot: true,
      personality,
    };
  }

  _addBotAtSeat(seat) {
    if (!this.table) return;
    if (this.table.players[seat]) return;
    const tier = this.tier || TABLE_TIERS[0];
    this.table.players[seat] = this._makeBotRecord(seat, tier);
    this._renderTable();
    if (this.table.handOver && this._canStartHand()) {
      this._startHand();
    }
  }

  // =================================================================
  // Multiplayer flow.
  // =================================================================

  _tableGamePath()     { return DATA_ROOT + this.roomKey + "/game.txt"; }
  _tableChatPath()     { return DATA_ROOT + this.roomKey + "/chat.txt"; }
  _tablePresencePath() { return DATA_ROOT + this.roomKey + "/presence.txt"; }

  async _joinMultiplayerRoom(room) {
    if (this._joining) return;
    this._joining = true;

    const tier = TABLE_TIERS.find(t => t.key === room.tier);
    if (!tier) { this._joining = false; return; }

    this.tier      = tier;
    this.tableMode = "mp";
    this.roomKey   = room.key;
    this.tableId   = "main";

    this.mpRoomStatusLabel.text = "Joining " + room.label + "...";

    try {
      let claimedSlot = -1;
      const myIso = nowIso();
      const myName = this.account.displayName;
      const self = this;

      try {
        await this._serialize(async () => {
          const c = await self._fetchTreeContext();
          const entry = c.entries.get(self._tablePresencePath());
          let content = "";
          if (entry) content = await self._readBlob(entry.sha);
          const hint = { commitSha: c.commitSha, treeSha: c.treeSha, entries: c.entries, content };

          const result = await self._writeWithRetry(
            self._tablePresencePath(),
            (current) => {
              const entries = self._parsePresence(current, SEATS);
              const free = self._firstFreeSlot(entries);
              if (free < 0) return null;
              claimedSlot = free;
              const line = "slot" + free + "|" + myName + "|" + myIso;
              return self._splicePresenceLine(current, free, line);
            },
            "join poker room",
            hint
          );
          if (!result.ok) claimedSlot = -1;
        });
      } catch (e) {
        this.mpRoomStatusLabel.text = "Claim failed.";
        return;
      }

      if (claimedSlot < 0) {
        this.mpRoomStatusLabel.text = "Room full.";
        return;
      }

      this.mySeat = claimedSlot;

      const gamePath = this._tableGamePath();
      try {
        await this._serialize(async () => {
          const c = await self._fetchTreeContext();
          const entry = c.entries.get(gamePath);
          let content = "";
          if (entry) content = await self._readBlob(entry.sha);
          const hint = { commitSha: c.commitSha, treeSha: c.treeSha, entries: c.entries, content };
          await self._writeWithRetry(
            gamePath,
            (current) => {
              if (current && current.length > 0) return null;
              const fresh = self._emptyTable(tier);
              fresh.started = true;
              fresh.stage = "waiting";
              return self._encodeGame(fresh);
            },
            "init poker table",
            hint
          );
        });
      } catch (e) {}

      await this._refreshTableMirror();

      if (this.table && !this.table.players[this.mySeat]) {
        try {
          await this._serialize(async () => {
            const c = await self._fetchTreeContext();
            const entry = c.entries.get(gamePath);
            let content = "";
            if (entry) content = await self._readBlob(entry.sha);
            const hint = { commitSha: c.commitSha, treeSha: c.treeSha, entries: c.entries, content };
            await self._writeWithRetry(
              gamePath,
              (current) => {
                const st = self._decodeGame(current, tier);
                if (!st.players[self.mySeat]) {
                  st.players[self.mySeat] = {
                    seat: self.mySeat,
                    name: self.account.username,
                    displayName: self.account.displayName,
                    bank: Math.min(tier.maxBuyIn, self.account.bank),
                    committed: 0, folded: false, allIn: false,
                    hole: [], showCards: false, lastAction: "",
                    hasActed: false, isBot: false, personality: null,
                  };
                }
                return self._encodeGame(st);
              },
              "seat taken",
              hint
            );
          });
          await this._refreshTableMirror();
        } catch (e) {}
      }

      this.tableTitleLabel.text = tier.label + "  (Blinds " + tier.smallBlind + " / " + tier.bigBlind + ")";

      this._pushScreen("table");
      this._renderTable();
      this._renderActionRow();
      this._refreshBankLabels();

      this._startCycle();
    } finally {
      this._joining = false;
    }
  }

  async _refreshTableMirror() {
    if (this.tableMode !== "mp") return;
    const self = this;
    const gamePath = this._tableGamePath();
    await this._serialize(async () => {
      const c = await self._fetchTreeContext();
      const entry = c.entries.get(gamePath);
      let content = "";
      if (entry) content = await self._readBlob(entry.sha);
      self.table = self._decodeGame(content, self.tier);
      if (self.table && self.table.seed != null && self.table.seed !== 0) {
        self.table._deck = self._deckFromSeed(self.table.seed, self.table.dealtCount || 0);
      } else {
        self.table._deck = [];
      }
      self._restoreMySecrets();
    });
  }

  // =================================================================
  // Encode / decode.
  // =================================================================

  _encodeGame(state) {
    const L = [];
    L.push("#META");
    L.push("handId=" + (state.handId || 0));
    L.push("started=" + (state.started ? 1 : 0));
    L.push("turn=" + (state.turn == null ? -1 : state.turn));
    L.push("turnStartedIso=" + (state.turnStartedIso || ""));
    L.push("dealerSeat=" + (state.dealerSeat || 0));
    L.push("smallBlind=" + (state.smallBlind || 0));
    L.push("bigBlind=" + (state.bigBlind || 0));
    L.push("maxBuyIn=" + (state.maxBuyIn || 0));
    L.push("community=" + (state.community || []).join(","));
    L.push("pot=" + (state.pot || 0));
    L.push("stage=" + (state.stage || "waiting"));
    L.push("turnCount=" + (state.turnCount || 0));
    L.push("handOver=" + (state.handOver ? 1 : 0));
    L.push("winnerText=" + (state.winnerText || "").replace(/[\n|]/g, " "));
    L.push("seed=" + (state.seed || 0));
    L.push("dealtCount=" + (state.dealtCount || 0));

    for (let i = 0; i < SEATS; i++) {
      const p = state.players[i];
      L.push("#SEAT " + i);
      if (!p) {
        L.push("empty=1");
        continue;
      }
      L.push("empty=0");
      L.push("name=" + (p.name || "").replace(/[\n|]/g, ""));
      L.push("displayName=" + (p.displayName || "").replace(/[\n|]/g, ""));
      L.push("bank=" + (p.bank | 0));
      L.push("committed=" + (p.committed | 0));
      L.push("folded=" + (p.folded ? 1 : 0));
      L.push("allIn=" + (p.allIn ? 1 : 0));
      L.push("showCards=" + (p.showCards ? 1 : 0));
      L.push("lastAction=" + (p.lastAction || "").replace(/[\n|]/g, " "));
      L.push("isBot=" + (p.isBot ? 1 : 0));
      L.push("personality=" + (p.personality || ""));
      L.push("hole=" + (p.showCards ? (p.hole || []).join(",") : ""));
    }
    return L.join("\n") + "\n";
  }

  _decodeGame(text, tier) {
    const state = this._emptyTable(tier || this.tier || TABLE_TIERS[0]);
    if (!text) return state;

    const lines = text.split("\n");
    let section = null;
    let seatIdx = -1;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#META")) { section = "meta"; continue; }
      if (line.startsWith("#SEAT")) {
        section = "seat";
        seatIdx = parseInt(line.split(" ")[1] || "-1", 10);
        continue;
      }
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const k = line.slice(0, eq);
      const v = line.slice(eq + 1);

      if (section === "meta") {
        if (k === "handId")          state.handId = parseInt(v, 10) || 0;
        else if (k === "started")    state.started = v === "1";
        else if (k === "turn")       state.turn = v === "-1" ? null : parseInt(v, 10);
        else if (k === "turnStartedIso") state.turnStartedIso = v;
        else if (k === "dealerSeat") state.dealerSeat = parseInt(v, 10) || 0;
        else if (k === "smallBlind") state.smallBlind = parseInt(v, 10) || 0;
        else if (k === "bigBlind")   state.bigBlind   = parseInt(v, 10) || 0;
        else if (k === "maxBuyIn")   state.maxBuyIn   = parseInt(v, 10) || 0;
        else if (k === "community")  state.community  = v ? v.split(",") : [];
        else if (k === "pot")        state.pot        = parseInt(v, 10) || 0;
        else if (k === "stage")      state.stage      = v || "waiting";
        else if (k === "turnCount")  state.turnCount  = parseInt(v, 10) || 0;
        else if (k === "handOver")   state.handOver   = v === "1";
        else if (k === "winnerText") state.winnerText = v;
        else if (k === "seed")       state.seed       = parseInt(v, 10) || 0;
        else if (k === "dealtCount") state.dealtCount = parseInt(v, 10) || 0;
      } else if (section === "seat" && seatIdx >= 0 && seatIdx < SEATS) {
        if (k === "empty") {
          if (v === "1") state.players[seatIdx] = null;
          else if (!state.players[seatIdx]) {
            state.players[seatIdx] = {
              seat: seatIdx, name: "", displayName: "", bank: 0,
              committed: 0, folded: false, allIn: false,
              hole: [], showCards: false, lastAction: "",
              hasActed: false, isBot: false, personality: null,
            };
          }
          continue;
        }
        let p = state.players[seatIdx];
        if (!p) {
          p = {
            seat: seatIdx, name: "", displayName: "", bank: 0,
            committed: 0, folded: false, allIn: false,
            hole: [], showCards: false, lastAction: "",
            hasActed: false, isBot: false, personality: null,
          };
          state.players[seatIdx] = p;
        }
        if (k === "name")             p.name = v;
        else if (k === "displayName") p.displayName = v;
        else if (k === "bank")        p.bank = parseInt(v, 10) || 0;
        else if (k === "committed")   p.committed = parseInt(v, 10) || 0;
        else if (k === "folded")      p.folded = v === "1";
        else if (k === "allIn")       p.allIn = v === "1";
        else if (k === "showCards")   p.showCards = v === "1";
        else if (k === "lastAction")  p.lastAction = v;
        else if (k === "isBot")       p.isBot = v === "1";
        else if (k === "personality") p.personality = v;
        else if (k === "hole")        p.hole = v ? v.split(",") : [];
      }
    }
    return state;
  }

  _deckFromSeed(seed, dealtCount) {
    const deck = newDeck();
    let s = seed >>> 0;
    if (s === 0) s = 1;
    for (let i = deck.length - 1; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    if (dealtCount > 0) deck.splice(deck.length - dealtCount, dealtCount);
    return deck;
  }

  _restoreMySecrets() {
    if (!this.table) return;
    if (this.table.seed == null || this.table.seed === 0) return;
    const deck = this._deckFromSeed(this.table.seed, 0);
    const activeSeats = this._seatedSeatsForDeal();
    const holeCards = {};
    let di = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const s of activeSeats) {
        if (!holeCards[s]) holeCards[s] = [];
        holeCards[s].push(deck[deck.length - 1 - di]);
        di++;
      }
    }
    for (const s of activeSeats) {
      if (this.table.players[s]) {
        this.table.players[s].hole = holeCards[s] || [];
      }
    }
    this.table._deck = deck;
  }

  _seatedSeatsForDeal() {
    const out = [];
    for (let i = 0; i < SEATS; i++) {
      const p = this.table.players[i];
      if (p) out.push(i);
    }
    return out;
  }

  // =================================================================
  // Leave table.
  // =================================================================

  async _leaveTable() {
    if (this._leaving) return;
    this._leaving = true;

    this._cancelBotTimer();
    this._cancelNextHandTimer();

    try {
      if (this.tableMode === "mp") {
        await this._releaseMPSeat();
      } else {
        await this._settleSPResults();
      }
    } finally {
      this._leaving = false;
      this._stopCycle();
      this.table = null;
      this.mySeat = null;
      this.tier = null;
      this.tableMode = null;
      this.roomKey = null;
      this.tableId = null;
      this.stack = ["menu"];
      this._applyScreen("menu");
      this._refreshMenuLabels();
      this._refreshBalanceScreen();
    }
  }

  async _releaseMPSeat() {
    if (this.mySeat == null) return;
    const mySeat = this.mySeat;
    const self = this;
    try {
      await this._serialize(async () => {
        const c = await self._fetchTreeContext();
        const pPath = self._tablePresencePath();
        const entry = c.entries.get(pPath);
        let content = "";
        if (entry) content = await self._readBlob(entry.sha);
        const hint = { commitSha: c.commitSha, treeSha: c.treeSha, entries: c.entries, content };
        await self._writeWithRetry(
          pPath,
          (current) => {
            const line = "slot" + mySeat + "|" + self.account.displayName + "|" + LEAVE_TIMESTAMP;
            return self._splicePresenceLine(current, mySeat, line);
          },
          "leave seat " + mySeat,
          hint
        );
      });

      const gamePath = this._tableGamePath();
      let leftoverBank = null;
      await this._serialize(async () => {
        const c = await self._fetchTreeContext();
        const entry = c.entries.get(gamePath);
        let content = "";
        if (entry) content = await self._readBlob(entry.sha);
        const hint = { commitSha: c.commitSha, treeSha: c.treeSha, entries: c.entries, content };
        await self._writeWithRetry(
          gamePath,
          (current) => {
            const st = self._decodeGame(current, self.tier);
            if (st.players[mySeat]) {
              leftoverBank = st.players[mySeat].bank;
              st.players[mySeat] = null;
            }
            return self._encodeGame(st);
          },
          "clear seat " + mySeat,
          hint
        );
      });

      if (leftoverBank != null) {
        await this._applyResultToAccount(leftoverBank);
      }
    } catch (e) {}
  }

  async _settleSPResults() {
    if (!this.table || !this.account) return;
    const p = this.table.players[this.mySeat];
    if (!p) return;

    const buyIn = Math.min(this.tier.maxBuyIn, this.account.bank);
    const finalBank = p.bank;
    const delta = finalBank - buyIn;
    const newAccountBank = this.account.bank - buyIn + finalBank;

    try {
      let updated = null;
      await this._serialize(async () => {
        const c = await this._fetchTreeContext();
        const entry = c.entries.get(ACCOUNTS_FILE);
        let content = "";
        if (entry) content = await this._readBlob(entry.sha);
        const lines = content ? content.split("\n").filter(l => l.length > 0) : [];
        const accounts = [];
        for (const line of lines) {
          const a = this._decAccountLine(line);
          if (a) accounts.push(a);
        }
        const idx = accounts.findIndex(a => a.username.toLowerCase() === this.account.username.toLowerCase());
        if (idx < 0) return;

        accounts[idx].bank = newAccountBank;
        accounts[idx].lifetime += delta;
        if (delta > 0) accounts[idx].wins += 1;
        else if (delta < 0) accounts[idx].losses += 1;
        accounts[idx].handsPlayed += 1;
        accounts[idx].lastSeenIso = nowIso();
        updated = accounts[idx];

        const body = accounts.map(a => this._encAccountLine(a)).join("\n") + "\n";
        const hint = { commitSha: c.commitSha, treeSha: c.treeSha, entries: c.entries, content };
        const result = await this._writeWithRetry(ACCOUNTS_FILE, () => body, "sp results", hint);
        if (!result.ok) updated = null;
      });
      if (updated) this.account = updated;
    } catch (e) {}
  }

  async _applyResultToAccount(newBank) {
    if (!this.account) return;
    const oldBank = this.account.bank;
    const delta   = newBank - oldBank;
    try {
      let updated = null;
      await this._serialize(async () => {
        const c = await this._fetchTreeContext();
        const entry = c.entries.get(ACCOUNTS_FILE);
        let content = "";
        if (entry) content = await this._readBlob(entry.sha);
        const lines = content ? content.split("\n").filter(l => l.length > 0) : [];
        const accounts = [];
        for (const line of lines) {
          const a = this._decAccountLine(line);
          if (a) accounts.push(a);
        }
        const idx = accounts.findIndex(a => a.username.toLowerCase() === this.account.username.toLowerCase());
        if (idx < 0) return;
        accounts[idx].bank = newBank;
        accounts[idx].lifetime += delta;
        if (delta > 0) accounts[idx].wins += 1;
        else if (delta < 0) accounts[idx].losses += 1;
        accounts[idx].handsPlayed += 1;
        accounts[idx].lastSeenIso = nowIso();
        accounts[idx].currentRoom = "";
        updated = accounts[idx];
        const body = accounts.map(a => this._encAccountLine(a)).join("\n") + "\n";
        const hint = { commitSha: c.commitSha, treeSha: c.treeSha, entries: c.entries, content };
        const result = await this._writeWithRetry(ACCOUNTS_FILE, () => body, "record result", hint);
        if (!result.ok) updated = null;
      });
      if (updated) this.account = updated;
    } catch (e) {}
  }

  // =================================================================
  // Chat.
  // =================================================================

  _toggleChat() {
    this.chatOpen = !this.chatOpen;
    if (this.chatPanel) this.chatPanel.visible = this.chatOpen;
    if (this.chatKeyboard) this.chatKeyboard.visible = this.chatOpen;
    if (this.chatBtn) this.chatBtn.setText(this.chatOpen ? "Hide" : "Chat");
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
      if (!raw) { t.text = ""; continue; }
      const parsed = this._parseChatLine(raw);
      if (!parsed) { t.text = truncate(raw, 52); continue; }
      const line = "[" + hhmm(parsed.iso) + "] " + parsed.username + ": " + parsed.text;
      t.text = truncate(line, this.mobile ? 40 : 52);
    }
  }

  _parseChatLine(line) {
    const a = line.indexOf("|");
    if (a < 0) return null;
    const b = line.indexOf("|", a + 1);
    if (b < 0) return null;
    return { username: line.slice(0, a), iso: line.slice(a + 1, b), text: line.slice(b + 1) };
  }

  _renderUnreadBadge() {
    if (!this.unreadBadge) return;
    this.unreadBadge.text = this.unread > 0 ? "!" : "";
  }

  async _sendChat() {
    if (this.tableMode !== "mp") return;
    if (this._sending) return;
    const text = this.inputText.trim();
    if (!text) return;
    const now = Date.now();
    if (now - this._lastSend < CHAT_COOLDOWN) {
      const rem = Math.ceil((CHAT_COOLDOWN - (now - this._lastSend)) / 1000);
      this._setStatus("Wait " + rem + "s.");
      setTimeout(() => this._setStatus(""), 2000);
      return;
    }
    this._sending = true;
    this._lastSend = now;

    const safe = text.replace(/\|/g, "/").replace(/\n/g, " ");
    const iso  = nowIso();
    const line = this.account.username + "|" + iso + "|" + safe + "\n";

    try {
      await this._serialize(() =>
        this._writeWithRetry(this._tableChatPath(), c => c + line, "poker chat")
      );
      this.chatLines.push(this.account.username + "|" + iso + "|" + safe);
      this._seenChatCount = this.chatLines.length;
      this._renderChatLog();
      this.inputText = "";
      this._refreshChatInput();
    } catch (e) {
      this._setStatus("Chat failed.");
    } finally {
      this._sending = false;
    }
  }

  _handleChatKey(e) {
    if (e.key === "Backspace") {
      this.inputText = this.inputText.slice(0, -1);
      this._refreshChatInput();
      return;
    }
    if (e.key === "Enter") { this._sendChat(); return; }
    if (e.key.length === 1) {
      this.inputText += e.key;
      this._refreshChatInput();
    }
  }

  _refreshChatInput() {
    if (this.inputLabel) this._renderField(this.inputLabel, this.inputText);
  }

  // =================================================================
  // Reconnect.
  // =================================================================

  _acceptReconnect() {
    this.reconnectOverlay.visible = false;
    if (!this.reconnectOffer) return;
    const offer = this.reconnectOffer;
    this.reconnectOffer = null;
    const room = MP_ROOMS.find(r => r.key === offer.roomKey);
    if (room) this._joinMultiplayerRoom(room);
  }

  _declineReconnect() {
    this.reconnectOverlay.visible = false;
    this.reconnectOffer = null;
  }

  // =================================================================
  // Cycle.
  // =================================================================

  _startCycle() {
    this._stopCycle();
    this._cycleDelay  = CYCLE_MS;
    const initial     = Math.floor(Math.random() * PRESTAGGER_MAX_MS);
    this._nextCycleAt = Date.now() + initial;
    this._cycleTimer = setTimeout(() => this._runCycleLoop(), initial);
  }

  _stopCycle() {
    if (this._cycleTimer) {
      clearTimeout(this._cycleTimer);
      this._cycleTimer = null;
    }
    this._nextCycleAt = 0;
  }

  async _runCycleLoop() {
    if (this.tableMode !== "mp") return;
    this._nextCycleAt = 0;

    await this._cycle();
    await this._checkTimeouts();

    this._nextCycleAt = Date.now() + this._cycleDelay;
    this._cycleTimer = setTimeout(() => this._runCycleLoop(), this._cycleDelay);
  }

  async _cycle() {
    if (this.tableMode !== "mp") return;

    const self = this;
    const pPath = this._tablePresencePath();
    const gPath = this._tableGamePath();
    const cPath = this._tableChatPath();
    const mySeat = this.mySeat;

    await this._serialize(async () => {
      const c = await self._fetchTreeContext();

      const pEntry = c.entries.get(pPath);
      let pContent = "";
      if (pEntry) pContent = await self._readBlob(pEntry.sha);
      const pIso = nowIso();
      const pHint = { commitSha: c.commitSha, treeSha: c.treeSha, entries: c.entries, content: pContent };
      try {
        await self._writeWithRetry(
          pPath,
          (current) => self._splicePresenceLine(current, mySeat, "slot" + mySeat + "|" + self.account.displayName + "|" + pIso),
          "cycle presence",
          pHint
        );
      } catch (e) {}

      const gEntry = c.entries.get(gPath);
      let gContent = "";
      if (gEntry) gContent = await self._readBlob(gEntry.sha);
      const gState = self._decodeGame(gContent, self.tier);
      if (gState.seed != null && gState.seed !== 0) {
        gState._deck = self._deckFromSeed(gState.seed, gState.dealtCount || 0);
      } else {
        gState._deck = [];
      }
      self.table = gState;
      self._restoreMySecrets();

      const cEntry = c.entries.get(cPath);
      let cContent = "";
      if (cEntry) cContent = await self._readBlob(cEntry.sha);
      const newChat = cContent ? cContent.split("\n").filter(l => l.length > 0) : [];
      if (newChat.length > self._seenChatCount && !self.chatOpen) {
        self.unread += (newChat.length - self._seenChatCount);
      }
      self.chatLines = newChat;
      if (self.chatOpen) self._seenChatCount = newChat.length;

      self._renderTable();
      self._renderActionRow();
      self._renderChatLog();
      self._renderUnreadBadge();
      self._refreshBankLabels();
    });
  }

  async _checkTimeouts() {
    if (!this.table || !this.table.turnStartedIso) return;
    const t = Date.parse(this.table.turnStartedIso);
    if (Number.isNaN(t)) return;
    const elapsed = Date.now() - t;
    const turnSeat = this.table.turn;
    if (turnSeat == null) return;
    if (turnSeat === this.mySeat) return;
    if (elapsed < AUTO_FOLD_MS) return;

    await this._autoFoldSeat(turnSeat);
  }

  async _autoFoldSeat(seat) {
    const self = this;
    const gPath = this._tableGamePath();
    try {
      await this._serialize(async () => {
        const c = await self._fetchTreeContext();
        const entry = c.entries.get(gPath);
        let content = "";
        if (entry) content = await self._readBlob(entry.sha);
        const hint = { commitSha: c.commitSha, treeSha: c.treeSha, entries: c.entries, content };
        await self._writeWithRetry(
          gPath,
          (current) => {
            const st = self._decodeGame(current, self.tier);
            if (st.turn !== seat) return null;
            const ts = Date.parse(st.turnStartedIso || "");
            if (Number.isNaN(ts)) return null;
            if (Date.now() - ts < AUTO_FOLD_MS) return null;

            self._highestBet = self._highestCommitted(st);
            const p = st.players[seat];
            if (p) {
              self._applyActionToState(st, seat, "fold", 0);
              p.hasActed = true;
            }
            st.autoFoldCount = st.autoFoldCount || {};
            const cnt = (st.autoFoldCount[seat] || 0) + 1;
            st.autoFoldCount[seat] = cnt;
            if (cnt >= AUTO_FOLD_KICK_COUNT) {
              st.players[seat] = null;
              st.autoFoldCount[seat] = 0;
            }
            self._advanceState(st);
            return self._encodeGame(st);
          },
          "auto fold seat " + seat,
          hint
        );
      });
      await self._refreshTableMirror();
    } catch (e) {}
  }

  // =================================================================
  // Event handling.
  // =================================================================

  onEvent(e) {
    const top = this.stack[this.stack.length - 1];

    if (e.type !== "keydown") return;

    // Modal entry takes precedence over everything.
    if (this.entryOpen) {
      this._handleEntryKey(e);
      return;
    }

    if (top === "table") {
      if (this.chatOpen) { this._handleChatKey(e); return; }
      if (this.raiseAmountPanel && this.raiseAmountPanel.visible) {
        this._handleRaiseKey(e.key);
        return;
      }
      return;
    }
  }

  // =================================================================
  // Lifecycle.
  // =================================================================

  update(dt) {
    const top = this.stack[this.stack.length - 1];

    this._cursorTimer += dt * 1000;
    if (this._cursorTimer >= CURSOR_MS) {
      this._cursorTimer -= CURSOR_MS;
      this._cursorOn = !this._cursorOn;
      if (this.entryOpen) this._refreshEntry();
      if (top === "table" && this.chatOpen) this._refreshChatInput();
    }

    if (top === "table" && this.tableMode === "mp") {
      this._renderActionRow();
    }

    // Next-hand countdown label refresh.
    if (top === "table" && this._nextHandLabelText && this.nextHandLabel) {
      this.nextHandLabel.text = this._nextHandLabelText;
    }
  }
}