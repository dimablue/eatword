// A cooperative opponent for playtesting, driven over the same WebSocket
// protocol the browser speaks. The server cannot tell it from a person, so
// nothing here is a special case inside the game.
//
// Both halves of an eat are hard to reach in normal play, and bots are the
// worst possible target: they flee anything big enough to eat them, and
// speed() falls as mass rises, so an eater is *always* slower than its prey.
// A fleeing bot is uncatchable by design. What you need is someone who holds
// still, or someone who comes to you.
//
//   npm run spar                 a sitting duck, part-way through a board
//   npm run spar -- --hunt       a hunter that comes and eats you
//   npm run spar -- -n 3         three ducks
//   npm run spar -- --target ada pick who the hunter chases
//   npm run spar -- --port 3002
//
// Ctrl-C to leave. Everyone it spawns respawns on their own after being eaten,
// so one process lasts a whole session of iterating.
const { WebSocket } = require("ws");
const { randomAnswer, isValidGuess } = require("../words");
const { speed } = require("./world");
const C = require("./constants");

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const HUNT = flag("--hunt");
const PORT = opt("--port", process.env.ARENA_PORT || process.env.PORT || 3001);
const COUNT = Math.max(1, Number(opt("-n", opt("--count", 1))) || 1);
const TARGET = opt("--target", null);

/** Two guesses and a half-typed third, so an inherited board is obviously
 *  someone else's work and not a fresh one. */
const GUESSES = ["crane", "adopt"].map((w) => (isValidGuess(w) ? w : randomAnswer()));
const DRAFT = "sto";
const RESPAWN_MS = 1500;

const log = (tag, msg) => console.log(`  ${tag.padEnd(9)} ${msg}`);

/**
 * One opponent. `hunt` decides which of the two problems it solves: standing
 * still so you can catch it, or chasing you so you can be caught.
 */
function spar(name, { hunt }) {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const self = { id: null, world: C.WORLD_SIZE, x: 0, y: 0, mass: 0 };
  let lastGuessAt = 0;
  let diedAt = 0;
  let chasing = null;
  let warned = false;

  ws.on("open", () => ws.send(JSON.stringify({ type: "join", name })));
  ws.on("error", (e) => {
    console.error(`\n  cannot reach the arena on :${PORT}. Is \`npm start\` running?`);
    console.error(`  ${e.message}\n`);
    process.exit(1);
  });
  ws.on("close", () => log(name, "disconnected"));

  const send = (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));

  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (m.type === "welcome") {
      if (m.spectator) {
        log(name, "arena is full, spectating, no use as an opponent");
        return;
      }
      self.id = m.id;
      self.world = m.world;
      return;
    }
    if (m.type === "reject" || m.type !== "state" || !m.you) return;

    self.mass = m.you.mass;
    const here = m.players.find((p) => p.id === self.id);
    if (here) {
      self.x = here.x;
      self.y = here.y;
    }

    // Dead: come back on our own, so one process survives a whole session.
    if (!m.you.alive) {
      if (!diedAt) {
        diedAt = Date.now();
        log(name, "eaten, respawning");
      } else if (Date.now() - diedAt > RESPAWN_MS) {
        diedAt = 0;
        send({ type: "respawn" });
      }
      return;
    }
    diedAt = 0;

    // The server only sends boards inside your viewport, so a target across
    // the map is invisible. Claim a viewport the size of the world and the
    // culling stops hiding anyone. A browser would never ask for this; it is
    // the whole reason this script can find you without being told where.
    const view = { w: self.world * 2, h: self.world * 2, zoom: 1 };

    if (hunt) {
      const prey = m.players
        .filter((p) => p.id !== self.id && (!TARGET || p.name === TARGET))
        .filter((p) => self.mass >= p.mass * C.EAT_MASS_RATIO)
        .sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y))[0];

      if (!prey) {
        // Nothing edible in the whole arena, so say why rather than idling mutely.
        if (!warned) {
          warned = true;
          const biggest = m.players.filter((p) => p.id !== self.id).sort((a, b) => b.mass - a.mass)[0];
          if (!biggest) log(name, "nobody else in the arena yet, waiting");
          else
            log(
              name,
              `nothing edible: at ${Math.round(self.mass)} it cannot eat ${biggest.name} (${biggest.mass}). ` +
                `restart the server with ARENA_DEV_MASS=${Math.ceil(biggest.mass * C.EAT_MASS_RATIO) + 20}`
            );
        }
        return send({ type: "input", dx: 0, dy: 0, ...view });
      }
      warned = false;

      if (chasing !== prey.name) {
        chasing = prey.name;
        const mine = speed(self.mass);
        const theirs = speed(prey.mass);
        log(name, `chasing ${prey.name} (${prey.mass})`);
        if (mine < theirs) {
          // Not a bug in the script; the speed curve guarantees it.
          log(
            "",
            `you are faster (${Math.round(theirs)} vs ${Math.round(mine)}), so it can only catch ` +
              `you if you hold still or steer into it`
          );
        }
      }
      const d = Math.hypot(prey.x - self.x, prey.y - self.y) || 1;
      return send({ type: "input", dx: (prey.x - self.x) / d, dy: (prey.y - self.y) / d, ...view });
    }

    // A duck. Never moves, and keeps a part-played board on the go so that
    // whoever eats it inherits visible work rather than an empty grid.
    send({ type: "input", dx: 0, dy: 0, ...view });

    if (m.you.done) return; // mid-reveal; the server is about to deal a new board
    const now = Date.now();
    if (m.you.rows.length < GUESSES.length && now - lastGuessAt > 250) {
      lastGuessAt = now;
      send({ type: "guess", guess: GUESSES[m.you.rows.length] });
    } else if (m.you.rows.length >= GUESSES.length && m.you.draft !== DRAFT) {
      send({ type: "typing", text: DRAFT });
      log(name, `board ready: ${m.you.rows.map((r) => r.guess.toUpperCase()).join(", ")}, typing "${DRAFT.toUpperCase()}"`);
    }
  });
}

console.log(`\n  spar -> ws://localhost:${PORT}\n`);

if (HUNT) {
  // Mass is the server's to hand out, and DEV_NAME is the only lever a client
  // has on it, so a hunter has to wear that name to be big enough to eat you.
  if (!C.DEV_NAME) {
    console.error("  ARENA_DEV_NAME is empty, so a hunter cannot be given the mass to eat anything.");
    console.error("  Restart the server with ARENA_DEV_NAME=tester ARENA_DEV_MASS=150.\n");
    process.exit(1);
  }
  log("hunter", `joining as "${C.DEV_NAME}" to be dealt ARENA_DEV_MASS`);
  if (C.DEV_MASS > 400) {
    log(
      "",
      `heads up: ARENA_DEV_MASS is ${C.DEV_MASS} on this process. If the server has that too, ` +
        `the hunter is heavy and slow (${Math.round(speed(C.DEV_MASS))}/s vs your ${Math.round(speed(C.START_MASS))}/s). ` +
        `ARENA_DEV_MASS=150 is a better sparring weight`
    );
  }
  spar(C.DEV_NAME, { hunt: true });
} else {
  for (let i = 0; i < COUNT; i++) {
    const name = COUNT === 1 ? "duck" : `duck${i + 1}`;
    log(name, "standing still, steer into it to trigger the handoff");
    spar(name, { hunt: false });
  }
  console.log(
    `\n  you need to outweigh it by ${C.EAT_MASS_RATIO}x to eat it, and every eater is slower\n` +
      `  than its prey. Join as "${C.DEV_NAME || "?"}" with ARENA_DEV_MASS=150 to spar comfortably.`
  );
}
console.log("");
