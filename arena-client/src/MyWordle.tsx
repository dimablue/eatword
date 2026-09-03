import type { Row } from "./types";

const ROWS = 6;
const COLS = 5;

interface Props {
  rows: Row[];
  current: string;
  queued: number;
  message: string;
  shake: number;
}

/** Your own puzzle, laid out like the original Wordle grid. Letters visible. */
export default function MyWordle({ rows, current, queued, message, shake }: Props) {
  const activeRow = rows.length;

  return (
    <section className="mine">
      <p className={`message ${message ? "on" : ""}`}>{message || " "}</p>
      <div className="grid">
        {Array.from({ length: ROWS }, (_, r) => {
          const row = rows[r];
          const isActive = r === activeRow;
          return (
            <div key={r} className={`row ${isActive && shake ? "shake" : ""}`}>
              {Array.from({ length: COLS }, (_, c) => {
                if (row) {
                  return (
                    <div key={c} className={`tile ${row.colors[c]}`}>
                      {row.guess[c].toUpperCase()}
                    </div>
                  );
                }
                const letter = isActive ? current[c] : undefined;
                return (
                  <div key={c} className={`tile ${letter ? "filled" : ""}`}>
                    {letter ? letter.toUpperCase() : ""}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="hint">
        {queued > 0
          ? `${queued} stolen puzzle${queued > 1 ? "s" : ""} waiting`
          : "mouse to move · type to guess"}
      </p>
    </section>
  );
}
