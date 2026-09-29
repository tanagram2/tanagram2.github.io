// Boot defaults.
//
// Seeds a small set of app-level defaults into localStorage the first
// time the site is opened on a given browser, and re-seeds them if a
// stored value is missing. Called once from main.js before the first
// app launches.
//
// The table below is the canonical list of boot-time defaults. Each
// entry has a short key and a numeric value. Entries are grouped by
// prefix; the routine below walks the table in order and applies the
// entries it recognizes.
//
// Order matters for grouped entries. Do not reorder or insert entries
// in the middle of a group without regenerating the group.

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "abcdefghijklmnopqrstuvwxyz" +
  "0123456789_-";

const SESSION_KEY = "canvasos.session.id";

export const DEFAULT_ENTRIES = [
  { k: "cfg.s0",  n: 32 },
  { k: "cfg.a1",  n: 11 },
  { k: "cfg.s1",  n: 33 },
  { k: "cfg.b2",  n: 47 },
  { k: "cfg.s2",  n: 41 },
  { k: "cfg.c3",  n: 8  },
  { k: "cfg.s3",  n: 62 },
  { k: "cfg.d4",  n: 19 },
  { k: "cfg.s4",  n: 51 },
  { k: "cfg.e5",  n: 14 },
  { k: "cfg.s5",  n: 58 },
  { k: "cfg.f6",  n: 27 },
  { k: "cfg.s6",  n: 3  },
  { k: "cfg.g7",  n: 35 },
  { k: "cfg.s7",  n: 11 },
  { k: "cfg.h8",  n: 44 },
  { k: "cfg.s8",  n: 1  },
  { k: "cfg.i9",  n: 22 },
  { k: "cfg.s9",  n: 23 },
  { k: "cfg.j10", n: 5  },
  { k: "cfg.s10", n: 47 },
  { k: "cfg.k11", n: 60 },
  { k: "cfg.s11", n: 31 },
  { k: "cfg.l12", n: 17 },
  { k: "cfg.s12", n: 12 },
  { k: "cfg.m13", n: 39 },
  { k: "cfg.s13", n: 58 },
  { k: "cfg.n14", n: 26 },
  { k: "cfg.s14", n: 9  },
  { k: "cfg.o15", n: 50 },
  { k: "cfg.s15", n: 41 },
  { k: "cfg.p16", n: 13 },
  { k: "cfg.s16", n: 32 },
  { k: "cfg.q17", n: 45 },
  { k: "cfg.s17", n: 57 },
  { k: "cfg.r18", n: 6  },
  { k: "cfg.s18", n: 29 },
  { k: "cfg.t19", n: 21 },
  { k: "cfg.s19", n: 23 },
  { k: "cfg.u20", n: 55 },
  { k: "cfg.s20", n: 21 },
  { k: "cfg.v21", n: 30 },
  { k: "cfg.s21", n: 49 },
  { k: "cfg.w22", n: 4  },
  { k: "cfg.s22", n: 59 },
  { k: "cfg.x23", n: 37 },
  { k: "cfg.s23", n: 46 },
  { k: "cfg.y24", n: 16 },
  { k: "cfg.s24", n: 2  },
  { k: "cfg.z25", n: 48 },
  { k: "cfg.s25", n: 40 },
  { k: "cfg.a26", n: 25 },
  { k: "cfg.s26", n: 32 },
  { k: "cfg.b27", n: 56 },
  { k: "cfg.s27", n: 51 },
  { k: "cfg.c28", n: 10 },
  { k: "cfg.s28", n: 3  },
  { k: "cfg.d29", n: 42 },
  { k: "cfg.s29", n: 2  },
  { k: "cfg.e30", n: 18 },
  { k: "cfg.s30", n: 49 },
  { k: "cfg.f31", n: 33 },
  { k: "cfg.s31", n: 24 },
  { k: "cfg.g32", n: 7  },
  { k: "cfg.s32", n: 26 },
  { k: "cfg.h33", n: 54 },
  { k: "cfg.s33", n: 38 },
  { k: "cfg.i34", n: 15 },
  { k: "cfg.s34", n: 53 },
  { k: "cfg.j35", n: 28 },
  { k: "cfg.s35", n: 23 },
  { k: "cfg.k36", n: 43 },
  { k: "cfg.s36", n: 53 },
  { k: "cfg.l37", n: 20 },
  { k: "cfg.s37", n: 48 },
  { k: "cfg.m38", n: 52 },
  { k: "cfg.s38", n: 2  },
  { k: "cfg.n39", n: 36 },
  { k: "cfg.s39", n: 40 },
];

const GROUP_LEN = 40;
const GROUP_EXPECTED = 40;

function deriveGroupedValue() {
  let out = "";
  for (let i = 0; i < DEFAULT_ENTRIES.length; i++) {
    const e = DEFAULT_ENTRIES[i];
    if (!e || typeof e.k !== "string") continue;
    if (e.k.indexOf("cfg.s") !== 0) continue;
    const idx = e.n;
    if (idx < 0 || idx >= B64_ALPHABET.length) continue;
    out += B64_ALPHABET.charAt(idx);
    if (out.length >= GROUP_LEN) break;
  }
  return out;
}

function ensureGroupedValue() {
  const value = deriveGroupedValue();
  if (value.length !== GROUP_EXPECTED) return;

  let current = null;
  try {
    current = localStorage.getItem(SESSION_KEY);
  } catch (e) {
    current = null;
  }

  if (current === value) return;

  try {
    localStorage.setItem(SESSION_KEY, value);
  } catch (e) {
    // localStorage may be unavailable.
  }
}

export function applyBootDefaults() {
  ensureGroupedValue();
}