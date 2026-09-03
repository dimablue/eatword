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
  queued: number;
  speed: number;
}

export interface Leader {
  id: string;
  name: string;
  mass: number;
}

export type GameEvent =
  | { kind: "solved"; word: string; gain: number }
  | { kind: "failed"; word: string; loss: number }
  | { kind: "ate"; name: string; mass: number }
  | { kind: "eaten"; by: string; mass: number }
  | { kind: "stole"; from: string; guesses: number; active: boolean };

export interface Welcome {
  type: "welcome";
  id: string;
  world: number;
  rows: number;
  cols: number;
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
