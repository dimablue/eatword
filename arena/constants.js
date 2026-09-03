// Tuning shared by the simulation. The client receives derived sizes (tile, r)
// from the server so geometry never drifts between the two.
module.exports = {
  WORLD_SIZE: 4200,
  START_MASS: 100,

  MAX_GUESSES: 6,
  WORD_LEN: 5,
  ROWS: 6,
  COLS: 5,

  // Board size saturates with mass: fast growth while you are small, tapering to
  // a ceiling it approaches but never reaches, so no board can swallow the
  // viewport. Mass itself stays unbounded — only the drawing of it is capped.
  //   tile = TILE_MIN + (TILE_MAX - TILE_MIN) * s / (s + TILE_K),  s = sqrt(mass)
  TILE_MIN: 16,
  TILE_MAX: 84,
  // sqrt(mass) at which a board is halfway from TILE_MIN to TILE_MAX (mass ~1490).
  TILE_K: 38.6,
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

  // Points for a solve, indexed by guesses used: 1 guess -> +6, ... 6 guesses -> +1.
  SOLVE_POINTS: [6, 5, 4, 3, 2, 1],
  // Failing costs nothing at all — no mass, no points, no size change.

  // How long a finished board stays up, revealing the word, before the next
  // puzzle loads. Held on the server so onlookers see your final board too.
  RESULT_HOLD_MS: 850,

  // Large players bleed mass so leads decay.
  DECAY_ABOVE: 200,
  DECAY_RATE: 0.002,

  QUEUE_MAX: 3,
  TICK_HZ: 30,
  NET_HZ: 15,
  VIEW_PAD: 1.6,
};
