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
export type RoomMode = "friend" | "public" | "rated";
export type MatchmakingMode = "casual" | "rated";
export type MatchmakingTimeControl = "unlimited";
export type MatchmakingGame = Exclude<GameId, "riichi">;

export const CHAT_MAX_LENGTH = 500;
export const CHAT_HISTORY_LIMIT = 50;
export const CHAT_RATE_LIMIT_COUNT = 8;
export const CHAT_RATE_LIMIT_WINDOW_MS = 10_000;

export interface ChatMessage {
  readonly id: string;
  readonly matchId: string;
  readonly sequence: number;
  readonly side: number;
  readonly name: string;
  readonly text: string;
  readonly createdAt: number;
}

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
  readonly mode?: Exclude<RoomMode, "public">;
  readonly size?: number;
  readonly name?: string;
  readonly rounds?: number;
}

export interface MatchmakeMessage {
  readonly type: "matchmake";
  readonly game: MatchmakingGame;
  readonly mode: MatchmakingMode;
  readonly timeControl: MatchmakingTimeControl;
}

export interface MatchmakeCancelMessage {
  readonly type: "matchmake-cancel";
  readonly ticket?: string;
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

export interface ChatSendMessage {
  readonly type: "chat";
  readonly text: string;
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
  | MatchmakeMessage
  | MatchmakeCancelMessage
  | JoinRoomMessage
  | MoveMessage
  | RiichiActionMessage
  | ChatSendMessage
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

const isOptionalRoomMode = (
  value: unknown,
): value is Exclude<RoomMode, "public"> | undefined =>
  value === undefined || value === "friend" || value === "rated";

const isMatchmakingMode = (value: unknown): value is MatchmakingMode =>
  value === "casual" || value === "rated";

const isMatchmakingTimeControl = (
  value: unknown,
): value is MatchmakingTimeControl => value === "unlimited";

const isMatchmakingGame = (value: unknown): value is MatchmakingGame =>
  isGameId(value) && value !== "riichi";

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      (codePoint >= 0 && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    );
  });

export function normalizeChatText(value: unknown): string {
  if (typeof value !== "string") throw new Error("聊天室訊息格式錯誤");
  const text = value.normalize("NFC").trim();
  if (!text) throw new Error("聊天室訊息不可為空白");
  if (Array.from(text).length > CHAT_MAX_LENGTH)
    throw new Error(`聊天室訊息不可超過 ${String(CHAT_MAX_LENGTH)} 個字元`);
  if (hasControlCharacter(text))
    throw new Error("聊天室訊息包含不允許的控制字元");
  return text;
}

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
    if (!isGameId(value.game) || !isOptionalRoomMode(value.mode))
      throw new Error("建立房間訊息格式錯誤");
    if (!isOptionalInteger(value.size) || !isOptionalString(value.name))
      throw new Error("建立房間訊息格式錯誤");
    if (!isOptionalInteger(value.rounds)) throw new Error("日麻場數格式錯誤");
    return {
      type: "create",
      game: value.game,
      ...(value.mode === undefined ? {} : { mode: value.mode }),
      ...(value.size === undefined ? {} : { size: value.size }),
      ...(value.name === undefined ? {} : { name: value.name }),
      ...(value.rounds === undefined ? {} : { rounds: value.rounds }),
    };
  }

  if (value.type === "matchmake") {
    if (
      !isMatchmakingGame(value.game) ||
      !isMatchmakingMode(value.mode) ||
      !isMatchmakingTimeControl(value.timeControl)
    )
      throw new Error("公開配對訊息格式錯誤");
    return {
      type: "matchmake",
      game: value.game,
      mode: value.mode,
      timeControl: value.timeControl,
    };
  }

  if (value.type === "matchmake-cancel") {
    if (!isOptionalString(value.ticket))
      throw new Error("取消配對訊息格式錯誤");
    return {
      type: "matchmake-cancel",
      ...(value.ticket === undefined ? {} : { ticket: value.ticket }),
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

  if (value.type === "chat")
    return { type: "chat", text: normalizeChatText(value.text) };

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
