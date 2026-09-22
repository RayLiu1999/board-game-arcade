import { Pool, type PoolClient, type PoolConfig } from "pg";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { isGameId, type GameId } from "../shared/protocol.js";
import {
  calculateElo,
  INITIAL_RATING,
  RATING_VERSION,
  type RatingResult,
} from "./rating.js";
import { hashSessionToken } from "./product-security.js";
import {
  MATCH_EVENT_SCHEMA_VERSION,
  PRODUCT_SCHEMA_VERSION,
  ProductStoreConflictError,
  ProductStoreNotFoundError,
  defaultUserPreferences,
  defaultUserRating,
  mergeUserPreferences,
  type AbortMatchInput,
  type AddMatchParticipantInput,
  type AppendMatchEventInput,
  type AuditRecord,
  type CompleteMatchInput,
  type CreateMatchInput,
  type CreateSessionInput,
  type CreateUserInput,
  type MatchEvent,
  type MatchHistoryPage,
  type ListMatchHistoryInput,
  type MatchMode,
  type MatchOutcome,
  type MatchParticipant,
  type MatchRecord,
  type MatchStatus,
  type ParticipantResult,
  type ProductStore,
  type RatingRecord,
  type RecordAuditInput,
  type SessionRecord,
  type UpdateUserPreferencesInput,
  type UpdateUserProfileInput,
  type UserMatchStats,
  type UserPreferences,
  type UserRecord,
  type UserTheme,
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

interface PreferenceRow {
  readonly user_id: string;
  readonly locale: string;
  readonly theme: string;
  readonly sound_enabled: boolean;
  readonly history_public: boolean;
  readonly friend_invites: boolean;
  readonly show_online_status: boolean;
  readonly updated_at: Date;
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

interface CountRow {
  readonly total: number | string;
}

interface StatsRow {
  readonly completed: number | string;
  readonly wins: number | string;
  readonly losses: number | string;
  readonly draws: number | string;
}

interface StatsByGameRow extends StatsRow {
  readonly game: string;
}

interface RatingRow {
  readonly user_id: string;
  readonly game: string;
  readonly rating: number;
  readonly games_played: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly provisional: boolean;
  readonly rating_version: number;
  readonly updated_at: Date;
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

const validUserTheme = (value: string): UserTheme => {
  if (value === "system" || value === "light" || value === "dark") return value;
  throw new Error(`資料庫主題格式錯誤：${value}`);
};

const validMatchMode = (value: string): MatchMode => {
  if (
    value === "ai" ||
    value === "local" ||
    value === "friend" ||
    value === "public" ||
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

const parsePreferences = (row: PreferenceRow): UserPreferences => ({
  userId: row.user_id,
  locale: row.locale,
  theme: validUserTheme(row.theme),
  soundEnabled: row.sound_enabled,
  historyPublic: row.history_public,
  friendInvites: row.friend_invites,
  showOnlineStatus: row.show_online_status,
  updatedAt: requiredMillis(row.updated_at),
});

const parseRating = (row: RatingRow): RatingRecord => ({
  userId: row.user_id,
  game: validGame(row.game),
  rating: row.rating,
  gamesPlayed: row.games_played,
  wins: row.wins,
  losses: row.losses,
  draws: row.draws,
  provisional: row.provisional,
  ratingVersion: row.rating_version,
  updatedAt: requiredMillis(row.updated_at),
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

const ratedResultForSeat = (
  outcome: MatchOutcome,
  seat: number,
): RatingResult => {
  if (outcome.winnerSeat === null) return "draw";
  return outcome.winnerSeat === seat ? "win" : "loss";
};

const validateRatedParticipants = (
  match: MatchRecord,
  outcome: MatchOutcome,
  explicit: CompleteMatchInput["participantResults"],
): Array<{
  participant: MatchRecord["participants"][number];
  result: RatingResult;
}> => {
  if (match.game === "riichi" || match.participants.length !== 2)
    throw new ProductStoreConflictError("rated 對局必須由兩名真人玩家完成");
  if (
    outcome.winnerSeat !== null &&
    !match.participants.some(
      (participant) => participant.seat === outcome.winnerSeat,
    )
  )
    throw new ProductStoreConflictError("rated 對局結果缺少勝者座位");
  const userIds = new Set<string>();
  return match.participants.map((participant) => {
    if (participant.bot || participant.userId === null)
      throw new ProductStoreConflictError("rated 對局需要綁定真人身份");
    if (userIds.has(participant.userId))
      throw new ProductStoreConflictError("rated 對局不能由同一玩家佔用兩席");
    userIds.add(participant.userId);
    const result = ratedResultForSeat(outcome, participant.seat);
    const requested = explicit?.find(
      (entry) => entry.seat === participant.seat,
    );
    if (requested && requested.result !== result)
      throw new ProductStoreConflictError("rated 對局結果不可由呼叫端修改");
    return { participant, result };
  });
};

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

  async updateUserProfile(
    id: string,
    input: UpdateUserProfileInput,
    at = Date.now(),
  ): Promise<UserRecord> {
    const result = await this.pool.query<UserRow>(
      `
        UPDATE qiju_users
        SET display_name = COALESCE($2, display_name), last_active_at = $3
        WHERE id = $1
        RETURNING id, display_name, status, created_at, last_active_at
      `,
      [
        id,
        input.displayName === undefined
          ? null
          : normalizedName(input.displayName),
        new Date(timestamp(at)),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new ProductStoreNotFoundError(`找不到使用者：${id}`);
    return parseUser(row);
  }

  async getUserPreferences(id: string): Promise<UserPreferences> {
    const result = await this.pool.query<PreferenceRow>(
      `
        SELECT user_id, locale, theme, sound_enabled, history_public,
               friend_invites, show_online_status, updated_at
        FROM qiju_user_preferences
        WHERE user_id = $1
      `,
      [id],
    );
    const row = result.rows[0];
    if (row) return parsePreferences(row);
    const user = await this.getUser(id);
    if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${id}`);
    return defaultUserPreferences(id, user.createdAt);
  }

  async updateUserPreferences(
    id: string,
    input: UpdateUserPreferencesInput,
    at = Date.now(),
  ): Promise<UserPreferences> {
    const current = await this.getUserPreferences(id);
    const updated = mergeUserPreferences(current, input, at);
    const result = await this.pool.query<PreferenceRow>(
      `
        INSERT INTO qiju_user_preferences (
          user_id, locale, theme, sound_enabled, history_public,
          friend_invites, show_online_status, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id) DO UPDATE SET
          locale = EXCLUDED.locale,
          theme = EXCLUDED.theme,
          sound_enabled = EXCLUDED.sound_enabled,
          history_public = EXCLUDED.history_public,
          friend_invites = EXCLUDED.friend_invites,
          show_online_status = EXCLUDED.show_online_status,
          updated_at = EXCLUDED.updated_at
        RETURNING user_id, locale, theme, sound_enabled, history_public,
                  friend_invites, show_online_status, updated_at
      `,
      [
        updated.userId,
        updated.locale,
        updated.theme,
        updated.soundEnabled,
        updated.historyPublic,
        updated.friendInvites,
        updated.showOnlineStatus,
        new Date(updated.updatedAt),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("更新使用者偏好失敗");
    return parsePreferences(row);
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

  async linkMatchParticipant(
    matchId: string,
    seat: number,
    userId: string,
  ): Promise<MatchParticipant> {
    const result = await this.pool.query<ParticipantRow>(
      `
        UPDATE qiju_match_participants
        SET user_id = $3
        WHERE match_id = $1 AND seat = $2
          AND (user_id IS NULL OR user_id = $3)
        RETURNING match_id, seat, user_id, display_name, bot, result, joined_at
      `,
      [matchId, seat, userId],
    );
    const row = result.rows[0];
    if (row) return parseParticipant(row);
    const existing = await this.pool.query<ParticipantRow>(
      `
        SELECT match_id, seat, user_id, display_name, bot, result, joined_at
        FROM qiju_match_participants
        WHERE match_id = $1 AND seat = $2
      `,
      [matchId, seat],
    );
    const current = existing.rows[0];
    if (!current)
      throw new ProductStoreNotFoundError(
        `找不到對局參與者：${matchId}/${String(seat)}`,
      );
    throw new ProductStoreConflictError(
      `對局參與者已綁定其他使用者：${matchId}/${String(seat)}`,
    );
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

  async listMatchesForUser(
    input: ListMatchHistoryInput,
  ): Promise<MatchHistoryPage> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    if (!Number.isSafeInteger(page) || page < 1)
      throw new Error("歷史頁碼格式錯誤");
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50)
      throw new Error("歷史每頁筆數必須介於 1 到 50");
    const clauses = ["p.user_id = $1", "m.status <> 'active'"];
    const params: unknown[] = [input.userId];
    const add = (clause: string, value: unknown): void => {
      params.push(value);
      clauses.push(clause.replace("$N", `$${String(params.length)}`));
    };
    if (input.game !== undefined) add("m.game = $N", input.game);
    if (input.mode !== undefined) add("m.mode = $N", input.mode);
    if (input.result !== undefined) add("p.result = $N", input.result);
    if (input.from !== undefined) {
      if (!Number.isFinite(input.from)) throw new Error("歷史起始時間格式錯誤");
      add("m.started_at >= $N", new Date(input.from));
    }
    if (input.to !== undefined) {
      if (!Number.isFinite(input.to)) throw new Error("歷史結束時間格式錯誤");
      add("m.started_at <= $N", new Date(input.to));
    }
    const where = clauses.join(" AND ");
    const countResult = await this.pool.query<CountRow>(
      `
        SELECT count(*)::int AS total
        FROM qiju_matches AS m
        JOIN qiju_match_participants AS p ON p.match_id = m.id
        WHERE ${where}
      `,
      params,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    const offset = (page - 1) * pageSize;
    const matchResult = await this.pool.query<{ id: string }>(
      `
        SELECT m.id
        FROM qiju_matches AS m
        JOIN qiju_match_participants AS p ON p.match_id = m.id
        WHERE ${where}
        ORDER BY m.started_at DESC, m.id DESC
        LIMIT $${String(params.length + 1)}
        OFFSET $${String(params.length + 2)}
      `,
      [...params, pageSize, offset],
    );
    const matches: MatchRecord[] = [];
    for (const row of matchResult.rows) {
      const match = await this.getMatch(row.id);
      if (match) matches.push(match);
    }
    return {
      matches,
      page,
      pageSize,
      total,
      hasNext: offset + matches.length < total,
    };
  }

  async getUserMatchStats(userId: string): Promise<UserMatchStats> {
    const user = await this.getUser(userId);
    if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${userId}`);
    const base = await this.pool.query<StatsRow>(
      `
        SELECT
          count(*)::int AS completed,
          count(*) FILTER (WHERE p.result = 'win')::int AS wins,
          count(*) FILTER (WHERE p.result = 'loss')::int AS losses,
          count(*) FILTER (WHERE p.result = 'draw')::int AS draws
        FROM qiju_matches AS m
        JOIN qiju_match_participants AS p ON p.match_id = m.id
        WHERE p.user_id = $1 AND m.status = 'completed'
      `,
      [userId],
    );
    const byGame = await this.pool.query<StatsByGameRow>(
      `
        SELECT
          m.game,
          count(*)::int AS completed,
          count(*) FILTER (WHERE p.result = 'win')::int AS wins,
          count(*) FILTER (WHERE p.result = 'loss')::int AS losses,
          count(*) FILTER (WHERE p.result = 'draw')::int AS draws
        FROM qiju_matches AS m
        JOIN qiju_match_participants AS p ON p.match_id = m.id
        WHERE p.user_id = $1 AND m.status = 'completed'
        GROUP BY m.game
        ORDER BY m.game
      `,
      [userId],
    );
    const row = base.rows[0];
    const number = (value: number | string | undefined): number =>
      Number(value ?? 0);
    return {
      userId,
      completed: number(row?.completed),
      wins: number(row?.wins),
      losses: number(row?.losses),
      draws: number(row?.draws),
      byGame: byGame.rows.map((entry) => ({
        game: validGame(entry.game),
        completed: number(entry.completed),
        wins: number(entry.wins),
        losses: number(entry.losses),
        draws: number(entry.draws),
      })),
    };
  }

  async getUserRating(userId: string, game: GameId): Promise<RatingRecord> {
    const user = await this.getUser(userId);
    if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${userId}`);
    const result = await this.pool.query<RatingRow>(
      `
        SELECT user_id, game, rating, games_played, wins, losses, draws,
               provisional, rating_version, updated_at
        FROM qiju_ratings
        WHERE user_id = $1 AND game = $2
      `,
      [userId, game],
    );
    const row = result.rows[0];
    return row ? parseRating(row) : defaultUserRating(userId, game);
  }

  async getUserRatings(userId: string): Promise<readonly RatingRecord[]> {
    const user = await this.getUser(userId);
    if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${userId}`);
    const result = await this.pool.query<RatingRow>(
      `
        SELECT user_id, game, rating, games_played, wins, losses, draws,
               provisional, rating_version, updated_at
        FROM qiju_ratings
        WHERE user_id = $1
        ORDER BY game
      `,
      [userId],
    );
    return result.rows.map(parseRating);
  }

  async completeMatch(input: CompleteMatchInput): Promise<MatchRecord> {
    return this.transaction(async (client) => {
      const current = await this.loadMatch(client, input.matchId, true);
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
      const completedAt = timestamp(input.completedAt);
      const rated =
        current.mode === "rated"
          ? validateRatedParticipants(
              current,
              input.outcome,
              input.participantResults,
            )
          : null;
      if (rated)
        await this.settleRatedMatch(client, current, rated, completedAt);
      await client.query(
        `
          UPDATE qiju_matches
          SET status = 'completed', completed_at = $2, outcome_json = $3::jsonb
          WHERE id = $1
        `,
        [input.matchId, new Date(completedAt), JSON.stringify(input.outcome)],
      );
      for (const participant of current.participants) {
        const ratedResult = rated?.find(
          (entry) => entry.participant.seat === participant.seat,
        )?.result;
        const explicit = ratedResult
          ? undefined
          : input.participantResults?.find(
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
      const current = await this.loadMatch(client, input.matchId, true);
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

  private async settleRatedMatch(
    client: PoolClient,
    match: MatchRecord,
    rated: Array<{
      participant: MatchRecord["participants"][number];
      result: RatingResult;
    }>,
    completedAt: number,
  ): Promise<void> {
    const userIds = rated
      .map(({ participant }) => participant.userId)
      .filter((userId): userId is string => userId !== null)
      .sort();
    const users = await client.query<{ id: string }>(
      `
        SELECT id
        FROM qiju_users
        WHERE id = ANY($1::uuid[])
        ORDER BY id
        FOR UPDATE
      `,
      [userIds],
    );
    if (users.rows.length !== userIds.length)
      throw new ProductStoreNotFoundError("rated 玩家身份不存在");

    const currentRatings = new Map<string, RatingRecord>();
    for (const userId of userIds) {
      await client.query(
        `
          INSERT INTO qiju_ratings (
            user_id, game, rating, games_played, wins, losses, draws,
            provisional, rating_version, updated_at
          )
          VALUES ($1, $2, $3, 0, 0, 0, 0, true, $4, $5)
          ON CONFLICT (user_id, game) DO NOTHING
        `,
        [
          userId,
          match.game,
          INITIAL_RATING,
          RATING_VERSION,
          new Date(completedAt),
        ],
      );
      const result = await client.query<RatingRow>(
        `
          SELECT user_id, game, rating, games_played, wins, losses, draws,
                 provisional, rating_version, updated_at
          FROM qiju_ratings
          WHERE user_id = $1 AND game = $2
          FOR UPDATE
        `,
        [userId, match.game],
      );
      const row = result.rows[0];
      if (!row) throw new Error("讀取 rated 評分失敗");
      const current = parseRating(row);
      if (current.ratingVersion !== RATING_VERSION)
        throw new ProductStoreConflictError("評分版本不相容");
      currentRatings.set(userId, current);
    }

    const first = rated[0];
    const second = rated[1];
    if (
      !first ||
      !second ||
      !first.participant.userId ||
      !second.participant.userId
    )
      throw new Error("rated 對局玩家資料不足");
    const firstCurrent = currentRatings.get(first.participant.userId);
    const secondCurrent = currentRatings.get(second.participant.userId);
    if (!firstCurrent || !secondCurrent) throw new Error("rated 評分資料不足");
    const calculations = [
      calculateElo({
        rating: firstCurrent.rating,
        opponentRating: secondCurrent.rating,
        gamesPlayed: firstCurrent.gamesPlayed,
        result: first.result,
      }),
      calculateElo({
        rating: secondCurrent.rating,
        opponentRating: firstCurrent.rating,
        gamesPlayed: secondCurrent.gamesPlayed,
        result: second.result,
      }),
    ];
    for (const [index, entry] of rated.entries()) {
      const current = index === 0 ? firstCurrent : secondCurrent;
      const calculation = calculations[index];
      if (!calculation || !entry.participant.userId) continue;
      const { result } = entry;
      await client.query(
        `
          UPDATE qiju_ratings
          SET rating = $3,
              games_played = $4,
              wins = $5,
              losses = $6,
              draws = $7,
              provisional = $8,
              rating_version = $9,
              updated_at = $10
          WHERE user_id = $1 AND game = $2
        `,
        [
          entry.participant.userId,
          match.game,
          calculation.ratingAfter,
          calculation.gamesAfter,
          current.wins + (result === "win" ? 1 : 0),
          current.losses + (result === "loss" ? 1 : 0),
          current.draws + (result === "draw" ? 1 : 0),
          calculation.provisional,
          RATING_VERSION,
          new Date(completedAt),
        ],
      );
      await client.query(
        `
          INSERT INTO qiju_rating_results (
            match_id, seat, user_id, game, result, rating_before,
            rating_after, rating_delta, games_before, games_after,
            k_factor, provisional, rating_version, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `,
        [
          match.id,
          entry.participant.seat,
          entry.participant.userId,
          match.game,
          result,
          calculation.ratingBefore,
          calculation.ratingAfter,
          calculation.ratingDelta,
          calculation.gamesBefore,
          calculation.gamesAfter,
          calculation.kFactor,
          calculation.provisional,
          RATING_VERSION,
          new Date(completedAt),
        ],
      );
    }
  }

  private async loadMatch(
    queryable: Queryable,
    id: string,
    lock = false,
  ): Promise<MatchRecord | null> {
    const matchResult = await queryable.query<MatchRow>(
      `
        SELECT id, room_code, game, mode, status, started_at, completed_at,
               outcome_json, schema_version, retention_until
        FROM qiju_matches
        WHERE id = $1
        ${lock ? "FOR UPDATE" : ""}
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
