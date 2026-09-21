export const GAME_IDS = [
  "shogi",
  "riichi",
  "chess",
  "xiangqi",
  "checkers",
  "gomoku",
  "go",
  "reversi",
] as const;

export type GameId = (typeof GAME_IDS)[number];
export type PlayerSide = 1 | -1;
export type RiichiSeat = 0 | 1 | 2 | 3;

export interface BoardMove {
  readonly from?: number;
  readonly to?: number;
  readonly capture?: number;
  readonly drop?: number;
  readonly pass?: boolean;
  readonly promote?: boolean;
  readonly promotion?: string;
}

export interface CreateRoomMessage {
  readonly type: "create";
  readonly game: GameId;
  readonly size?: number;
  readonly name?: string;
  readonly rounds?: number;
}

export interface JoinRoomMessage {
  readonly type: "join";
  readonly code: string;
  readonly name?: string;
  readonly token?: string;
}

export interface MoveMessage {
  readonly type: "move";
  readonly ply: number;
  readonly move: BoardMove;
}

export interface RiichiActionMessage {
  readonly type: "riichi-action";
  readonly actionId: string;
}

export interface RoomCommandMessage {
  readonly type:
    | "leave"
    | "riichi-start"
    | "resign"
    | "rematch"
    | "dead"
    | "accept"
    | "resume";
  readonly to?: number;
}

export type ClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | MoveMessage
  | RiichiActionMessage
  | RoomCommandMessage;

export function isGameId(value: unknown): value is GameId {
  return typeof value === "string" && GAME_IDS.includes(value as GameId);
}

export function isPlayerSide(value: unknown): value is PlayerSide {
  return value === 1 || value === -1;
}

export function isRiichiSeat(value: unknown): value is RiichiSeat {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 3
  );
}
