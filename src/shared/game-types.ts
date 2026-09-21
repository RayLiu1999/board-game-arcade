import type { GameId, PlayerSide } from "./protocol.js";

export type { GameId, PlayerSide } from "./protocol.js";

export type BoardGameId = Exclude<GameId, "riichi">;
export type NumericBoardGameId = Exclude<BoardGameId, "chess" | "shogi">;
export type Winner = PlayerSide | 0 | null;
export type Direction = readonly [number, number];

export interface GameMeta {
  readonly name: string;
  readonly en: string;
  readonly icon: string;
  readonly desc: string;
  readonly tags: readonly string[];
  readonly first: string;
  readonly second: string;
  readonly rules: string;
}

export interface GameMove {
  readonly from?: number;
  readonly to?: number;
  readonly capture?: number;
  readonly drop?: number;
  readonly pass?: boolean;
  readonly promote?: boolean;
  readonly promotion?: string;
}

export interface HistoryEntry {
  readonly side: PlayerSide;
  readonly label: string;
}

export interface SideCounts {
  1: number;
  "-1": number;
}

export interface CheckEntry {
  readonly side: PlayerSide;
  readonly check: boolean;
}

export interface Hands {
  1: number[];
  "-1": number[];
}

interface BoardStateFields {
  rows: number;
  cols: number;
  turn: PlayerSide;
  winner: Winner;
  reason: string;
  ply: number;
  history: HistoryEntry[];
  last: GameMove | null;
  forced: number | null;
  quiet: number;
  positions: string[];
  passes: number;
  captures: SideCounts;
  phase: "play" | "scoring" | "finished";
  dead: number[];
  accepted: PlayerSide[];
}

export interface ChessState extends BoardStateFields {
  game: "chess";
  board: Array<string | 0>;
  fen: string;
}

export interface NumericBoardState extends BoardStateFields {
  game: NumericBoardGameId;
  board: number[];
}

export interface ShogiState extends BoardStateFields {
  game: "shogi";
  board: number[];
  hands: Hands;
  checks: CheckEntry[];
}

export type BoardState = ChessState | NumericBoardState | ShogiState;

export interface RiichiWaitingState {
  game: "riichi";
  phase: "waiting";
  winner: null;
  ply: 0;
  history: [];
}

export type GameState = BoardState | RiichiWaitingState;

export interface ScoringAction {
  readonly type: "dead" | "accept" | "resume";
  readonly to?: number;
}
