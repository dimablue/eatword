import type { CSSProperties } from "react";
import Grid from "./Grid";
import Keyboard from "./Keyboard";
import type { PuzzleResult, Row } from "./types";

interface Props {
  rows: Row[];
  current: string;
  message: string;
  shake: number;
  /** Set while the finished board is held up; drives the reveal and the animation. */
  result: PuzzleResult | null;
  /** Bumped when a new puzzle loads, to replay the grid's entrance. */
  puzzleKey: number;
  /** The server's handoff hold. The exit animation runs for exactly this long,
   *  so the board finishes leaving as the inherited one arrives. */
  handoffMs: number;
  /** False while the lunge recharges. */
  lungeReady: boolean;
}

/** Your own puzzle, laid out like the original Wordle grid. Letters visible. */
export default function MyWordle({
  rows,
  current,
  message,
  shake,
  result,
  puzzleKey,
  handoffMs,
  lungeReady,
}: Props) {
  // Two ways a board can end, and they read differently. A guess ends it in the
  // line above the grid, where you are already looking. An eat ends it across
  // the grid itself, because the board is about to be replaced and the swap has
  // to be unmissable at a glance you can't afford to take.
  const handoff = result && result.handoff ? result : null;
  // Solve pulses, miss shakes, an eat pulses green and leaves.
  const gridFx = handoff ? "handoff" : result ? (result.solved ? "pop" : "shake") : "";

  return (
    <section className="mine">
      <div className="slot">
        {result && !handoff ? (
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

      <div className="stack" style={{ "--hold": `${handoffMs}ms` } as CSSProperties}>
        <Grid key={puzzleKey} rows={rows} current={current} shake={shake} fx={gridFx} />
        {handoff && (
          <div className="handoff-answer">
            {/* The word is being taken off you unsolved, so it has to be named
                as a loss. Unlabelled it reads as a solve: green pulse, a word,
                a score, and the mass actually came from the kill. */}
            <span className="label">Your word was</span>
            <span className="word">{handoff.word.toUpperCase()}</span>
            <span className="points">+{handoff.points}</span>
          </div>
        )}
      </div>

      <Keyboard rows={rows} />

      {/* Whether space will do anything right now. One rule rather than a
          meter: the only question is ready or not, and the wait is ~1s. */}
      <div className={`charge ${lungeReady ? "ready" : ""}`} />
    </section>
  );
}
