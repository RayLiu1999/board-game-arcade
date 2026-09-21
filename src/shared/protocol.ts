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

const COMMAND_TYPES = [
  "leave",
  "riichi-start",
  "resign",
  "rematch",
  "dead",
  "accept",
  "resume",
] as const;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const isOptionalInteger = (value: unknown): value is number | undefined =>
  value === undefined || (typeof value === "number" && Number.isInteger(value));

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

export function isBoardMove(value: unknown): value is BoardMove {
  if (!isRecord(value)) return false;
  return (
    isOptionalInteger(value.from) &&
    isOptionalInteger(value.to) &&
    isOptionalInteger(value.capture) &&
    isOptionalInteger(value.drop) &&
    (value.pass === undefined || typeof value.pass === "boolean") &&
    (value.promote === undefined || typeof value.promote === "boolean") &&
    isOptionalString(value.promotion)
  );
}

export function parseClientMessage(value: unknown): ClientMessage {
  if (!isRecord(value) || typeof value.type !== "string")
    throw new Error("無效訊息");

  if (value.type === "create") {
    if (!isGameId(value.game)) throw new Error("未知棋種");
    if (!isOptionalInteger(value.size) || !isOptionalString(value.name))
      throw new Error("建立房間訊息格式錯誤");
    if (!isOptionalInteger(value.rounds)) throw new Error("日麻場數格式錯誤");
    return {
      type: "create",
      game: value.game,
      ...(value.size === undefined ? {} : { size: value.size }),
      ...(value.name === undefined ? {} : { name: value.name }),
      ...(value.rounds === undefined ? {} : { rounds: value.rounds }),
    };
  }

  if (value.type === "join") {
    if (
      typeof value.code !== "string" ||
      !isOptionalString(value.name) ||
      !isOptionalString(value.token)
    )
      throw new Error("加入房間訊息格式錯誤");
    return {
      type: "join",
      code: value.code,
      ...(value.name === undefined ? {} : { name: value.name }),
      ...(value.token === undefined ? {} : { token: value.token }),
    };
  }

  if (value.type === "move") {
    if (
      !isOptionalInteger(value.ply) ||
      value.ply === undefined ||
      !isBoardMove(value.move)
    )
      throw new Error("落子訊息格式錯誤");
    return { type: "move", ply: value.ply, move: value.move };
  }

  if (value.type === "riichi-action") {
    if (typeof value.actionId !== "string") throw new Error("日麻操作格式錯誤");
    return { type: "riichi-action", actionId: value.actionId };
  }

  if (
    COMMAND_TYPES.includes(value.type as (typeof COMMAND_TYPES)[number]) &&
    isOptionalInteger(value.to)
  ) {
    return {
      type: value.type as RoomCommandMessage["type"],
      ...(value.to === undefined ? {} : { to: value.to }),
    };
  }

  throw new Error("未知操作");
}

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
