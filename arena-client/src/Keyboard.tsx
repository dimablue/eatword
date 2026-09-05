import type { Color, Row } from "./types";

const LAYOUT = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

/** Best news wins: a letter seen green somewhere never falls back to yellow. */
const RANK: Record<Color, number> = { gray: 0, yellow: 1, green: 2 };

/** Fold every submitted row into one colour per letter. */
export function letterStates(rows: Row[]): Record<string, Color> {
  const best: Record<string, Color> = {};
  for (const row of rows) {
    for (let i = 0; i < row.guess.length; i++) {
      const ch = row.guess[i];
      const seen = best[ch];
      if (!seen || RANK[row.colors[i]] > RANK[seen]) best[ch] = row.colors[i];
    }
  }
  return best;
}

interface Props {
  rows: Row[];
}

/**
 * The letter tracker under your grid. Display only; `.mine` sets
 * `pointer-events: none` because the mouse steers your board, so a clickable
 * key would drag you toward the bottom of the arena every time you pressed it.
 */
export default function Keyboard({ rows }: Props) {
  const state = letterStates(rows);
  return (
    <div className="keyboard" aria-hidden="true">
      {LAYOUT.map((row) => (
        <div className="krow" key={row}>
          {[...row].map((ch) => (
            <span key={ch} className={`key ${state[ch] ?? ""}`}>
              {ch.toUpperCase()}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
