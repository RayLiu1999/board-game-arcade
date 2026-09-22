import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { GameId } from "../shared/protocol.js";
import { hashSessionToken, matchesSessionToken } from "./product-security.js";

export const PRODUCT_SCHEMA_VERSION = 1;
export const MATCH_EVENT_SCHEMA_VERSION = 1;

export type UserStatus = "active" | "suspended" | "deactivated";
export type MatchMode = "ai" | "local" | "friend" | "rated";
export type MatchStatus = "active" | "completed" | "cancelled" | "aborted";
export type ParticipantResult = "win" | "loss" | "draw" | "unknown";

export interface UserRecord {
  readonly id: string;
  readonly displayName: string;
  readonly status: UserStatus;
  readonly createdAt: number;
  readonly lastActiveAt: number;
}

export interface CreateUserInput {
  readonly id?: string;
  readonly displayName: string;
  readonly createdAt?: number;
}

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
}

export interface CreateSessionInput {
  readonly id?: string;
  readonly userId: string;
  readonly token: string;
  readonly createdAt?: number;
  readonly expiresAt: number;
}

export interface MatchOutcome {
  readonly winnerSeat: number | null;
  readonly reason: string;
  readonly scores?: readonly number[];
}

export interface MatchParticipant {
  readonly matchId: string;
  readonly seat: number;
  readonly userId: string | null;
  readonly displayName: string;
  readonly bot: boolean;
  readonly result: ParticipantResult;
  readonly joinedAt: number;
}

export interface MatchRecord {
  readonly id: string;
  readonly roomCode: string;
  readonly game: GameId;
  readonly mode: MatchMode;
  readonly status: MatchStatus;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly outcome: MatchOutcome | null;
  readonly schemaVersion: number;
  readonly retentionUntil: number | null;
  readonly participants: readonly MatchParticipant[];
}

export interface CreateMatchInput {
  readonly id?: string;
  readonly roomCode: string;
  readonly game: GameId;
  readonly mode: MatchMode;
  readonly startedAt?: number;
  readonly schemaVersion?: number;
  readonly retentionUntil?: number | null;
}

export interface AddMatchParticipantInput {
  readonly matchId: string;
  readonly seat: number;
  readonly userId?: string | null;
  readonly displayName: string;
  readonly bot: boolean;
  readonly joinedAt?: number;
}

export interface MatchEvent {
  readonly matchId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly actorSeat: number | null;
  readonly payload: unknown;
  readonly createdAt: number;
  readonly schemaVersion: number;
}

export interface AppendMatchEventInput {
  readonly matchId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly actorSeat?: number | null;
  readonly payload: unknown;
  readonly createdAt?: number;
  readonly schemaVersion?: number;
}

export interface CompleteMatchInput {
  readonly matchId: string;
  readonly outcome: MatchOutcome;
  readonly completedAt?: number;
  readonly participantResults?: readonly {
    readonly seat: number;
    readonly result: ParticipantResult;
  }[];
}

export interface AbortMatchInput {
  readonly matchId: string;
  readonly reason: string;
  readonly abortedAt?: number;
}

export interface AuditRecord {
  readonly id: string;
  readonly action: string;
  readonly userId: string | null;
  readonly matchId: string | null;
  readonly requestId: string | null;
  readonly metadata: unknown;
  readonly createdAt: number;
}

export interface RecordAuditInput {
  readonly id?: string;
  readonly action: string;
  readonly userId?: string | null;
  readonly matchId?: string | null;
  readonly requestId?: string | null;
  readonly metadata?: unknown;
  readonly createdAt?: number;
}

export interface UserStore {
  createUser(input: CreateUserInput): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  touchUser(id: string, at?: number): Promise<void>;
  setUserStatus(
    id: string,
    status: UserStatus,
    at?: number,
  ): Promise<UserRecord>;
}

export interface SessionStore {
  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  findActiveSession(token: string, now?: number): Promise<SessionRecord | null>;
  revokeSession(token: string, at?: number): Promise<boolean>;
}

export interface MatchStore {
  createMatch(input: CreateMatchInput): Promise<MatchRecord>;
  getMatch(id: string): Promise<MatchRecord | null>;
  addMatchParticipant(
    input: AddMatchParticipantInput,
  ): Promise<MatchParticipant>;
  appendMatchEvent(input: AppendMatchEventInput): Promise<MatchEvent>;
  listMatchEvents(matchId: string): Promise<MatchEvent[]>;
  completeMatch(input: CompleteMatchInput): Promise<MatchRecord>;
  abortMatch(input: AbortMatchInput): Promise<MatchRecord>;
}

export interface AuditStore {
  recordAudit(input: RecordAuditInput): Promise<AuditRecord>;
}

export interface ProductStore
  extends UserStore,
    SessionStore,
    MatchStore,
    AuditStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
}

export class ProductStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductStoreConflictError";
  }
}

export class ProductStoreNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductStoreNotFoundError";
  }
}

const clone = <Value>(value: Value): Value => structuredClone(value);

const displayName = (value: string): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 20)
    throw new Error("顯示名稱必須介於 1 到 20 個字元");
  return normalized;
};

const timestamp = (value: number | undefined): number => {
  const result = value ?? Date.now();
  if (!Number.isFinite(result)) throw new Error("時間格式錯誤");
  return result;
};

const positiveInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label}格式錯誤`);
  return value;
};

const sameJson = (left: unknown, right: unknown): boolean =>
  isDeepStrictEqual(left, right);

const resultForSeat = (
  outcome: MatchOutcome,
  seat: number,
): ParticipantResult => {
  if (outcome.winnerSeat === null) return "draw";
  return outcome.winnerSeat === seat ? "win" : "loss";
};

const applyParticipantResults = (
  participants: readonly MatchParticipant[],
  outcome: MatchOutcome,
  explicit: readonly {
    readonly seat: number;
    readonly result: ParticipantResult;
  }[] = [],
): MatchParticipant[] => {
  const explicitResults = new Map(
    explicit.map((entry) => [entry.seat, entry.result]),
  );
  return participants.map((participant) => ({
    ...participant,
    result:
      explicitResults.get(participant.seat) ??
      resultForSeat(outcome, participant.seat),
  }));
};

export class MemoryProductStore implements ProductStore {
  private readonly users = new Map<string, UserRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly matches = new Map<string, MatchRecord>();
  private readonly events = new Map<string, Map<number, MatchEvent>>();
  private readonly audits: AuditRecord[] = [];

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  createUser(input: CreateUserInput): Promise<UserRecord> {
    return Promise.resolve().then(() => {
      const id = input.id ?? randomUUID();
      if (this.users.has(id))
        throw new ProductStoreConflictError(`使用者已存在：${id}`);
      const createdAt = timestamp(input.createdAt);
      const user: UserRecord = {
        id,
        displayName: displayName(input.displayName),
        status: "active",
        createdAt,
        lastActiveAt: createdAt,
      };
      this.users.set(id, clone(user));
      return clone(user);
    });
  }

  getUser(id: string): Promise<UserRecord | null> {
    return Promise.resolve(clone(this.users.get(id) ?? null));
  }

  touchUser(id: string, at?: number): Promise<void> {
    return Promise.resolve().then(() => {
      const user = this.users.get(id);
      if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${id}`);
      this.users.set(id, { ...user, lastActiveAt: timestamp(at) });
    });
  }

  setUserStatus(
    id: string,
    status: UserStatus,
    at?: number,
  ): Promise<UserRecord> {
    return Promise.resolve().then(() => {
      const user = this.users.get(id);
      if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${id}`);
      const updated = { ...user, status, lastActiveAt: timestamp(at) };
      this.users.set(id, updated);
      return clone(updated);
    });
  }

  createSession(input: CreateSessionInput): Promise<SessionRecord> {
    return Promise.resolve().then(() => {
      if (!this.users.has(input.userId))
        throw new ProductStoreNotFoundError(`找不到使用者：${input.userId}`);
      if (!input.token) throw new Error("session token 不可為空");
      const createdAt = timestamp(input.createdAt);
      if (!Number.isFinite(input.expiresAt) || input.expiresAt <= createdAt)
        throw new Error("session 到期時間格式錯誤");
      const tokenHash = hashSessionToken(input.token);
      if (
        [...this.sessions.values()].some(
          (session) => session.tokenHash === tokenHash,
        )
      )
        throw new ProductStoreConflictError("session token 已存在");
      const session: SessionRecord = {
        id: input.id ?? randomUUID(),
        userId: input.userId,
        tokenHash,
        createdAt,
        expiresAt: input.expiresAt,
        revokedAt: null,
      };
      this.sessions.set(session.id, clone(session));
      return clone(session);
    });
  }

  findActiveSession(
    token: string,
    now = Date.now(),
  ): Promise<SessionRecord | null> {
    return Promise.resolve().then(() => {
      const found = [...this.sessions.values()].find(
        (session) =>
          matchesSessionToken(token, session.tokenHash) &&
          session.revokedAt === null &&
          session.expiresAt > now,
      );
      return clone(found ?? null);
    });
  }

  revokeSession(token: string, at = Date.now()): Promise<boolean> {
    return Promise.resolve().then(() => {
      const found = [...this.sessions.entries()].find(([, session]) =>
        matchesSessionToken(token, session.tokenHash),
      );
      if (!found || found[1].revokedAt !== null) return false;
      const [id, session] = found;
      this.sessions.set(id, { ...session, revokedAt: timestamp(at) });
      return true;
    });
  }

  createMatch(input: CreateMatchInput): Promise<MatchRecord> {
    return Promise.resolve().then(() => {
      const id = input.id ?? randomUUID();
      if (this.matches.has(id))
        throw new ProductStoreConflictError(`對局已存在：${id}`);
      const match: MatchRecord = {
        id,
        roomCode: input.roomCode,
        game: input.game,
        mode: input.mode,
        status: "active",
        startedAt: timestamp(input.startedAt),
        completedAt: null,
        outcome: null,
        schemaVersion: input.schemaVersion ?? PRODUCT_SCHEMA_VERSION,
        retentionUntil: input.retentionUntil ?? null,
        participants: [],
      };
      this.matches.set(id, clone(match));
      this.events.set(id, new Map());
      return clone(match);
    });
  }

  getMatch(id: string): Promise<MatchRecord | null> {
    return Promise.resolve(clone(this.matches.get(id) ?? null));
  }

  addMatchParticipant(
    input: AddMatchParticipantInput,
  ): Promise<MatchParticipant> {
    return Promise.resolve().then(() => {
      const match = this.matches.get(input.matchId);
      if (!match)
        throw new ProductStoreNotFoundError(`找不到對局：${input.matchId}`);
      if (!Number.isSafeInteger(input.seat) || input.seat < 0)
        throw new Error("對局座位格式錯誤");
      const participant: MatchParticipant = {
        matchId: input.matchId,
        seat: input.seat,
        userId: input.userId ?? null,
        displayName: displayName(input.displayName),
        bot: input.bot,
        result: "unknown",
        joinedAt: timestamp(input.joinedAt),
      };
      const existing = match.participants.find(
        (entry) => entry.seat === participant.seat,
      );
      if (existing) {
        if (
          existing.userId !== participant.userId ||
          existing.displayName !== participant.displayName ||
          existing.bot !== participant.bot
        )
          throw new ProductStoreConflictError(
            `對局座位已被其他玩家使用：${input.matchId}/${String(input.seat)}`,
          );
        return clone(existing);
      }
      const updated = {
        ...match,
        participants: [...match.participants, participant].sort(
          (left, right) => left.seat - right.seat,
        ),
      };
      this.matches.set(match.id, clone(updated));
      return clone(participant);
    });
  }

  appendMatchEvent(input: AppendMatchEventInput): Promise<MatchEvent> {
    return Promise.resolve().then(() => {
      if (!this.matches.has(input.matchId))
        throw new ProductStoreNotFoundError(`找不到對局：${input.matchId}`);
      const sequence = positiveInteger(input.sequence, "事件 sequence");
      const event: MatchEvent = {
        matchId: input.matchId,
        sequence,
        eventType: input.eventType,
        actorSeat: input.actorSeat ?? null,
        payload: clone(input.payload),
        createdAt: timestamp(input.createdAt),
        schemaVersion: input.schemaVersion ?? MATCH_EVENT_SCHEMA_VERSION,
      };
      const events =
        this.events.get(input.matchId) ?? new Map<number, MatchEvent>();
      const existing = events.get(sequence);
      if (existing) {
        if (
          existing.eventType !== event.eventType ||
          existing.actorSeat !== event.actorSeat ||
          existing.schemaVersion !== event.schemaVersion ||
          !sameJson(existing.payload, event.payload)
        )
          throw new ProductStoreConflictError(
            `對局事件 sequence 衝突：${input.matchId}/${String(sequence)}`,
          );
        return clone(existing);
      }
      events.set(sequence, clone(event));
      this.events.set(input.matchId, events);
      return clone(event);
    });
  }

  listMatchEvents(matchId: string): Promise<MatchEvent[]> {
    return Promise.resolve().then(() => {
      if (!this.matches.has(matchId))
        throw new ProductStoreNotFoundError(`找不到對局：${matchId}`);
      return [...(this.events.get(matchId)?.values() ?? [])]
        .sort((left, right) => left.sequence - right.sequence)
        .map(clone);
    });
  }

  completeMatch(input: CompleteMatchInput): Promise<MatchRecord> {
    return Promise.resolve().then(() => {
      const match = this.matches.get(input.matchId);
      if (!match)
        throw new ProductStoreNotFoundError(`找不到對局：${input.matchId}`);
      if (match.status === "completed") {
        if (!sameJson(match.outcome, input.outcome))
          throw new ProductStoreConflictError(
            `對局結算結果衝突：${input.matchId}`,
          );
        return clone(match);
      }
      if (match.status !== "active")
        throw new ProductStoreConflictError(
          `對局目前不可結算：${input.matchId}`,
        );
      const outcome = clone(input.outcome);
      const updated: MatchRecord = {
        ...match,
        status: "completed",
        completedAt: timestamp(input.completedAt),
        outcome,
        participants: applyParticipantResults(
          match.participants,
          outcome,
          input.participantResults,
        ),
      };
      this.matches.set(match.id, clone(updated));
      return clone(updated);
    });
  }

  abortMatch(input: AbortMatchInput): Promise<MatchRecord> {
    return Promise.resolve().then(() => {
      const match = this.matches.get(input.matchId);
      if (!match)
        throw new ProductStoreNotFoundError(`找不到對局：${input.matchId}`);
      if (match.status === "aborted") return clone(match);
      if (match.status !== "active")
        throw new ProductStoreConflictError(
          `對局目前不可中止：${input.matchId}`,
        );
      const updated: MatchRecord = {
        ...match,
        status: "aborted",
        completedAt: timestamp(input.abortedAt),
        outcome: { winnerSeat: null, reason: input.reason },
      };
      this.matches.set(match.id, clone(updated));
      return clone(updated);
    });
  }

  recordAudit(input: RecordAuditInput): Promise<AuditRecord> {
    return Promise.resolve().then(() => {
      const record: AuditRecord = {
        id: input.id ?? randomUUID(),
        action: input.action,
        userId: input.userId ?? null,
        matchId: input.matchId ?? null,
        requestId: input.requestId ?? null,
        metadata: clone(input.metadata ?? null),
        createdAt: timestamp(input.createdAt),
      };
      this.audits.push(clone(record));
      return clone(record);
    });
  }
}
