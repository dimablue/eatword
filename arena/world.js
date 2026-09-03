const { randomAnswer, isValidGuess, ANSWER_SET } = require("../words");
const { scoreGuess, sameColors } = require("./scoring");
const C = require("./constants");

const ANSWERS = [...ANSWER_SET];

let nextId = 1;

// ---------- geometry ----------
// Server-side source of truth; the client draws from the tile/r it is sent.
/**
 * Saturating growth on sqrt(mass). Strictly increasing, so a heavier board is
 * always a visibly bigger board, but it converges on TILE_MAX instead of
 * running away. The curve lives on the tile rather than on the radius because
 * the board is drawn from tiles and the collision circle is derived from the
 * board — putting it anywhere else would let the drawn board and the hitbox
 * disagree.
 */
function tileSize(mass) {
  const s = Math.sqrt(Math.max(0, mass));
  return C.TILE_MIN + (C.TILE_MAX - C.TILE_MIN) * (s / (s + C.TILE_K));
}

/** The ceiling every board approaches; nothing can exceed it. */
function maxRadius() {
  const t = C.TILE_MAX;
  const gap = t * C.GAP_RATIO;
  const w = C.COLS * t + (C.COLS - 1) * gap;
  const h = C.ROWS * t + (C.ROWS - 1) * gap;
  return C.RADIUS_RATIO * Math.hypot(w, h);
}
function boardSize(mass) {
  const t = tileSize(mass);
  const gap = t * C.GAP_RATIO;
  return { t, gap, w: C.COLS * t + (C.COLS - 1) * gap, h: C.ROWS * t + (C.ROWS - 1) * gap };
}
function radius(mass) {
  const { w, h } = boardSize(mass);
  return C.RADIUS_RATIO * Math.hypot(w, h);
}
function speed(mass) {
  return C.SPEED_BASE * Math.pow(C.START_MASS / mass, C.SPEED_EXP);
}

// ---------- puzzles ----------
function newPuzzle() {
  return { answer: randomAnswer(), rows: [], done: false, solved: false };
}

function puzzleColors(p) {
  return p.rows.map((r) => r.colors);
}

// ---------- players ----------
function makePlayer(name, isBot) {
  const pad = 300;
  return {
    id: `a${nextId++}`,
    name,
    isBot: !!isBot,
    x: pad + Math.random() * (C.WORLD_SIZE - pad * 2),
    y: pad + Math.random() * (C.WORLD_SIZE - pad * 2),
    dx: 0,
    dy: 0,
    mass: C.START_MASS,
    alive: true,
    puzzle: newPuzzle(),
    queue: [],
    events: [],
    resolveAt: 0,
    // bot-only
    waypoint: null,
    nextGuessAt: 0,
  };
}

class World {
  constructor() {
    this.players = new Map();
    this.lastTick = Date.now();
  }

  add(name, isBot) {
    const p = makePlayer(name, isBot);
    this.players.set(p.id, p);
    this.placeSafely(p);
    return p;
  }

  /**
   * Spawning on top of a bigger board is an instant death you can't react to.
   * Sample a few points and take the one furthest from anything that could eat you.
   */
  placeSafely(p) {
    const pad = 300;
    let best = { x: p.x, y: p.y };
    let bestClearance = -Infinity;
    for (let i = 0; i < 24; i++) {
      const x = pad + Math.random() * (C.WORLD_SIZE - pad * 2);
      const y = pad + Math.random() * (C.WORLD_SIZE - pad * 2);
      let clearance = Infinity;
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue;
        if (o.mass < p.mass * C.EAT_MASS_RATIO) continue;
        clearance = Math.min(clearance, Math.hypot(o.x - x, o.y - y) - radius(o.mass));
      }
      if (clearance > bestClearance) {
        bestClearance = clearance;
        best = { x, y };
      }
      if (bestClearance > 900) break;
    }
    p.x = best.x;
    p.y = best.y;
  }

  remove(id) {
    this.players.delete(id);
  }

  get(id) {
    return this.players.get(id);
  }

  setDirection(id, dx, dy) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    p.dx = dx;
    p.dy = dy;
  }

  respawn(id) {
    const p = this.players.get(id);
    if (!p || p.alive) return;
    p.mass = C.START_MASS;
    p.alive = true;
    p.puzzle = newPuzzle();
    p.queue = [];
    p.dx = p.dy = 0;
    p.resolveAt = 0;
    this.placeSafely(p);
  }

  // ---------- guessing ----------
  guess(id, word) {
    const p = this.players.get(id);
    if (!p || !p.alive) return { error: "Not in play" };
    const guess = String(word || "").toLowerCase().trim();
    if (guess.length !== C.WORD_LEN) return { error: "Not enough letters" };
    if (!isValidGuess(guess)) return { error: "Not in word list" };
    const puz = p.puzzle;
    // Mid-reveal: swallow the keystroke rather than flashing an error at them.
    if (puz.done) return { held: true };
    if (puz.rows.some((r) => r.guess === guess)) return { error: "Already guessed" };

    const colors = scoreGuess(guess, puz.answer);
    puz.rows.push({ guess, colors });

    if (colors.every((c) => c === "green")) {
      puz.done = true;
      puz.solved = true;
      // Earlier solves pay more: 1 guess -> +6, down to 6 guesses -> +1.
      const points = C.SOLVE_POINTS[puz.rows.length - 1] ?? 1;
      p.mass += points;
      p.events.push({ kind: "result", solved: true, word: puz.answer, points });
      this.holdResult(p);
      return { ok: true };
    }

    if (puz.rows.length >= C.MAX_GUESSES) {
      // Out of guesses: reveal the answer, award nothing, take nothing away.
      puz.done = true;
      p.events.push({ kind: "result", solved: false, word: puz.answer, points: 0 });
      this.holdResult(p);
    }
    return { ok: true };
  }

  /** Freeze the finished board so the client can play its reveal sequence. */
  holdResult(p) {
    p.resolveAt = Date.now() + C.RESULT_HOLD_MS;
  }

  // Pull the next stolen puzzle if one is waiting, otherwise a fresh word.
  nextPuzzle(p) {
    p.resolveAt = 0;
    p.puzzle = p.queue.length ? p.queue.shift() : newPuzzle();
  }

  // ---------- simulation ----------
  tick(dt) {
    const now = Date.now();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      // The reveal has run its course — swap in the next puzzle.
      if (p.resolveAt && now >= p.resolveAt) this.nextPuzzle(p);
      const v = speed(p.mass);
      p.x += p.dx * v * dt;
      p.y += p.dy * v * dt;
      const r = radius(p.mass);
      p.x = Math.min(C.WORLD_SIZE - r, Math.max(r, p.x));
      p.y = Math.min(C.WORLD_SIZE - r, Math.max(r, p.y));
      if (p.mass > C.DECAY_ABOVE) p.mass = Math.max(C.DECAY_ABOVE, p.mass * (1 - C.DECAY_RATE * dt));
    }
    this.resolveEating();
  }

  resolveEating() {
    const list = [...this.players.values()].filter((p) => p.alive);
    // Heaviest first so a chain of overlaps resolves in favour of the bigger board.
    list.sort((a, b) => b.mass - a.mass);
    for (const a of list) {
      if (!a.alive) continue;
      for (const b of list) {
        if (b === a || !b.alive || !a.alive) continue;
        if (a.mass < b.mass * C.EAT_MASS_RATIO) continue;
        const ra = radius(a.mass);
        const rb = radius(b.mass);
        if (Math.hypot(a.x - b.x, a.y - b.y) > ra - rb * C.EAT_OVERLAP) continue;
        this.eat(a, b);
      }
    }
  }

  eat(eater, victim) {
    eater.mass += victim.mass * C.EAT_GAIN;

    // The victim's unfinished puzzle transfers intact, letters and all.
    const stolen = victim.puzzle;
    let stoleActive = false;
    // Only progress is worth inheriting; an untouched puzzle carries nothing.
    if (stolen && !stolen.done && stolen.rows.length > 0) {
      if (eater.puzzle && !eater.puzzle.done && eater.puzzle.rows.length > 0) {
        if (eater.queue.length < C.QUEUE_MAX) eater.queue.push(stolen);
      } else {
        eater.puzzle = stolen;
        eater.resolveAt = 0;
        stoleActive = true;
      }
      eater.events.push({
        kind: "stole",
        from: victim.name,
        guesses: stolen.rows.length,
        active: stoleActive,
      });
    }

    eater.events.push({ kind: "ate", name: victim.name, mass: Math.round(victim.mass) });
    victim.events.push({ kind: "eaten", by: eater.name, mass: Math.round(victim.mass) });

    victim.alive = false;
    victim.puzzle = null;
    victim.queue = [];
    victim.dx = victim.dy = 0;
  }

  // ---------- views ----------
  // What everyone may see of a board: colours, guess count, mass. Never letters.
  publicView(p) {
    return {
      id: p.id,
      name: p.name,
      x: Math.round(p.x),
      y: Math.round(p.y),
      mass: Math.round(p.mass),
      tile: +tileSize(p.mass).toFixed(2),
      r: +radius(p.mass).toFixed(1),
      colors: p.puzzle ? puzzleColors(p.puzzle) : [],
    };
  }

  privateView(p) {
    return {
      id: p.id,
      alive: p.alive,
      mass: Math.round(p.mass),
      rows: p.puzzle ? p.puzzle.rows : [],
      done: !!(p.puzzle && p.puzzle.done),
      queued: p.queue.length,
      speed: Math.round(speed(p.mass)),
    };
  }

  leaderboard(n = 8) {
    return [...this.players.values()]
      .filter((p) => p.alive)
      .sort((a, b) => b.mass - a.mass)
      .slice(0, n)
      .map((p) => ({ id: p.id, name: p.name, mass: Math.round(p.mass) }));
  }

  // Only players near you are transmitted, so distant boards can't be datamined.
  near(p, halfW, halfH) {
    const out = [];
    for (const o of this.players.values()) {
      if (!o.alive) continue;
      const ro = radius(o.mass);
      if (Math.abs(o.x - p.x) > halfW + ro) continue;
      if (Math.abs(o.y - p.y) > halfH + ro) continue;
      out.push(o);
    }
    return out;
  }
}

// ---------- bots ----------
// Not in the design doc, but a solo playtest of an empty arena answers nothing.
const BOT_NAMES = [
  "otter", "pixel", "moss", "quill", "juno", "atlas", "wren", "cobalt",
  "fig", "nimbus", "peppr", "loam", "vex", "tally", "orbit",
];

function botWord(puzzle) {
  // Guess something still consistent with the feedback so far.
  const pool = ANSWERS.filter((w) =>
    puzzle.rows.every((r) => sameColors(scoreGuess(r.guess, w), r.colors))
  );
  const from = pool.length ? pool : ANSWERS;
  return from[Math.floor(Math.random() * from.length)];
}

function driveBots(world, now) {
  for (const p of world.players.values()) {
    if (!p.isBot) continue;

    if (!p.alive) {
      if (!p.deadAt) p.deadAt = now;
      else if (now - p.deadAt > 3000) {
        world.respawn(p.id);
        p.deadAt = 0;
      }
      continue;
    }
    p.deadAt = 0;

    // Chase anything clearly smaller, run from anything clearly bigger.
    let target = null;
    let flee = null;
    let best = Infinity;
    for (const o of world.players.values()) {
      if (o === p || !o.alive) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d > 900) continue;
      if (o.mass * C.EAT_MASS_RATIO * 1.1 < p.mass && d < best) {
        best = d;
        target = o;
      }
      if (o.mass > p.mass * C.EAT_MASS_RATIO && d < 500) flee = o;
    }

    if (flee) {
      const m = Math.hypot(p.x - flee.x, p.y - flee.y) || 1;
      world.setDirection(p.id, (p.x - flee.x) / m, (p.y - flee.y) / m);
    } else if (target) {
      const m = Math.hypot(target.x - p.x, target.y - p.y) || 1;
      world.setDirection(p.id, (target.x - p.x) / m, (target.y - p.y) / m);
    } else {
      if (!p.waypoint || Math.hypot(p.waypoint.x - p.x, p.waypoint.y - p.y) < 120) {
        p.waypoint = {
          x: 200 + Math.random() * (C.WORLD_SIZE - 400),
          y: 200 + Math.random() * (C.WORLD_SIZE - 400),
        };
      }
      const m = Math.hypot(p.waypoint.x - p.x, p.waypoint.y - p.y) || 1;
      world.setDirection(p.id, (p.waypoint.x - p.x) / m, (p.waypoint.y - p.y) / m);
    }

    if (now >= p.nextGuessAt) {
      p.nextGuessAt = now + 2500 + Math.random() * 3500;
      if (p.puzzle && !p.puzzle.done) world.guess(p.id, botWord(p.puzzle));
    }
  }
}

module.exports = {
  World,
  driveBots,
  BOT_NAMES,
  tileSize,
  boardSize,
  radius,
  maxRadius,
  speed,
  C,
};
