// Tuning shared by the simulation. The client receives derived sizes (tile, r)
// from the server so geometry never drifts between the two.
module.exports = {
  // ARENA_WORLD shrinks the arena for playtesting. At full size two players
  // spawn up to 5900px apart with no minimap to find each other by, which makes
  // testing anything about a collision an exercise in wandering; a few hundred
  // px puts everyone in the same screen. Play values are 4200.
  WORLD_SIZE: Number(process.env.ARENA_WORLD) || 4200,
  START_MASS: 100,

  // Boards on the map at once, bots included. The arena is a fixed size, so
  // population is what keeps it playable: past roughly this many, safe spawn
  // points run out and you start materialising next to something that eats you.
  // Bots give up their slot to arriving humans; humans past the cap spectate.
  MAX_PLAYERS: 50,

  // Playtest shortcut: join under this name and you spawn at DEV_MASS instead of
  // START_MASS, so the hunting half of the game can be tried without grinding up
  // to it first. Respawns keep it too. Names are not unique or authenticated, so
  // anyone who knows it can use it; set ARENA_DEV_NAME="" to turn it off.
  // Off by default in production so a public deploy cannot be walked into by
  // anyone who guesses the name; still on locally, where it is the whole point.
  // Set ARENA_DEV_NAME explicitly to override either way.
  DEV_NAME: (process.env.ARENA_DEV_NAME ?? (process.env.NODE_ENV === "production" ? "" : "tester"))
    .trim()
    .toLowerCase(),
  DEV_MASS: Number(process.env.ARENA_DEV_MASS) || 5000,

  MAX_GUESSES: 6,
  WORD_LEN: 5,
  ROWS: 6,
  COLS: 5,

  // Board size approaches a ceiling exponentially: most of the growth happens in
  // the first few hundred mass, where players actually spend their time, and it
  // flattens hard after that. Mass stays unbounded; only its drawing is capped.
  //   tile = TILE_MIN + (TILE_MAX - TILE_MIN) * (1 - e^(-mass / TILE_TAU))
  // TILE_MIN is the mass->0 asymptote and is never reached; spawning at
  // START_MASS puts you at ~26.
  TILE_MIN: 16,
  TILE_MAX: 80,
  // Mass constant of the curve: at TILE_TAU you are 63% of the way to the top.
  TILE_TAU: 600,
  GAP_RATIO: 0.14,

  // Collision circle as a fraction of the board's half-diagonal.
  RADIUS_RATIO: 0.45,

  SPEED_BASE: 300,
  SPEED_EXP: 0.28,

  // You can eat someone only if you outweigh them by this factor...
  EAT_MASS_RATIO: 1.2,
  // ...and your circle covers this much of theirs.
  EAT_OVERLAP: 0.4,
  EAT_GAIN: 0.7,

  // Points for a solve, indexed by guesses used: 1 guess -> +52, ... 6 guesses -> +22.
  // Tuned so a single solve always clears the eat threshold over an unsolved
  // spawn: the gap is START_MASS * (EAT_MASS_RATIO - 1) = 20, so even the
  // slowest solve must pay more than that. Only the floor is pinned, which
  // leaves the ladder free to be steep, at 6 mass per guess saved. The top stays
  // under EAT_GAIN * START_MASS (+70) so eating a spawn still beats the best
  // possible solve, and hunting keeps its edge over sitting still and typing.
  SOLVE_POINTS: [52, 46, 40, 34, 28, 22],
  // Failing costs nothing at all: no mass, no points, no size change.

  // How long a finished board stays up, revealing the word, before the next
  // puzzle loads. Held on the server so onlookers see your final board too.
  RESULT_HOLD_MS: 850,

  // The same hold, but for the board an eat resolves. Shorter than a solve's:
  // you are mid-fight, still moving, and the board you just inherited is the
  // half worth looking at. The client's exit animation runs for exactly this
  // long, so the two land together. Change one and the swap will visibly
  // outrun the other.
  //
  // Only about two thirds of it is legible; the rest is the reveal fading in
  // and the board leaving. Three lines of text need most of that plateau, so
  // this cannot go much below 600 without the answer becoming unreadable.
  HANDOFF_HOLD_MS: 700,

  // --- lunge ---
  // The one answer to a problem the speed curve cannot solve: eating requires
  // EAT_MASS_RATIO more mass than your prey, and speed() falls as mass rises,
  // so an eater is *always* slower than the board it is chasing. Closing speed
  // is negative at every size. Without a burst, hunting an alert player is not
  // hard, it is impossible, and "hunting players with valuable puzzle
  // progress" is half the question the MVP exists to answer.
  //
  // Borrowed from agar.io's split, minus the cell division: you buy reach with
  // mass on a commitment you cannot take back. The division itself does not
  // port here, because a cell is a Wordle board and two of them raises the
  // question of which one holds your puzzle.
  //
  // An impulse decaying exponentially, so the travel is LUNGE_SPEED *
  // LUNGE_DECAY_S ≈ 114px, enough to cross the last gap and not enough to
  // teleport onto someone. Deliberately NOT scaled by mass: a heavy board's
  // whole problem is that everything it can eat outruns it.
  LUNGE_SPEED: 520,
  LUNGE_DECAY_S: 0.22,
  LUNGE_COOLDOWN_MS: 1200,
  // Cost is a fraction of mass, so it scales with what you stand to gain.
  //
  // It also sets how big a lead you need before hunting is possible at all,
  // and that interaction is easy to get wrong: spending drops your mass, so a
  // hunter can pay for the catch and then find itself under EAT_MASS_RATIO,
  // physically on top of prey it can no longer eat. Simulated against a prey
  // running flat out, 0.04 lands on a consistent ~1.4x: a 1.4x board catches
  // in 2-3 lunges at any size, a 1.3x board spends itself under the threshold.
  // At exactly 1.2x no cost above zero can work, which is fine. Hunting
  // someone barely smaller than you should not be free.
  LUNGE_COST_FRAC: 0.04,
  LUNGE_COST_MIN: 4,
  // At or below spawn size the burst is free. A board this small has nothing
  // worth spending and no other way out of trouble, and charging it makes being
  // small strictly worse at the moment the game is already hardest. Keep this
  // equal to START_MASS, since an object literal cannot reference its own field.
  LUNGE_FREE_AT_OR_BELOW: 100,
  // Floor, so lunging can never shrink you into a degenerate board. Unreachable
  // while LUNGE_FREE_AT_OR_BELOW sits above it, since paying 4% from just over 100
  // lands you around 96, and from there it is free, but it is what stops a
  // smaller free threshold from letting someone spend themselves to nothing.
  LUNGE_MIN_MASS: 70,
  // How close a bot gets before spending mass on the last stretch.
  BOT_LUNGE_RANGE: 340,

  // Large players bleed mass so leads decay: above DECAY_ABOVE you lose
  // DECAY_RATE of your mass per second, floored at DECAY_ABOVE. The bleed
  // scales with size, so it costs the leader far more than anyone else and
  // stops mass compounding away from new spawns.
  //
  // The threshold is set above what solving alone can reach, so it only brakes
  // players who grew by eating. A strong solver earns ~74 mass/min, which
  // settles at income / (DECAY_RATE * 60) = ~620; 750 leaves them clear.
  // Re-derive it if SOLVE_POINTS changes again: at the old 1-6 points the
  // equivalent threshold was 200, and multiplying the points left it stranded.
  DECAY_ABOVE: 750,
  DECAY_RATE: 0.002,

  // Bots stop hunting above this. They keep solving, keep fleeing, and can
  // still be eaten; they simply stop chasing, so their mass stops compounding.
  //
  // This is a bot brake rather than a change to decay, and that distinction is
  // the point. Steepening decay for everyone does cap the runaway, but it taxes
  // a human who earned their way up there just as hard, and decay exists to
  // stop leads compounding away from new spawns, not to punish winning. Bots
  // already carry throttles nobody else does (BOT_MISTAKE, BOT_GUESS_MS) for
  // exactly this reason: they are here to populate the arena, not to win it.
  //
  // Set above DECAY_ABOVE so a capped bot is already inside the bleed and
  // drifts back down rather than parking at the cap forever.
  BOT_MAX_HUNT: 900,

  // --- bots ---
  // Chance a bot ignores its own feedback and guesses at random. Without this
  // they never waste a turn, solving 98% of boards in 4.05 guesses, which no
  // human sustains. Mistakes cost guesses, and SOLVE_POINTS pays less the
  // longer you take, so this throttles bot growth as well as bot skill.
  BOT_MISTAKE: 0.4,
  // Delay between bot guesses: BOT_GUESS_MS plus up to BOT_GUESS_JITTER_MS.
  // This is the dial that actually matters. A mistake costs a bot one rung on
  // the SOLVE_POINTS ladder and it usually still solves the board, so raising
  // BOT_MISTAKE alone barely dents their growth; taking longer per guess does.
  // At 9000+7000 a bot spends ~60s on a board, which is roughly human pace.
  BOT_GUESS_MS: 9000,
  BOT_GUESS_JITTER_MS: 7000,

  TICK_HZ: 30,
  // The client interpolates between packets and draws ~1.8 intervals in the
  // past, so this rate sets that delay: 20Hz costs a little bandwidth and buys
  // back ~30ms of it. Raising it further hits diminishing returns.
  NET_HZ: 20,
  VIEW_PAD: 1.6,
};
