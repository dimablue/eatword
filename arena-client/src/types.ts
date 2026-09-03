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
}

export interface You {
  id: string;
  alive: boolean;
  mass: number;
  rows: Row[];
  /** True while the finished board is held up for the reveal. */
  done: boolean;
  queued: number;
  speed: number;
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
}

export type GameEvent =
  | ({ kind: "result" } & PuzzleResult)
  | { kind: "ate"; name: string; mass: number }
  | { kind: "eaten"; by: string; mass: number }
  | { kind: "stole"; from: string; guesses: number; active: boolean };

export interface Welcome {
  type: "welcome";
  id: string;
  world: number;
  rows: number;
  cols: number;
  /** How long the server holds a finished board before loading the next one. */
  holdMs: number;
}

export interface StateMsg {
  type: "state";
  you: You;
  players: PublicPlayer[];
  leaders: Leader[];
  events: GameEvent[];
}

export interface RejectMsg {
  type: "reject";
  message: string;
}

export type ServerMsg = Welcome | StateMsg | RejectMsg;
