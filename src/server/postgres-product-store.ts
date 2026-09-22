import { Pool, type PoolClient, type PoolConfig } from "pg";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { isGameId, type GameId } from "../shared/protocol.js";
import { hashSessionToken } from "./product-security.js";
import {
  MATCH_EVENT_SCHEMA_VERSION,
  PRODUCT_SCHEMA_VERSION,
  ProductStoreConflictError,
  ProductStoreNotFoundError,
  type AbortMatchInput,
  type AddMatchParticipantInput,
  type AppendMatchEventInput,
  type AuditRecord,
  type CompleteMatchInput,
  type CreateMatchInput,
  type CreateSessionInput,
  type CreateUserInput,
  type MatchEvent,
  type MatchMode,
  type MatchOutcome,
  type MatchParticipant,
  type MatchRecord,
  type MatchStatus,
  type ParticipantResult,
  type ProductStore,
  type RecordAuditInput,
  type SessionRecord,
  type UserRecord,
  type UserStatus,
} from "./product-store.js";
import { runMigrations } from "./postgres-migrations.js";

interface UserRow {
  readonly id: string;
  readonly display_name: string;
  readonly status: string;
  readonly created_at: Date;
  readonly last_active_at: Date;
}

interface SessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly token_hash: string;
  readonly created_at: Date;
  readonly expires_at: Date;
  readonly revoked_at: Date | null;
}

interface MatchRow {
  readonly id: string;
  readonly room_code: string;
  readonly game: string;
  readonly mode: string;
  readonly status: string;
  readonly started_at: Date;
  readonly completed_at: Date | null;
  readonly outcome_json: unknown;
  readonly schema_version: number;
  readonly retention_until: Date | null;
}

interface ParticipantRow {
  readonly match_id: string;
  readonly seat: number;
  readonly user_id: string | null;
  readonly display_name: string;
  readonly bot: boolean;
  readonly result: string;
  readonly joined_at: Date;
}

interface EventRow {
  readonly match_id: string;
  readonly sequence: number | string;
  readonly event_type: string;
  readonly actor_seat: number | null;
  readonly payload_json: unknown;
  readonly created_at: Date;
  readonly schema_version: number;
}

interface AuditRow {
  readonly id: string;
  readonly action: string;
  readonly user_id: string | null;
  readonly match_id: string | null;
  readonly request_id: string | null;
  readonly metadata_json: unknown;
  readonly created_at: Date;
}

export interface PostgresProductStoreOptions {
  readonly connectionString?: string;
  readonly pool?: Pool;
}

const dateMillis = (value: Date | null): number | null => {
  if (value === null) return null;
  const result = value.getTime();
  if (!Number.isFinite(result)) throw new Error("資料庫時間格式錯誤");
  return result;
};

const requiredMillis = (value: Date): number => {
  const result = dateMillis(value);
  if (result === null) throw new Error("資料庫缺少必要時間");
  return result;
};

const normalizedName = (value: string): string => {
  const result = value.trim();
  if (!result || result.length > 20)
    throw new Error("顯示名稱必須介於 1 到 20 個字元");
  return result;
};

const validUserStatus = (value: string): UserStatus => {
  if (value === "active" || value === "suspended" || value === "deactivated")
    return value;
  throw new Error(`資料庫使用者狀態格式錯誤：${value}`);
};

const validMatchMode = (value: string): MatchMode => {
  if (
    value === "ai" ||
    value === "local" ||
    value === "friend" ||
    value === "rated"
  )
    return value;
  throw new Error(`資料庫對局模式格式錯誤：${value}`);
};

const validMatchStatus = (value: string): MatchStatus => {
  if (
    value === "active" ||
    value === "completed" ||
    value === "cancelled" ||
    value === "aborted"
  )
    return value;
  throw new Error(`資料庫對局狀態格式錯誤：${value}`);
};

const validParticipantResult = (value: string): ParticipantResult => {
  if (
    value === "win" ||
    value === "loss" ||
    value === "draw" ||
    value === "unknown"
  )
    return value;
  throw new Error(`資料庫參與者結果格式錯誤：${value}`);
};

const validGame = (value: string): GameId => {
  if (isGameId(value)) return value;
  throw new Error(`資料庫棋種格式錯誤：${value}`);
};

const validSequence = (value: number | string): number => {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 1)
    throw new Error("資料庫事件 sequence 格式錯誤");
  return result;
};

const timestamp = (value: number | undefined): number => {
  const result = value ?? Date.now();
  if (!Number.isFinite(result)) throw new Error("時間格式錯誤");
  return result;
};

const parseJson = (value: unknown): unknown =>
  typeof value === "string" ? JSON.parse(value) : value;

const sameJson = (left: unknown, right: unknown): boolean =>
  isDeepStrictEqual(parseJson(left), parseJson(right));

const parseUser = (row: UserRow): UserRecord => ({
  id: row.id,
  displayName: row.display_name,
  status: validUserStatus(row.status),
  createdAt: requiredMillis(row.created_at),
  lastActiveAt: requiredMillis(row.last_active_at),
});

const parseSession = (row: SessionRow): SessionRecord => ({
  id: row.id,
  userId: row.user_id,
  tokenHash: row.token_hash,
  createdAt: requiredMillis(row.created_at),
  expiresAt: requiredMillis(row.expires_at),
  revokedAt: dateMillis(row.revoked_at),
});

const parseParticipant = (row: ParticipantRow): MatchParticipant => ({
  matchId: row.match_id,
  seat: row.seat,
  userId: row.user_id,
  displayName: row.display_name,
  bot: row.bot,
  result: validParticipantResult(row.result),
  joinedAt: requiredMillis(row.joined_at),
});

const parseMatch = (
  row: MatchRow,
  participants: readonly MatchParticipant[],
): MatchRecord => ({
  id: row.id,
  roomCode: row.room_code,
  game: validGame(row.game),
  mode: validMatchMode(row.mode),
  status: validMatchStatus(row.status),
  startedAt: requiredMillis(row.started_at),
  completedAt: dateMillis(row.completed_at),
  outcome:
    row.outcome_json === null
      ? null
      : (parseJson(row.outcome_json) as MatchOutcome),
  schemaVersion: row.schema_version,
  retentionUntil: dateMillis(row.retention_until),
  participants,
});

const parseEvent = (row: EventRow): MatchEvent => ({
  matchId: row.match_id,
  sequence: validSequence(row.sequence),
  eventType: row.event_type,
  actorSeat: row.actor_seat,
  payload: parseJson(row.payload_json),
  createdAt: requiredMillis(row.created_at),
  schemaVersion: row.schema_version,
});

const parseAudit = (row: AuditRow): AuditRecord => ({
  id: row.id,
  action: row.action,
  userId: row.user_id,
  matchId: row.match_id,
  requestId: row.request_id,
  metadata: parseJson(row.metadata_json),
  createdAt: requiredMillis(row.created_at),
});

type Queryable = Pick<PoolClient, "query">;

export class PostgresProductStore implements ProductStore {
  private readonly pool: Pool;

  constructor(options: PostgresProductStoreOptions = {}) {
    if (options.pool) {
      this.pool = options.pool;
      return;
    }
    const config: PoolConfig = {};
    if (options.connectionString)
      config.connectionString = options.connectionString;
    this.pool = new Pool(config);
  }

  initialize(): Promise<void> {
    return runMigrations(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const now = timestamp(input.createdAt);
    const id = input.id ?? randomUUID();
    const result = await this.pool.query<UserRow>(
      `
        INSERT INTO qiju_users (
          id, display_name, status, created_at, last_active_at
        )
        VALUES ($1, $2, 'active', $3, $3)
        RETURNING id, display_name, status, created_at, last_active_at
      `,
      [id, normalizedName(input.displayName), new Date(now)],
    );
    const row = result.rows[0];
    if (!row) throw new Error("建立使用者失敗");
    return parseUser(row);
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>(
      `
        SELECT id, display_name, status, created_at, last_active_at
        FROM qiju_users
        WHERE id = $1
      `,
      [id],
    );
    const row = result.rows[0];
    return row ? parseUser(row) : null;
  }

  async touchUser(id: string, at = Date.now()): Promise<void> {
    const result = await this.pool.query(
      `UPDATE qiju_users SET last_active_at = $2 WHERE id = $1`,
      [id, new Date(timestamp(at))],
    );
    if (result.rowCount !== 1)
      throw new ProductStoreNotFoundError(`找不到使用者：${id}`);
  }

  async setUserStatus(
    id: string,
    status: UserStatus,
    at = Date.now(),
  ): Promise<UserRecord> {
    const result = await this.pool.query<UserRow>(
      `
        UPDATE qiju_users
        SET status = $2, last_active_at = $3
        WHERE id = $1
        RETURNING id, display_name, status, created_at, last_active_at
      `,
      [id, status, new Date(timestamp(at))],
    );
    const row = result.rows[0];
    if (!row) throw new ProductStoreNotFoundError(`找不到使用者：${id}`);
    return parseUser(row);
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const createdAt = timestamp(input.createdAt);
    if (!input.token) throw new Error("session token 不可為空");
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= createdAt)
      throw new Error("session 到期時間格式錯誤");
    const result = await this.pool.query<SessionRow>(
      `
        INSERT INTO qiju_sessions (
          id, user_id, token_hash, created_at, expires_at, revoked_at
        )
        VALUES ($1, $2, $3, $4, $5, NULL)
        RETURNING id, user_id, token_hash, created_at, expires_at, revoked_at
      `,
      [
        input.id ?? randomUUID(),
        input.userId,
        hashSessionToken(input.token),
        new Date(createdAt),
        new Date(input.expiresAt),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("建立 session 失敗");
    return parseSession(row);
  }

  async findActiveSession(
    token: string,
    now = Date.now(),
  ): Promise<SessionRecord | null> {
    const result = await this.pool.query<SessionRow>(
      `
        SELECT id, user_id, token_hash, created_at, expires_at, revoked_at
        FROM qiju_sessions
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > $2
      `,
      [hashSessionToken(token), new Date(timestamp(now))],
    );
    const row = result.rows[0];
    return row ? parseSession(row) : null;
  }

  async revokeSession(token: string, at = Date.now()): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE qiju_sessions
        SET revoked_at = $2
        WHERE token_hash = $1 AND revoked_at IS NULL
      `,
      [hashSessionToken(token), new Date(timestamp(at))],
    );
    return result.rowCount === 1;
  }

  async createMatch(input: CreateMatchInput): Promise<MatchRecord> {
    const id = input.id ?? randomUUID();
    await this.pool.query(
      `
        INSERT INTO qiju_matches (
          id, room_code, game, mode, status, started_at, completed_at,
          outcome_json, schema_version, retention_until
        )
        VALUES ($1, $2, $3, $4, 'active', $5, NULL, NULL, $6, $7)
      `,
      [
        id,
        input.roomCode,
        input.game,
        input.mode,
        new Date(timestamp(input.startedAt)),
        input.schemaVersion ?? PRODUCT_SCHEMA_VERSION,
        input.retentionUntil === undefined || input.retentionUntil === null
          ? null
          : new Date(input.retentionUntil),
      ],
    );
    const match = await this.getMatch(id);
    if (!match) throw new Error("建立對局失敗");
    return match;
  }

  async getMatch(id: string): Promise<MatchRecord | null> {
    return this.loadMatch(this.pool, id);
  }

  async addMatchParticipant(
    input: AddMatchParticipantInput,
  ): Promise<MatchParticipant> {
    const match = await this.getMatch(input.matchId);
    if (!match)
      throw new ProductStoreNotFoundError(`找不到對局：${input.matchId}`);
    const participant: MatchParticipant = {
      matchId: input.matchId,
      seat: input.seat,
      userId: input.userId ?? null,
      displayName: normalizedName(input.displayName),
      bot: input.bot,
      result: "unknown",
      joinedAt: timestamp(input.joinedAt),
    };
    await this.pool.query(
      `
        INSERT INTO qiju_match_participants (
          match_id, seat, user_id, display_name, bot, result, joined_at
        )
        VALUES ($1, $2, $3, $4, $5, 'unknown', $6)
        ON CONFLICT (match_id, seat) DO NOTHING
      `,
      [
        participant.matchId,
        participant.seat,
        participant.userId,
        participant.displayName,
        participant.bot,
        new Date(participant.joinedAt),
      ],
    );
    const result = await this.pool.query<ParticipantRow>(
      `
        SELECT match_id, seat, user_id, display_name, bot, result, joined_at
        FROM qiju_match_participants
        WHERE match_id = $1 AND seat = $2
      `,
      [participant.matchId, participant.seat],
    );
    const row = result.rows[0];
    if (!row) throw new Error("建立對局參與者失敗");
    const existing = parseParticipant(row);
    if (
      existing.userId !== participant.userId ||
      existing.displayName !== participant.displayName ||
      existing.bot !== participant.bot
    )
      throw new ProductStoreConflictError(
        `對局座位已被其他玩家使用：${input.matchId}/${String(input.seat)}`,
      );
    return existing;
  }

  async appendMatchEvent(input: AppendMatchEventInput): Promise<MatchEvent> {
    const match = await this.getMatch(input.matchId);
    if (!match)
      throw new ProductStoreNotFoundError(`找不到對局：${input.matchId}`);
    const event: MatchEvent = {
      matchId: input.matchId,
      sequence: input.sequence,
      eventType: input.eventType,
      actorSeat: input.actorSeat ?? null,
      payload: structuredClone(input.payload),
      createdAt: timestamp(input.createdAt),
      schemaVersion: input.schemaVersion ?? MATCH_EVENT_SCHEMA_VERSION,
    };
    await this.pool.query(
      `
        INSERT INTO qiju_match_events (
          match_id, sequence, event_type, actor_seat, payload_json,
          created_at, schema_version
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
        ON CONFLICT (match_id, sequence) DO NOTHING
      `,
      [
        event.matchId,
        event.sequence,
        event.eventType,
        event.actorSeat,
        JSON.stringify(event.payload),
        new Date(event.createdAt),
        event.schemaVersion,
      ],
    );
    const result = await this.pool.query<EventRow>(
      `
        SELECT match_id, sequence, event_type, actor_seat, payload_json,
               created_at, schema_version
        FROM qiju_match_events
        WHERE match_id = $1 AND sequence = $2
      `,
      [event.matchId, event.sequence],
    );
    const row = result.rows[0];
    if (!row) throw new Error("寫入對局事件失敗");
    const existing = parseEvent(row);
    if (
      existing.eventType !== event.eventType ||
      existing.actorSeat !== event.actorSeat ||
      existing.schemaVersion !== event.schemaVersion ||
      !sameJson(existing.payload, event.payload)
    )
      throw new ProductStoreConflictError(
        `對局事件 sequence 衝突：${input.matchId}/${String(input.sequence)}`,
      );
    return existing;
  }

  async listMatchEvents(matchId: string): Promise<MatchEvent[]> {
    const match = await this.getMatch(matchId);
    if (!match) throw new ProductStoreNotFoundError(`找不到對局：${matchId}`);
    const result = await this.pool.query<EventRow>(
      `
        SELECT match_id, sequence, event_type, actor_seat, payload_json,
               created_at, schema_version
        FROM qiju_match_events
        WHERE match_id = $1
        ORDER BY sequence
      `,
      [matchId],
    );
    return result.rows.map(parseEvent);
  }

  async completeMatch(input: CompleteMatchInput): Promise<MatchRecord> {
    return this.transaction(async (client) => {
      const current = await this.loadMatch(client, input.matchId);
      if (!current)
        throw new ProductStoreNotFoundError(`找不到對局：${input.matchId}`);
      if (current.status === "completed") {
        if (!sameJson(current.outcome, input.outcome))
          throw new ProductStoreConflictError(
            `對局結算結果衝突：${input.matchId}`,
          );
        return current;
      }
      if (current.status !== "active")
        throw new ProductStoreConflictError(
          `對局目前不可結算：${input.matchId}`,
        );
      await client.query(
        `
          UPDATE qiju_matches
          SET status = 'completed', completed_at = $2, outcome_json = $3::jsonb
          WHERE id = $1
        `,
        [
          input.matchId,
          new Date(timestamp(input.completedAt)),
          JSON.stringify(input.outcome),
        ],
      );
      for (const participant of current.participants) {
        const explicit = input.participantResults?.find(
          (entry) => entry.seat === participant.seat,
        );
        const result =
          explicit?.result ??
          (input.outcome.winnerSeat === null
            ? "draw"
            : input.outcome.winnerSeat === participant.seat
              ? "win"
              : "loss");
        await client.query(
          `
            UPDATE qiju_match_participants
            SET result = $3
            WHERE match_id = $1 AND seat = $2
          `,
          [input.matchId, participant.seat, result],
        );
      }
      const completed = await this.loadMatch(client, input.matchId);
      if (!completed) throw new Error("讀取已完成對局失敗");
      return completed;
    });
  }

  async abortMatch(input: AbortMatchInput): Promise<MatchRecord> {
    return this.transaction(async (client) => {
      const current = await this.loadMatch(client, input.matchId);
      if (!current)
        throw new ProductStoreNotFoundError(`找不到對局：${input.matchId}`);
      if (current.status === "aborted") return current;
      if (current.status !== "active")
        throw new ProductStoreConflictError(
          `對局目前不可中止：${input.matchId}`,
        );
      await client.query(
        `
          UPDATE qiju_matches
          SET status = 'aborted', completed_at = $2,
              outcome_json = $3::jsonb
          WHERE id = $1
        `,
        [
          input.matchId,
          new Date(timestamp(input.abortedAt)),
          JSON.stringify({ winnerSeat: null, reason: input.reason }),
        ],
      );
      const aborted = await this.loadMatch(client, input.matchId);
      if (!aborted) throw new Error("讀取中止對局失敗");
      return aborted;
    });
  }

  async recordAudit(input: RecordAuditInput): Promise<AuditRecord> {
    const result = await this.pool.query<AuditRow>(
      `
        INSERT INTO qiju_audit_log (
          id, action, user_id, match_id, request_id, metadata_json, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
        RETURNING id, action, user_id, match_id, request_id,
                  metadata_json, created_at
      `,
      [
        input.id ?? randomUUID(),
        input.action,
        input.userId ?? null,
        input.matchId ?? null,
        input.requestId ?? null,
        JSON.stringify(input.metadata ?? null),
        new Date(timestamp(input.createdAt)),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("寫入稽核紀錄失敗");
    return parseAudit(row);
  }

  private async loadMatch(
    queryable: Queryable,
    id: string,
  ): Promise<MatchRecord | null> {
    const matchResult = await queryable.query<MatchRow>(
      `
        SELECT id, room_code, game, mode, status, started_at, completed_at,
               outcome_json, schema_version, retention_until
        FROM qiju_matches
        WHERE id = $1
      `,
      [id],
    );
    const matchRow = matchResult.rows[0];
    if (!matchRow) return null;
    const participantResult = await queryable.query<ParticipantRow>(
      `
        SELECT match_id, seat, user_id, display_name, bot, result, joined_at
        FROM qiju_match_participants
        WHERE match_id = $1
        ORDER BY seat
      `,
      [id],
    );
    return parseMatch(matchRow, participantResult.rows.map(parseParticipant));
  }

  private async transaction<Value>(
    operation: (client: PoolClient) => Promise<Value>,
  ): Promise<Value> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
