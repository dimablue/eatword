import { memo } from "react";
import type { Leader } from "./types";

/** Understated text list, top-right. No panel. */
function Leaderboard({ leaders, myId }: { leaders: Leader[]; myId: string | null }) {
  if (!leaders.length) return null;
  return (
    <ol className="leaderboard">
      {leaders.map((l, i) => (
        <li key={l.id} className={l.id === myId ? "me" : ""}>
          <span className="rank">{i + 1}</span>
          <span className="who">{l.name}</span>
          <span className="mass">{l.mass}</span>
        </li>
      ))}
    </ol>
  );
}

export default memo(Leaderboard);
