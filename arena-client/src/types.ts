export type Color = "green" | "yellow" | "gray";

export interface Row {
  guess: string;
  colors: Color[];
}

/** What the server lets you see of anyone else: colours, not letters. */
export interface PublicPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  mass: number;
  tile: number;
  r: number;
  colors: Color[][];
  /** Submitted words, sent only for the board a spectator is watching. */
  guesses?: string[];
  /** Their half-typed word, so a watched board reads as live. */
  draft?: string;
}

export interface You {
  id: string;
  alive: boolean;
  mass: number;
  rows: Row[];
  /** Identifies the current board; changes on solve, respawn, and steal. */
  puzzleId: number | null;
  /** Letters typed but not submitted. Travels with the board when it is stolen. */
  draft: string;
  /** True while the finished board is held up for the reveal. */
  done: boolean;
  speed: number;
  /** False while the lunge is on cooldown. */
  lungeReady: boolean;
}

export interface Leader {
  id: string;
  name: string;
  mass: number;
}

/** One end-of-puzzle result. `points` is 0 on a miss, and a miss costs nothing. */
export interface PuzzleResult {
  solved: boolean;
  word: string;
  points: number;
  /** Set when an eat ended the board rather than a guess: `points` is the mass
   *  the kill paid, and the reveal plays its short handoff instead of the hold. */
  handoff?: boolean;
}

/** A board frozen at the instant it stopped being yours. Review only. */
export interface FinalBoard {
  rows: Row[];
  word: string;
  /** What you had half-typed. Preserved so the board is exactly where you left it. */
  draft: string;
}

export type GameEvent =
  | ({ kind: "result" } & PuzzleResult)
  | { kind: "ate"; name: string; mass: number; gain: number }
  | ({ kind: "eaten"; by: string; mass: number } & FinalBoard)
  | { kind: "stole"; from: string; guesses: number }
  /** Fired once when you first climb past the mass where decay starts. */
  | { kind: "decay"; at: number }
  /** Fired on your first lunge: what it costs, and the size below which it is free. */
  | { kind: "lunge"; pct: number; free: number };

export interface Welcome {
  type: "welcome";
  /** null while spectating, since you hold no board yet. */
  id: string | null;
  spectator: boolean;
  world: number;
  rows: number;
  cols: number;
  /** How long the server holds a finished board before loading the next one. */
  holdMs: number;
  /** The same hold after an eat: shorter, and the length of the exit animation. */
  handoffMs: number;
}

export interface StateMsg {
  type: "state";
  /** null while spectating. */
  you: You | null;
  spectator?: boolean;
  /** Where a spectator's camera should sit, since they have no board. */
  camera?: { x: number; y: number };
  players: PublicPlayer[];
  leaders: Leader[];
  events: GameEvent[];
}

/** The join was refused outright. The socket is spent and you go back to the
 *  entry screen. Distinct from RejectMsg, which is an in-game nudge. */
export interface DeniedMsg {
  type: "denied";
  message: string;
}

export interface RejectMsg {
  type: "reject";
  message: string;
}

export type ServerMsg = Welcome | StateMsg | RejectMsg | DeniedMsg;
