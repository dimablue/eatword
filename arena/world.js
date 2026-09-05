const { randomAnswer, isValidGuess, ANSWER_SET } = require("../words");
const { scoreGuess, sameColors } = require("./scoring");
const C = require("./constants");

const ANSWERS = [...ANSWER_SET];

let nextId = 1;

// ---------- geometry ----------
// Server-side source of truth; the client draws from the tile/r it is sent.
/**
 * Exponential approach to a ceiling: steep among small players, flattening as
 * mass climbs, so the difference between 100 and 300 reads clearly while 3000
 * and 30000 look alike. Strictly increasing, so heavier is never smaller.
 *
 * The curve lives on the tile rather than on the radius because the board is
 * drawn from tiles and the collision circle is derived from the board. Putting
 * it anywhere else would let the drawn board and the hitbox disagree.
 */
function tileSize(mass) {
  const grown = 1 - Math.exp(-Math.max(0, mass) / C.TILE_TAU);
  return C.TILE_MIN + (C.TILE_MAX - C.TILE_MIN) * grown;
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

/** Keep-out band along the walls that spawns respect. Proportional below the
 *  full-size arena so a shrunken playtest world still has somewhere to spawn. */
function spawnPad() {
  return Math.min(300, C.WORLD_SIZE * 0.25);
}

// ---------- puzzles ----------
let nextPuzzleId = 1;

/**
 * `draft` is the word you are part-way through typing. It lives on the puzzle
 * rather than the player because it belongs to the board: when the board is
 * stolen the half-typed word goes with it. `id` lets the client tell a new
 * puzzle from the current one, which is how it knows when to adopt a draft
 * instead of trusting what the player has typed locally.
 */
function newPuzzle() {
  return {
    id: nextPuzzleId++,
    answer: randomAnswer(),
    rows: [],
    done: false,
    solved: false,
    draft: "",
  };
}

function puzzleColors(p) {
  return p.rows.map((r) => r.colors);
}

// ---------- players ----------
/** START_MASS for everyone, except the playtest name (see DEV_NAME). */
function startMassFor(name) {
  const dev = C.DEV_NAME;
  return dev && String(name).trim().toLowerCase() === dev ? C.DEV_MASS : C.START_MASS;
}

function makePlayer(name, isBot) {
  const pad = spawnPad();
  // Held on the player so respawning returns you to the size you started at.
  const startMass = startMassFor(name);
  return {
    id: `a${nextId++}`,
    name,
    isBot: !!isBot,
    x: pad + Math.random() * (C.WORLD_SIZE - pad * 2),
    y: pad + Math.random() * (C.WORLD_SIZE - pad * 2),
    dx: 0,
    dy: 0,
    // Lunge impulse, decaying, carried on top of the steering velocity.
    lvx: 0,
    lvy: 0,
    lungeAt: -Infinity,
    startMass,
    mass: startMass,
    alive: true,
    puzzle: newPuzzle(),
    // The board that loads when the current one's hold expires. Normally empty
    // (a fresh puzzle is made on the spot); an eat parks the stolen board here.
    pending: null,
    events: [],
    // Whether they have been told what happens above DECAY_ABOVE. Latched, so
    // hovering at the threshold cannot repeat the explanation every few seconds.
    decayNoticed: false,
    // Same, for what a lunge costs. Explained on the first one rather than up
    // front, because the price only means something once you have felt the
    // burst, and never again after that: it survives respawning, since it is a
    // rule of the game rather than something about the life you just lost.
    lungeNoticed: false,
    resolveAt: 0,
    // bot-only
    waypoint: null,
    nextGuessAt: 0,
  };
}

class World {
  constructor() {
    this.players = new Map();
    // The world keeps its own clock, advanced by tick(). Nothing here reads the
    // wall clock, so the simulation behaves identically when run faster than
    // real time, which is the only way to test the economy.
    this.now = 0;
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
    const pad = spawnPad();
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
      // Far enough is far enough, but never in a world too small to offer it.
      if (bestClearance > Math.min(900, C.WORLD_SIZE / 3)) break;
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
    p.mass = p.startMass;
    p.alive = true;
    p.puzzle = newPuzzle();
    p.pending = null;
    p.dx = p.dy = 0;
    p.lvx = p.lvy = 0;
    p.lungeAt = -Infinity;
    p.decayNoticed = false;
    // lungeNoticed is deliberately NOT reset: what a lunge costs is a rule of
    // the game, not a fact about this life, and you only need telling once.
    p.resolveAt = 0;
    this.placeSafely(p);
  }

  /**
   * Spend mass for a burst along your current heading. Refused when you are not
   * steering anywhere (there is no direction to spend it in), while the burst is
   * on cooldown, and when paying would take you under LUNGE_MIN_MASS.
   *
   * The impulse is added to velocity rather than replacing it, and decays in
   * tick(), so it reads as a shove rather than a teleport.
   */
  lunge(id) {
    const p = this.players.get(id);
    if (!p || !p.alive) return { error: "Not in play" };
    if (!p.dx && !p.dy) return { quiet: true };
    if (this.now - p.lungeAt < C.LUNGE_COOLDOWN_MS) return { quiet: true };

    const cost =
      p.mass <= C.LUNGE_FREE_AT_OR_BELOW
        ? 0
        : Math.max(C.LUNGE_COST_MIN, p.mass * C.LUNGE_COST_FRAC);
    if (cost && p.mass - cost < C.LUNGE_MIN_MASS) return { error: "Too small to lunge" };

    p.mass -= cost;
    p.lungeAt = this.now;
    // Explained on the first burst whether or not it was charged for: what a
    // spawn needs to know is that it stops being free once they grow.
    if (!p.lungeNoticed) {
      p.lungeNoticed = true;
      p.events.push({
        kind: "lunge",
        pct: Math.round(C.LUNGE_COST_FRAC * 100),
        free: C.LUNGE_FREE_AT_OR_BELOW,
      });
    }
    // dx/dy are already normalised by setDirection, but a partial pull of the
    // mouse gives a shorter vector, so renormalise and a lunge is always full force.
    const m = Math.hypot(p.dx, p.dy) || 1;
    p.lvx += (p.dx / m) * C.LUNGE_SPEED;
    p.lvy += (p.dy / m) * C.LUNGE_SPEED;
    return { ok: true };
  }

  // ---------- guessing ----------
  /** Letters typed but not yet submitted. Kept server-side so they survive you. */
  setDraft(id, text) {
    const p = this.players.get(id);
    if (!p || !p.alive || !p.puzzle || p.puzzle.done) return;
    p.puzzle.draft = String(text || "")
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .slice(0, C.WORD_LEN);
  }

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
    puz.draft = "";

    if (colors.every((c) => c === "green")) {
      puz.done = true;
      puz.solved = true;
      // Earlier solves pay more: 1 guess -> +52, down to 6 guesses -> +22.
      const points = C.SOLVE_POINTS[puz.rows.length - 1] ?? 22;
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

  /**
   * Freeze the finished board so the client can play its reveal sequence.
   * Finishing a puzzle earns the full hold; an eat gets the short one, because
   * the player is mid-fight and cannot afford to stare at a spent board.
   */
  holdResult(p, ms = C.RESULT_HOLD_MS) {
    p.resolveAt = this.now + ms;
  }

  /** Load whatever comes next: a board taken off someone, else a fresh one. */
  nextPuzzle(p) {
    p.resolveAt = 0;
    p.puzzle = p.pending || newPuzzle();
    p.pending = null;
  }

  // ---------- simulation ----------
  tick(dt) {
    this.now += dt * 1000;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      // The reveal has run its course, so swap in the next puzzle.
      if (p.resolveAt && this.now >= p.resolveAt) this.nextPuzzle(p);
      const v = speed(p.mass);
      p.x += (p.dx * v + p.lvx) * dt;
      p.y += (p.dy * v + p.lvy) * dt;
      // Exponential decay, framerate-independent: the burst is spent in about
      // LUNGE_DECAY_S regardless of how often tick() runs.
      const keep = Math.exp(-dt / C.LUNGE_DECAY_S);
      p.lvx *= keep;
      p.lvy *= keep;
      // Hold the *board* inside the arena, not the collision circle. The circle
      // is 0.9 of the board's half-diagonal, so it sticks out past the sides and
      // clamping by it parks a big board ~91px off the wall while a small one
      // sits 29px off. That difference is what made corners unreachable: the
      // gap the eater couldn't close was manufactured by the clamp itself.
      const { w, h } = boardSize(p.mass);
      p.x = Math.min(C.WORLD_SIZE - w / 2, Math.max(w / 2, p.x));
      p.y = Math.min(C.WORLD_SIZE - h / 2, Math.max(h / 2, p.y));
      // Bleed above the threshold, floored at it. This pulls big leads back
      // down to DECAY_ABOVE, it does not erode you indefinitely.
      if (p.mass > C.DECAY_ABOVE) p.mass = Math.max(C.DECAY_ABOVE, p.mass * (1 - C.DECAY_RATE * dt));
      // Crossing it is the one rule nothing on screen explains, so say it once.
      // The re-arm sits well below the threshold: decay alone floors exactly at
      // it, so without the gap a player parked there would be told repeatedly.
      if (!p.decayNoticed && p.mass > C.DECAY_ABOVE) {
        p.decayNoticed = true;
        p.events.push({ kind: "decay", at: C.DECAY_ABOVE });
      } else if (p.decayNoticed && p.mass < C.DECAY_ABOVE * 0.9) {
        p.decayNoticed = false;
      }
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
    const gain = victim.mass * C.EAT_GAIN;
    eater.mass += gain;

    // You always take the board they were on, whatever state it was in. If they
    // had barely started, you inherit that too and your own progress is gone.
    // eating is a gamble on what they had, not a free bank of extra puzzles.
    // A board they had already finished is spent, so that one hands you a fresh
    // puzzle rather than a completed one you cannot play.
    const stolen = victim.puzzle && !victim.puzzle.done ? victim.puzzle : newPuzzle();

    // The stolen board does not replace yours on the spot. Yours is resolved
    // first and held up with its answer for HANDOFF_HOLD_MS, so the swap reads
    // as one puzzle finishing and another arriving instead of the grid changing
    // under your hands. Only typing pauses for it; you keep moving throughout.
    const mine = eater.puzzle;
    if (mine && !mine.done) {
      mine.done = true;
      mine.solved = true;
      mine.draft = "";
      eater.events.push({
        kind: "result",
        solved: true,
        word: mine.answer,
        points: Math.round(gain),
        handoff: true,
      });
      this.holdResult(eater, C.HANDOFF_HOLD_MS);
    }
    eater.pending = stolen;
    // Already mid-reveal, from a solve or a second kill inside one handoff. Let
    // that reveal run its course and land on the newest board; restarting it
    // would re-show an answer they have just read.
    if (!eater.resolveAt) this.nextPuzzle(eater);

    // Only worth announcing when there was something on the board to take.
    if (stolen.rows.length > 0 || stolen.draft) {
      eater.events.push({ kind: "stole", from: victim.name, guesses: stolen.rows.length });
    }

    eater.events.push({
      kind: "ate",
      name: victim.name,
      mass: Math.round(victim.mass),
      gain: Math.round(gain),
    });
    victim.events.push({
      kind: "eaten",
      by: eater.name,
      mass: Math.round(victim.mass),
      // The board as it stood at this instant, deep-copied: the rows themselves
      // now belong to the eater and will keep filling up. What the victim reads
      // on the death screen has to be where *they* left off, frozen here.
      word: victim.puzzle ? victim.puzzle.answer : "",
      rows: victim.puzzle
        ? victim.puzzle.rows.map((r) => ({ guess: r.guess, colors: [...r.colors] }))
        : [],
      draft: victim.puzzle ? victim.puzzle.draft : "",
    });

    victim.alive = false;
    victim.puzzle = null;
    victim.pending = null;
    victim.dx = victim.dy = 0;
    victim.lvx = victim.lvy = 0;
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
      puzzleId: p.puzzle ? p.puzzle.id : null,
      draft: p.puzzle ? p.puzzle.draft : "",
      done: !!(p.puzzle && p.puzzle.done),
      speed: Math.round(speed(p.mass)),
      lungeReady: this.now - p.lungeAt >= C.LUNGE_COOLDOWN_MS,
    };
  }

  /**
   * The letters publicView withholds, for the one board a spectator is allowed
   * to read. Merged onto that board's publicView rather than sent separately,
   * so the renderer draws one kind of thing and simply has more of it.
   *
   * Safe only because a spectator holds no board: they cannot act on this, and
   * when they are seated they spawn at START_MASS against the largest board in
   * the arena, the one player they have no way of hunting.
   */
  watchView(p) {
    return {
      guesses: p.puzzle ? p.puzzle.rows.map((r) => r.guess) : [],
      draft: p.puzzle ? p.puzzle.draft : "",
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

function botWord(puzzle) {
  // Sometimes throw away the feedback and guess blind. A bot that only ever
  // plays consistent words never wastes a turn, which is both inhuman and,
  // now that solves pay real mass, the main reason bots outgrow players.
  if (Math.random() < C.BOT_MISTAKE) {
    return ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
  }
  // Otherwise guess something still consistent with the feedback so far.
  const pool = ANSWERS.filter((w) =>
    puzzle.rows.every((r) => sameColors(scoreGuess(r.guess, w), r.colors))
  );
  const from = pool.length ? pool : ANSWERS;
  return from[Math.floor(Math.random() * from.length)];
}

function driveBots(world) {
  const now = world.now;
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

    // Chase anything clearly smaller, run from anything clearly bigger. Past
    // BOT_MAX_HUNT the chasing stops but the fleeing does not: a big bot keeps
    // solving and stays edible, it just no longer compounds by hunting.
    const hunting = p.mass < C.BOT_MAX_HUNT;
    let target = null;
    let flee = null;
    let best = Infinity;
    for (const o of world.players.values()) {
      if (o === p || !o.alive) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d > 900) continue;
      if (hunting && o.mass * C.EAT_MASS_RATIO * 1.1 < p.mass && d < best) {
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
      // Close the last stretch that walking never closes. lunge() enforces its
      // own cooldown and cost, so calling it every tick is safe and self-limiting.
      if (m < C.BOT_LUNGE_RANGE) world.lunge(p.id);
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
      p.nextGuessAt = now + C.BOT_GUESS_MS + Math.random() * C.BOT_GUESS_JITTER_MS;
      if (p.puzzle && !p.puzzle.done) world.guess(p.id, botWord(p.puzzle));
    }
  }
}

module.exports = {
  World,
  driveBots,
  tileSize,
  boardSize,
  radius,
  maxRadius,
  speed,
  C,
};
