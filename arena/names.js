// Bot names, so an arena of fifty does not read as fifteen recycled words.
//
// Fetched from a random username API. The one at randomusernameapi.github.io
// was the first choice and its docs are still up, but the Vercel deployment
// behind it is gone: every path on usernameapiv1.vercel.app answers 404
// DEPLOYMENT_NOT_FOUND. randomuser.me is live and long-running, and its
// login.username field is the same kind of value.
//
// Change API_URL and pluck() together to point somewhere else.
//
// The network is best effort: every path falls back to generating a name
// locally in the same shape, because a game server must not fail to start
// because a third party is down or the machine is offline. ARENA_NAME_API=0
// skips the network entirely.

const API_URL = (n) => `https://randomuser.me/api/?results=${n}&inc=login&noinfo`;
/** Pull the names out of whatever shape the API answers with. */
const pluck = (body) =>
  Array.isArray(body && body.results) ? body.results.map((r) => r && r.login && r.login.username) : [];

const USE_API = process.env.ARENA_NAME_API !== "0";
const TIMEOUT_MS = 4000;

// Matches the cap applied to human names in arena-server.js. Longer names are
// drawn above a board that may be 145px wide and stretch the leaderboard, so
// this is a layout constraint rather than a stylistic one.
const MAX_LEN = 12;

// These generators end a name with digits or an underscore, and most output
// overruns MAX_LEN. A name that will not fit gets its ending dropped and is
// reconsidered: "ticklishbear298" becomes "ticklishbear", which does fit.
// "beautifulladybug591" is still too long once trimmed and is discarded.
function trim(name) {
  if (typeof name !== "string") return null;
  const clean = name.trim();
  if (!clean) return null;
  if (clean.length <= MAX_LEN) return clean;
  const stripped = clean.replace(/(?:_|\d{1,4})$/, "");
  return stripped.length && stripped.length <= MAX_LEN ? stripped : null;
}

// The offline generator, in the same shape, for when the network is not there.
const PREFIXES = [
  "cosmic", "quantum", "stardust", "delta", "luna", "tech", "neon", "rusty",
  "silent", "amber", "nova", "iron", "velvet", "hollow", "bright", "frost",
];
const SUFFIXES = [
  "wolf", "pirate", "seeker", "moth", "mover", "fox", "ghost", "otter",
  "falcon", "crow", "rider", "sage", "bear", "lynx", "hawk", "duck",
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function localName() {
  for (let i = 0; i < 40; i++) {
    const name =
      trim(pick(PREFIXES) + pick(SUFFIXES) + Math.floor(Math.random() * 900 + 100)) ||
      trim(pick(PREFIXES) + pick(SUFFIXES));
    if (name) return name;
  }
  return "player" + Math.floor(Math.random() * 1000);
}

const pool = [];
let refilling = null;

async function fetchNames(count) {
  if (!USE_API) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL(count), { signal: ctrl.signal });
    if (!res.ok) return [];
    return pluck(await res.json()).map(trim).filter(Boolean);
  } catch {
    // Offline, timed out, rate limited, shape changed: all the same to us.
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Fill the pool up front so bots can be seeded synchronously afterwards. */
async function prime(want) {
  // Over-ask: names that cannot be shortened under MAX_LEN are discarded (about
  // a third of them), and duplicates within a batch collapse.
  const batch = await fetchNames(Math.ceil(want * 2) + 10);
  for (const n of batch) if (!pool.includes(n)) pool.push(n);
  return { fromApi: pool.length, wanted: want };
}

/** One name. Drains the pool first, then falls back to local generation. */
function take() {
  if (pool.length < 8 && !refilling && USE_API) {
    // Top up in the background; take() itself never waits on the network.
    refilling = prime(40).finally(() => {
      refilling = null;
    });
  }
  return pool.length ? pool.shift() : localName();
}

module.exports = { prime, take, localName, trim, MAX_LEN, USE_API };
