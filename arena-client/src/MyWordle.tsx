import type { PuzzleResult, Row } from "./types";

const ROWS = 6;
const COLS = 5;

interface Props {
  rows: Row[];
  current: string;
  queued: number;
  message: string;
  shake: number;
  /** Set while the finished board is held up; drives the reveal and the animation. */
  result: PuzzleResult | null;
  /** Bumped when a new puzzle loads, to replay the grid's entrance. */
  puzzleKey: number;
}

/** Your own puzzle, laid out like the original Wordle grid. Letters visible. */
export default function MyWordle({
  rows,
  current,
  queued,
  message,
  shake,
  result,
  puzzleKey,
}: Props) {
  const activeRow = rows.length;
  // Solve pulses, miss shakes — two readings of the same beat.
  const gridFx = result ? (result.solved ? "pop" : "shake") : "";

  return (
    <section className="mine">
      <div className="slot">
        {result ? (
          <p className="reveal">
            <span className="word">{result.word.toUpperCase()}</span>
            <span className={`points ${result.solved ? "up" : "zero"}`}>
              {result.solved ? `+${result.points}` : "+0"}
            </span>
          </p>
        ) : (
          <p className={`message ${message ? "on" : ""}`}>{message || " "}</p>
        )}
      </div>

      <div key={puzzleKey} className={`grid ${gridFx}`}>
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

      {/* Kept as a fixed-height slot: the panel must not change height when a
          stolen puzzle appears, or the grid jumps and the camera focus shifts. */}
      <p className="hint">
        {queued > 0 ? `${queued} stolen puzzle${queued > 1 ? "s" : ""} waiting` : ""}
      </p>
    </section>
  );
}
