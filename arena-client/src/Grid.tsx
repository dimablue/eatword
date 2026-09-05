import type { Row } from "./types";

const ROWS = 6;
const COLS = 5;

interface Props {
  rows: Row[];
  /** Letters typed into the next row but not submitted. */
  current?: string;
  /** Bumped to shake the row you are typing into; 0 leaves it still. */
  shake?: number;
  /** Board-wide flourish: "pop", "shake", or "handoff". */
  fx?: string;
}

/** The 6x5 board. Live under your own puzzle, and frozen on the death screen.
 *  the same component both times, so a reviewed board can't drift from a played
 *  one. Nothing here is interactive; typing is handled far above it. */
export default function Grid({ rows, current = "", shake = 0, fx = "" }: Props) {
  const activeRow = rows.length;

  return (
    <div className={`grid ${fx}`}>
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
  );
}
