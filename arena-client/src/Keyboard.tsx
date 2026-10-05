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
  /** Set on touch devices, where this is the only way to type: the keys become
   *  pressable, and Enter and Backspace join the bottom row as in Wordle. */
  onKey?: (key: string) => void;
}

/** Fires on touch-down rather than click, so a fast typist's next tap never
 *  waits on the last one's release. The pressed look is set by hand because
 *  iOS does not apply :active to plain elements. */
function press(onKey: (key: string) => void, key: string) {
  return {
    role: "button",
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.classList.add("down");
      onKey(key);
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => e.currentTarget.classList.remove("down"),
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => e.currentTarget.classList.remove("down"),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => e.currentTarget.classList.remove("down"),
  };
}

/**
 * The letter tracker under your grid. On desktop it is display only; `.mine`
 * sets `pointer-events: none` because the mouse steers your board, so a
 * clickable key would drag you toward the bottom of the arena every time you
 * pressed it. On touch the joystick steers instead, so the keys are free to be
 * keys.
 */
export default function Keyboard({ rows, onKey }: Props) {
  const state = letterStates(rows);
  if (onKey) {
    // Letters on the left; Backspace over Enter in a column on the right,
    // where the right thumb already is, with Enter the taller of the two since
    // it is the key that ends a guess.
    return (
      <div className="keyboard tappable">
        <div className="letters">
          {LAYOUT.map((row, i) => (
            <div className="krow" key={row}>
              {i > 0 && <span className={`kspacer s${i}`} />}
              {[...row].map((ch) => (
                <span key={ch} className={`key ${state[ch] ?? ""}`} {...press(onKey, ch)}>
                  {ch.toUpperCase()}
                </span>
              ))}
              {i > 0 && <span className={`kspacer s${i}`} />}
            </div>
          ))}
        </div>
        <div className="actions">
          <span className="key back" aria-label="Backspace" {...press(onKey, "Backspace")}>
            ⌫
          </span>
          <span className="key enter" aria-label="Enter" {...press(onKey, "Enter")}>
            Enter
          </span>
        </div>
      </div>
    );
  }
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
