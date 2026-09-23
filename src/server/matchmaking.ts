import { randomUUID } from "node:crypto";

import type {
  MatchmakingGame,
  MatchmakingMode,
  MatchmakingTimeControl,
} from "../shared/protocol.js";

export const MATCHMAKING_TICKET_TTL_MS = 2 * 60 * 1000;
export const INITIAL_MATCHMAKING_RATING_RANGE = 200;
export const MATCHMAKING_RATING_RANGE_STEP_MS = 15 * 1000;
export const MATCHMAKING_RATING_RANGE_STEP = 100;
export const MAX_MATCHMAKING_RATING_RANGE = 800;

export interface MatchmakingTicketInput {
  readonly id?: string;
  readonly userId: string;
  readonly displayName: string;
  readonly game: MatchmakingGame;
  readonly mode: MatchmakingMode;
  readonly timeControl: MatchmakingTimeControl;
  readonly rating: number | null;
  readonly createdAt: number;
  readonly expiresAt?: number;
}

export interface MatchmakingTicket {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string;
  readonly game: MatchmakingGame;
  readonly mode: MatchmakingMode;
  readonly timeControl: MatchmakingTimeControl;
  readonly rating: number | null;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface EnqueueResult {
  readonly ticket: MatchmakingTicket;
  readonly match: MatchmakingTicket | null;
}

export const matchmakingRatingRange = (waitingMs: number): number => {
  if (!Number.isFinite(waitingMs) || waitingMs < 0)
    throw new Error("配對等待時間格式錯誤");
  return Math.min(
    MAX_MATCHMAKING_RATING_RANGE,
    INITIAL_MATCHMAKING_RATING_RANGE +
      Math.floor(waitingMs / MATCHMAKING_RATING_RANGE_STEP_MS) *
        MATCHMAKING_RATING_RANGE_STEP,
  );
};

const validRating = (value: number | null, mode: MatchmakingMode): boolean =>
  mode === "casual"
    ? value === null
    : value !== null && Number.isSafeInteger(value) && value >= 0;

const compatible = (
  left: MatchmakingTicket,
  right: MatchmakingTicket,
  now: number,
): boolean => {
  if (left.game !== right.game || left.mode !== right.mode) return false;
  if (left.mode === "casual") return true;
  if (left.rating === null || right.rating === null) return false;
  const range = Math.max(
    matchmakingRatingRange(now - left.createdAt),
    matchmakingRatingRange(now - right.createdAt),
  );
  return Math.abs(left.rating - right.rating) <= range;
};

export class MatchmakingQueue {
  private readonly tickets = new Map<string, MatchmakingTicket>();
  private readonly userTickets = new Map<string, string>();

  get size(): number {
    return this.tickets.size;
  }

  enqueue(
    input: MatchmakingTicketInput,
    excludedUserIds: ReadonlySet<string> = new Set(),
  ): EnqueueResult {
    if (!input.userId) throw new Error("配對玩家身份不可為空");
    if (!Number.isFinite(input.createdAt))
      throw new Error("配對建立時間格式錯誤");
    if (!validRating(input.rating, input.mode))
      throw new Error("配對 rating 格式錯誤");
    const existingId = this.userTickets.get(input.userId);
    if (existingId) throw new Error("你已在公開配對佇列中");
    const ticket: MatchmakingTicket = {
      id: input.id ?? randomUUID(),
      userId: input.userId,
      displayName: input.displayName,
      game: input.game,
      mode: input.mode,
      timeControl: input.timeControl,
      rating: input.rating,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt ?? input.createdAt + MATCHMAKING_TICKET_TTL_MS,
    };
    if (
      !Number.isFinite(ticket.expiresAt) ||
      ticket.expiresAt <= ticket.createdAt
    )
      throw new Error("配對到期時間格式錯誤");
    const opponent = [...this.tickets.values()].find(
      (candidate) =>
        candidate.expiresAt > input.createdAt &&
        !excludedUserIds.has(candidate.userId) &&
        compatible(candidate, ticket, input.createdAt),
    );
    if (opponent) {
      this.remove(opponent);
      return { ticket, match: opponent };
    }
    this.tickets.set(ticket.id, ticket);
    this.userTickets.set(ticket.userId, ticket.id);
    return { ticket, match: null };
  }

  get(ticketId: string): MatchmakingTicket | null {
    return this.tickets.get(ticketId) ?? null;
  }

  cancel(ticketId: string, userId: string): MatchmakingTicket | null {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return null;
    if (ticket.userId !== userId) throw new Error("無法取消其他玩家的配對");
    this.remove(ticket);
    return ticket;
  }

  expire(now: number): MatchmakingTicket[] {
    const expired: MatchmakingTicket[] = [];
    for (const ticket of this.tickets.values()) {
      if (ticket.expiresAt <= now) {
        expired.push(ticket);
        this.remove(ticket);
      }
    }
    return expired;
  }

  private remove(ticket: MatchmakingTicket): void {
    this.tickets.delete(ticket.id);
    if (this.userTickets.get(ticket.userId) === ticket.id)
      this.userTickets.delete(ticket.userId);
  }
}
