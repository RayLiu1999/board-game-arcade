import type { WebSocket } from "ws";

import type { RiichiSession } from "../../lib/riichi-session.js";
import type { GameState } from "../shared/game-types.js";
import type { PlayerSide } from "../shared/protocol.js";
import type { AppendMatchEventInput } from "./product-store.js";

export type RiichiSide = 1 | 2 | 3 | 4;
export type SocketSide = PlayerSide | RiichiSide;

export interface ClientSocket extends WebSocket {
  alive: boolean;
  room: string | null;
  side: SocketSide;
  userId?: string;
}

export interface RiichiSummary {
  game: "riichi";
  winner: number | null;
  ply: number;
}

export type RoomState = GameState | RiichiSummary;

export interface RoomPlayer {
  name: string;
  tokenHash: string;
  userId?: string;
  socket?: ClientSocket | null;
  bot?: boolean;
}

export interface Room {
  code: string;
  state: RoomState;
  players: Array<RoomPlayer | null>;
  rounds: number;
  rematch: number[];
  touched: number;
  expiresAt: number;
  revision: number;
  session: RiichiSession | null;
  matchId?: string;
  eventSequence: number;
  pendingEvents: AppendMatchEventInput[];
}
