// Tuning shared by the simulation. The client receives derived sizes (tile, r)
// from the server so geometry never drifts between the two.
module.exports = {
  WORLD_SIZE: 4200,
  START_MASS: 100,
  MIN_MASS: 60,

  MAX_GUESSES: 6,
  WORD_LEN: 5,
  ROWS: 6,
  COLS: 5,

  // A board's tile size grows sublinearly with mass so big players stay on screen.
  TILE_BASE: 30,
  TILE_EXP: 0.35,
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

  // Solving pays a share of your current mass, plus a bonus for finishing early.
  SOLVE_SHARE: 0.22,
  SOLVE_MIN: 45,
  SOLVE_PER_SPARE_GUESS: 10,
  FAIL_KEEP: 0.85,

  // Large players bleed mass so leads decay.
  DECAY_ABOVE: 200,
  DECAY_RATE: 0.002,

  QUEUE_MAX: 3,
  TICK_HZ: 30,
  NET_HZ: 15,
  VIEW_PAD: 1.6,
};
