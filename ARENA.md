# Eatword

A multiplayer arena where players *are* Wordle boards. Solve words to grow, eat
smaller boards, inherit their unfinished puzzle.

Built per `gamedesign.md`. Entirely separate from the original two-player
CoWordle (`server.js` + `public/`), which is untouched. The only thing shared
is the word list in `data/` via `words.js`.

## Run

```bash
npm run setup   # once, installs the client's deps
npm run build     # bundle the client
npm start           # http://localhost:3001
```

Live-reloading client while iterating:

```bash
npm start           # game server on :3001
npm run dev       # Vite UI on :5173, talks to :3001
```

`ARENA_PORT` changes the port. `ARENA_BOTS` sets the bot count (default 8,
`ARENA_BOTS=0` to disable).

Bots are seed population, never a cap on how many people can play: they stand
down for arriving humans, so nobody watches until all 50 boards are people.

8 is deliberately sparse. Measured against density, a wandering player has about
2.3 boards on screen and finds an empty one roughly 7% of the time, against 4.8
and 1% at 20 bots. That is the trade: quieter with nobody else on, and less
bot-on-bot churn once real players arrive. Somewhere past 30 it tips the other
way, with someone inside your threat radius 94% of the time, which never leaves
the quiet that solving a word actually takes.

## The lunge

Eating requires `EAT_MASS_RATIO` more mass than your prey, and `speed()` falls
as mass rises, so **an eater is always slower than what it is chasing**. Closing
speed is negative at every size (-15px/s against a spawn, -5px/s at 5000), which
makes hunting an alert player not hard but impossible, and hunting is half the
question the MVP exists to answer.

Space spends mass for a burst along your heading: an impulse of `LUNGE_SPEED`
decaying over `LUNGE_DECAY_S`, so about 114px of travel. Borrowed from agar.io's
split, minus the cell division. That part does not port, because a cell here is
a Wordle board and two of them raises the question of which holds your puzzle.

The cost is what makes it a decision rather than a free ability, and it sets how
big a lead you need before hunting works at all. Spending drops your mass, so a
hunter can pay for the catch and land on prey it can no longer legally eat.
Simulated against a prey running flat out, `LUNGE_COST_FRAC` of 0.04 puts that
break-even at **~1.4x**: a 1.4x board catches in 2-3 lunges at any size, a 1.3x
board spends itself under the threshold and gets nothing. Re-run that simulation
if either constant moves; the two are not independent.

Movement is never frozen, so the lunge stays live during the eat handoff, when
typing is not. Bots use it too; without it they cannot catch anything either.

## Why nobody runs away with it

Above `DECAY_ABOVE` (750) a board bleeds mass back down to that threshold at a
flat rate. Solving alone settles around 620, so decay only ever brakes a board
that grew by eating.

That was tuned when the default was five bots which could not catch each other,
so eating was rare. At twenty boards they collide constantly and the gains
compound: over 14 simulated minutes the leader averaged 2827 while third place
sat at 797, which is one runaway and nineteen bystanders.

The fix is `BOT_MAX_HUNT`, not a change to decay. Past 900 a bot stops chasing.
It keeps solving, keeps fleeing, and stays edible; it simply stops compounding.
The leader settles near 1726 with third place at 1068, and seven boards sit
above 750 instead of four.

Steepening decay for everyone was tried first and rejected. It caps the runaway
harder (leader near 1391) but taxes a human who earned their way up there just
as much, and decay exists to stop leads compounding away from new spawns rather
than to punish winning. Bots already carry throttles nobody else does
(`BOT_MISTAKE`, `BOT_GUESS_MS`) for exactly this reason: they are here to
populate the arena, not to win it.

Worth knowing the lunge is *not* what caused this. Bots grow **larger** without
it (4328 against 2543 over the same run), because lunging costs them mass and
makes them catchable in turn.

## Testing a collision

Eating and being eaten are both hard to reach in normal play, and bots are the
worst possible target: they flee anything big enough to eat them, and `speed()`
falls as mass rises, so an eater is **always** slower than its prey. A fleeing
bot is uncatchable by design. `arena/spar.js` connects a cooperative opponent
over the ordinary WebSocket protocol instead, and the server cannot tell it from a
person, so it exercises the real code path.

```bash
ARENA_BOTS=0 ARENA_WORLD=900 ARENA_DEV_MASS=150 npm start   # terminal 1
npm run spar                                              # terminal 2
```

Then join the browser as `tester` and steer into the duck: it stands still,
holding a board two guesses in with a third half-typed, so the handoff has real
inherited work to show. Roughly a second from spawn to collision.

To be eaten instead, join under any other name and run:

```bash
npm run spar -- --hunt
```

Everything it spawns respawns on its own, so one process lasts a session.
`-n 3` for more ducks, `--target <name>` to aim a hunter, `--port` for a
non-default port.

Two environment variables carry most of the weight here:

- **`ARENA_DEV_MASS=150`.** A hunter can only get mass by wearing `DEV_NAME`,
  and so can you. The default of 5000 clears `EAT_MASS_RATIO` easily but drops
  whoever holds it to a third of their prey's speed: big enough to eat, far
  too slow to reach anything. 150 eats a 100 and still steers.
- **`ARENA_WORLD=900`** shrinks the arena. This matters for the duck, which
  *you* have to find with no minimap: at full size you can spawn 5900px away. A
  hunter needs no help, since it claims a viewport the size of the world, which
  defeats the server's distance culling and lets it home in from anywhere. Leave
  the arena full size when testing `--hunt` if you want time to play a few
  guesses before it arrives.

## Layout

| Path | What |
| --- | --- |
| `arena-server.js` | HTTP + WebSocket server, tick and broadcast loops |
| `arena/constants.js` | All tuning: sizes, speeds, mass rewards, ratios |
| `arena/world.js` | Authoritative simulation: movement, eating, puzzles, bots |
| `arena/scoring.js` | Wordle feedback scoring |
| `arena/names.js` | Bot names from randomuser.me, with a local generator behind it |
| `arena-client/public/fonts/` | Libre Franklin, self-hosted so the game needs no CDN |
| `arena-client/src/draw.ts` | Canvas rendering of the arena and boards |
| `arena-client/src/Arena.tsx` | Canvas, camera, pointer input |
| `arena-client/src/MyWordle.tsx` | Your own grid, letters visible |
| `arena-client/src/Grid.tsx` | The 6x5 board: live under your puzzle, frozen on the death screen |

## What the server decides

Positions, mass, collisions, answers, validation, and **what each player is
allowed to see**. Other players' boards are transmitted as colours only, never
letters or guessed words, and only for boards inside your viewport. A stolen
puzzle arrives with its full guess history, letters included, because it is
yours now.

It also owns the *timing* of every board swap. A finished board is held on
`player.resolveAt` while the next one waits on `player.pending`, so the reveal
and the swap are one server-driven beat that the client can only render, never
drift from.

## Eating a board

An eat does not replace your grid on the spot, because the grid changing under
your hands mid-fight reads as a bug. Instead:

1. Your own puzzle is resolved and frozen, and the mass the kill paid is
   attached to it as its score.
2. It is held for `HANDOFF_HOLD_MS` (700ms), pulsing green and naming the
   answer as *yours*, not as solved. Typing is refused for exactly this long;
   **movement is not**, since you are still in a fight.
3. The board you took loads, with the victim's guesses, tile colours and
   half-typed word intact, and typing resumes.

The client's exit animation is driven by the same number, sent as `handoffMs`
and passed into CSS as `--hold`, so the board finishes leaving on the packet
that swaps it.

The victim gets the mirror of this: the `eaten` event carries a **deep copy** of
their board and its answer, taken at the instant it changed hands. It has to be
a copy, because the rows themselves now belong to the eater and keep filling up, and
the death screen has to show where the victim left off, not where their killer
has got to since.

## Typeface

Libre Franklin, the open revival of Franklin Gothic, which ships on Windows but
not macOS. Self-hosted from `arena-client/public/fonts/` rather than pulled from
Google Fonts, so the arena renders correctly with no internet at all and makes
no third-party request on load.

Google serves the family as a variable font: request 400, 600 and 700 and all
three point at one URL per subset, so there are two files (latin, latin-ext) and
the `@font-face` rules declare a `100 900` range rather than three faces. Refresh
them from the css2 API if the family is ever updated.

The canvas keeps its own copy of the stack in `FONT` at the top of `draw.ts`,
because canvas takes no CSS variables. Change one and change the other, or the
boards in the arena end up in a different typeface from the board under your
hands.

## Notes

- **Bots** are not in the design doc. They exist so a solo playtest can actually
  answer the MVP question; `ARENA_BOTS=0` turns them off. They guess words that
  are still consistent with their own feedback, so they solve at a human-ish rate.
- **Bot names** are fetched from `randomuser.me` (`login.username`), capped at
  12 characters to match human names and to stop a name stretching the
  leaderboard or overhanging its board. Names that overrun lose their trailing
  digits and are reconsidered, so `ticklishbear298` becomes `ticklishbear`;
  what still will not fit is discarded, which costs about a third of a batch.
  The generator at randomusernameapi.github.io was the first choice and its
  docs are still up, but the deployment behind it is gone: every path on
  `usernameapiv1.vercel.app` answers `404 DEPLOYMENT_NOT_FOUND`. Swapping to
  another source means changing `API_URL` and `pluck` together in
  `arena/names.js`. A local generator sits behind the network so the arena can
  start offline, the startup line reports how many names each source supplied
  so a dead API is visible rather than silent, and `ARENA_NAME_API=0` skips the
  network entirely.
- **Spawn placement** samples 24 points and picks the one furthest from anything
  large enough to eat you. Without it you can die before your first frame.
- `arena/scoring.js` duplicates `scoreGuess` from `server.js` because requiring
  `server.js` would start its listener.
