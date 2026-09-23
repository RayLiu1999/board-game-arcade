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
import {
  createOpaqueToken,
  createPublicCode,
  hashSessionToken,
  matchesSessionToken,
  normalizeAccountName,
  normalizePublicCode,
} from "./product-security.js";
import {
  MATCH_EVENT_SCHEMA_VERSION,
  PRODUCT_SCHEMA_VERSION,
  FRIEND_REQUEST_PENDING_LIMIT,
  FRIEND_REQUEST_REJECTION_COOLDOWN_MS,
  ROOM_ENTRY_TOKEN_TTL_MS,
  ROOM_INVITATION_PENDING_LIMIT,
  ROOM_INVITATION_TTL_MS,
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
  type AccountCredentialRecord,
  type CreateRoomInvitationInput,
  type RoomInvitationPreview,
  type AcceptedRoomInvitation,
  type FriendRequestRecord,
  type FriendConnection,
  type FriendRequestPreview,
  type BlockedUserPreview,
  type SocialOverview,
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
  type LeaderboardEntry,
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
  readonly public_code: string;
  readonly login_name: string | null;
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
  readonly show_in_leaderboard: boolean;
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

interface FriendRequestRow {
  readonly id: string;
  readonly requester_id: string;
  readonly recipient_id: string;
  readonly status: string;
  readonly created_at: Date;
  readonly responded_at: Date | null;
}

interface FriendListRow {
  readonly user_id: string;
  readonly display_name: string;
  readonly created_at: Date;
  readonly is_online: boolean | null;
}

interface LeaderboardRow {
  readonly rank: number | string;
  readonly public_code: string;
  readonly display_name: string;
  readonly rating: number;
  readonly games_played: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly provisional: boolean;
}

interface RoomInvitationRow {
  readonly id: string;
  readonly room_code: string;
  readonly game: string;
  readonly inviter_id: string;
  readonly inviter_name: string;
  readonly recipient_id: string;
  readonly status: string;
  readonly created_at: Date;
  readonly expires_at: Date;
  readonly entry_token_hash: string | null;
  readonly entry_token_expires_at: Date | null;
}

type BlockedUserRow = FriendListRow;

interface SocialUserStatusRow {
  readonly id: string;
  readonly status: string;
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
  publicCode: row.public_code,
  loginName: row.login_name,
  displayName: row.display_name,
  status: validUserStatus(row.status),
  createdAt: requiredMillis(row.created_at),
  lastActiveAt: requiredMillis(row.last_active_at),
});

const parseFriendRequest = (row: FriendRequestRow): FriendRequestRecord => {
  if (
    row.status !== "pending" &&
    row.status !== "accepted" &&
    row.status !== "rejected" &&
    row.status !== "cancelled"
  )
    throw new Error(`資料庫好友邀請狀態格式錯誤：${row.status}`);
  return {
    id: row.id,
    requesterId: row.requester_id,
    recipientId: row.recipient_id,
    status: row.status,
    createdAt: requiredMillis(row.created_at),
    respondedAt: dateMillis(row.responded_at),
  };
};

const parseRoomInvitationPreview = (
  row: RoomInvitationRow,
): RoomInvitationPreview => {
  if (row.status !== "pending" && row.status !== "accepted")
    throw new Error(`資料庫房間邀請狀態格式錯誤：${row.status}`);
  return {
    id: row.id,
    roomCode: row.room_code,
    game: validGame(row.game),
    inviterId: row.inviter_id,
    inviterName: row.inviter_name,
    status: row.status,
    createdAt: requiredMillis(row.created_at),
    expiresAt: requiredMillis(row.expires_at),
  };
};

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
  showInLeaderboard: row.show_in_leaderboard,
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

const hasConstraint = (error: unknown, constraint: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  "constraint" in error &&
  error.constraint === constraint;

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
    const explicitCode = input.publicCode !== undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const publicCode = normalizePublicCode(
        input.publicCode ?? createPublicCode(),
      );
      try {
        const result = await this.pool.query<UserRow>(
          `
            INSERT INTO qiju_users (
              id, public_code, display_name, status, created_at, last_active_at
            )
            VALUES ($1, $2, $3, 'active', $4, $4)
            RETURNING id, public_code, login_name, display_name, status,
                      created_at, last_active_at
          `,
          [id, publicCode, normalizedName(input.displayName), new Date(now)],
        );
        const row = result.rows[0];
        if (!row) throw new Error("建立使用者失敗");
        return parseUser(row);
      } catch (error: unknown) {
        if (!hasConstraint(error, "qiju_users_public_code_uidx")) throw error;
        if (explicitCode) throw new ProductStoreConflictError("玩家代碼已存在");
        if (attempt === 4)
          throw new ProductStoreConflictError("無法產生唯一玩家代碼，請重試");
      }
    }
    throw new Error("建立使用者失敗");
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>(
      `
        SELECT id, public_code, login_name, display_name, status,
               created_at, last_active_at
        FROM qiju_users
        WHERE id = $1
      `,
      [id],
    );
    const row = result.rows[0];
    return row ? parseUser(row) : null;
  }

  async upgradeAccount(
    userId: string,
    loginName: string,
    passwordHash: string,
    at = Date.now(),
  ): Promise<UserRecord> {
    const normalizedLogin = normalizeAccountName(loginName);
    if (!passwordHash.startsWith("scrypt$"))
      throw new Error("密碼驗證值格式錯誤");
    let result;
    try {
      result = await this.pool.query<UserRow>(
        `
          UPDATE qiju_users
          SET login_name = $2, password_hash = $3, last_active_at = $4
          WHERE id = $1 AND login_name IS NULL AND status = 'active'
          RETURNING id, public_code, login_name, display_name, status,
                    created_at, last_active_at
        `,
        [userId, normalizedLogin, passwordHash, new Date(timestamp(at))],
      );
    } catch (error: unknown) {
      if (hasConstraint(error, "qiju_users_login_name_uidx"))
        throw new ProductStoreConflictError("帳號名稱已被使用");
      throw error;
    }
    const row = result.rows[0];
    if (row) return parseUser(row);
    const user = await this.getUser(userId);
    if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${userId}`);
    if (user.loginName)
      throw new ProductStoreConflictError("此玩家身份已綁定登入帳號");
    throw new ProductStoreConflictError("此玩家目前無法升級帳號");
  }

  async findAccountByLoginName(
    loginName: string,
  ): Promise<AccountCredentialRecord | null> {
    const result = await this.pool.query<
      UserRow & { readonly password_hash: string }
    >(
      `
        SELECT id, public_code, login_name, display_name, status,
               created_at, last_active_at, password_hash
        FROM qiju_users
        WHERE login_name = $1
      `,
      [normalizeAccountName(loginName)],
    );
    const row = result.rows[0];
    return row
      ? { user: parseUser(row), passwordHash: row.password_hash }
      : null;
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
        RETURNING id, public_code, login_name, display_name, status,
                  created_at, last_active_at
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
               friend_invites, show_online_status, show_in_leaderboard,
               updated_at
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
          friend_invites, show_online_status, show_in_leaderboard, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (user_id) DO UPDATE SET
          locale = EXCLUDED.locale,
          theme = EXCLUDED.theme,
          sound_enabled = EXCLUDED.sound_enabled,
          history_public = EXCLUDED.history_public,
          friend_invites = EXCLUDED.friend_invites,
          show_online_status = EXCLUDED.show_online_status,
          show_in_leaderboard = EXCLUDED.show_in_leaderboard,
          updated_at = EXCLUDED.updated_at
        RETURNING user_id, locale, theme, sound_enabled, history_public,
                  friend_invites, show_online_status, show_in_leaderboard,
                  updated_at
      `,
      [
        updated.userId,
        updated.locale,
        updated.theme,
        updated.soundEnabled,
        updated.historyPublic,
        updated.friendInvites,
        updated.showOnlineStatus,
        updated.showInLeaderboard,
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

  async touchPresence(
    connectionId: string,
    userId: string,
    touchedAt: number,
    expiresAt: number,
  ): Promise<void> {
    if (
      !Number.isFinite(touchedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= touchedAt ||
      expiresAt - touchedAt > 120_000
    )
      throw new Error("玩家上線租約時間格式錯誤");
    const result = await this.pool.query<{ readonly connection_id: string }>(
      `
        INSERT INTO qiju_user_presence (
          connection_id, user_id, touched_at, expires_at
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (connection_id) DO UPDATE SET
          touched_at = EXCLUDED.touched_at,
          expires_at = EXCLUDED.expires_at
        WHERE qiju_user_presence.user_id = EXCLUDED.user_id
        RETURNING connection_id
      `,
      [connectionId, userId, new Date(touchedAt), new Date(expiresAt)],
    );
    if (result.rowCount !== 1)
      throw new ProductStoreConflictError("玩家連線身份不一致");
  }

  async removePresence(connectionId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM qiju_user_presence WHERE connection_id = $1`,
      [connectionId],
    );
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
        RETURNING id, public_code, login_name, display_name, status,
                  created_at, last_active_at
      `,
      [id, status, new Date(timestamp(at))],
    );
    const row = result.rows[0];
    if (!row) throw new ProductStoreNotFoundError(`找不到使用者：${id}`);
    return parseUser(row);
  }

  async getSocialOverview(userId: string): Promise<SocialOverview> {
    const user = await this.getUser(userId);
    if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${userId}`);
    const [friends, incoming, outgoing, blocked] = await Promise.all([
      this.pool.query<FriendListRow>(
        `
          SELECT u.id AS user_id, u.display_name, f.created_at,
                 CASE WHEN COALESCE(p.show_online_status, FALSE)
                   THEN EXISTS (
                     SELECT 1 FROM qiju_user_presence online
                     WHERE online.user_id = u.id AND online.expires_at > now()
                   )
                   ELSE NULL
                 END AS is_online
          FROM qiju_friendships f
          JOIN qiju_users u
            ON u.id = CASE WHEN f.user_low = $1 THEN f.user_high ELSE f.user_low END
          LEFT JOIN qiju_user_preferences p ON p.user_id = u.id
          WHERE f.user_low = $1 OR f.user_high = $1
          ORDER BY u.display_name, u.id
        `,
        [userId],
      ),
      this.pool.query<FriendRequestRow & { readonly display_name: string }>(
        `
          SELECT r.id, r.requester_id, r.recipient_id, r.status,
                 r.created_at, r.responded_at, u.display_name
          FROM qiju_friend_requests r
          JOIN qiju_users u ON u.id = r.requester_id
          WHERE r.recipient_id = $1 AND r.status = 'pending'
          ORDER BY r.created_at, r.id
        `,
        [userId],
      ),
      this.pool.query<FriendRequestRow & { readonly display_name: string }>(
        `
          SELECT r.id, r.requester_id, r.recipient_id, r.status,
                 r.created_at, r.responded_at, u.display_name
          FROM qiju_friend_requests r
          JOIN qiju_users u ON u.id = r.recipient_id
          WHERE r.requester_id = $1 AND r.status = 'pending'
          ORDER BY r.created_at, r.id
        `,
        [userId],
      ),
      this.pool.query<BlockedUserRow>(
        `
          SELECT u.id AS user_id, u.display_name, b.created_at
          FROM qiju_user_blocks b
          JOIN qiju_users u ON u.id = b.blocked_user_id
          WHERE b.blocker_id = $1
          ORDER BY u.display_name, u.id
        `,
        [userId],
      ),
    ]);
    const requestPreview = (
      row: FriendRequestRow & { readonly display_name: string },
      otherUserId: string,
    ): FriendRequestPreview => ({
      id: row.id,
      userId: otherUserId,
      displayName: row.display_name,
      createdAt: requiredMillis(row.created_at),
    });
    const friendEntries: FriendConnection[] = friends.rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      since: requiredMillis(row.created_at),
      online: row.is_online,
    }));
    const blockedEntries: BlockedUserPreview[] = blocked.rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      blockedAt: requiredMillis(row.created_at),
    }));
    return {
      friendCode: user.publicCode,
      friends: friendEntries,
      incomingRequests: incoming.rows.map((row) =>
        requestPreview(row, row.requester_id),
      ),
      outgoingRequests: outgoing.rows.map((row) =>
        requestPreview(row, row.recipient_id),
      ),
      blockedUsers: blockedEntries,
    };
  }

  async areUsersBlocked(
    firstUserId: string,
    secondUserId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        SELECT 1
        FROM qiju_user_blocks
        WHERE (blocker_id = $1 AND blocked_user_id = $2)
           OR (blocker_id = $2 AND blocked_user_id = $1)
        LIMIT 1
      `,
      [firstUserId, secondUserId],
    );
    return result.rowCount === 1;
  }

  async getBlockedUserIds(userId: string): Promise<readonly string[]> {
    const result = await this.pool.query<{ readonly other_user_id: string }>(
      `
        SELECT CASE WHEN blocker_id = $1 THEN blocked_user_id ELSE blocker_id END
          AS other_user_id
        FROM qiju_user_blocks
        WHERE blocker_id = $1 OR blocked_user_id = $1
        ORDER BY other_user_id
      `,
      [userId],
    );
    return result.rows.map((row) => row.other_user_id);
  }

  async createRoomInvitation(
    input: CreateRoomInvitationInput,
    at?: number,
  ): Promise<RoomInvitationPreview> {
    const now = timestamp(at);
    const roomCode = input.roomCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) throw new Error("房間代碼格式錯誤");
    if (input.inviterId === input.recipientId)
      throw new ProductStoreConflictError("不能邀請自己加入房間");
    if (!isGameId(input.game)) throw new Error("棋種格式錯誤");
    return this.transaction(async (client) => {
      await this.assertRoomInvitationAllowed(
        client,
        input.inviterId,
        input.recipientId,
      );
      await client.query(
        `
          UPDATE qiju_room_invites
          SET status = 'cancelled', responded_at = $3,
              entry_token_hash = NULL, entry_token_expires_at = NULL
          WHERE room_code = $1 AND recipient_id = $2
            AND status IN ('pending', 'accepted') AND expires_at <= $3
        `,
        [roomCode, input.recipientId, new Date(now)],
      );
      const existing = await client.query<RoomInvitationRow>(
        `
          SELECT i.id, i.room_code, i.game, i.inviter_id,
                 inviter.display_name AS inviter_name, i.recipient_id,
                 i.status, i.created_at, i.expires_at,
                 i.entry_token_hash, i.entry_token_expires_at
          FROM qiju_room_invites i
          JOIN qiju_users inviter ON inviter.id = i.inviter_id
          WHERE i.room_code = $1 AND i.recipient_id = $2
            AND i.status IN ('pending', 'accepted') AND i.expires_at > $3
          ORDER BY i.created_at DESC
          LIMIT 1
          FOR UPDATE OF i
        `,
        [roomCode, input.recipientId, new Date(now)],
      );
      const existingRow = existing.rows[0];
      if (existingRow) return parseRoomInvitationPreview(existingRow);

      const count = await client.query<{ readonly total: number | string }>(
        `
          SELECT count(*) AS total
          FROM qiju_room_invites
          WHERE inviter_id = $1
            AND status IN ('pending', 'accepted')
            AND expires_at > $2
        `,
        [input.inviterId, new Date(now)],
      );
      if (Number(count.rows[0]?.total ?? 0) >= ROOM_INVITATION_PENDING_LIMIT)
        throw new ProductStoreConflictError("待處理的房間邀請已達上限");

      const createdAt = new Date(now);
      const expiresAt = new Date(now + ROOM_INVITATION_TTL_MS);
      const result = await client.query<RoomInvitationRow>(
        `
          INSERT INTO qiju_room_invites (
            id, room_code, game, inviter_id, recipient_id, status,
            created_at, expires_at, responded_at,
            entry_token_hash, entry_token_expires_at
          )
          VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, NULL, NULL, NULL)
          RETURNING id, room_code, game, inviter_id, ''::text AS inviter_name,
                    recipient_id, status, created_at, expires_at,
                    entry_token_hash, entry_token_expires_at
        `,
        [
          randomUUID(),
          roomCode,
          input.game,
          input.inviterId,
          input.recipientId,
          createdAt,
          expiresAt,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("建立房間邀請失敗");
      const inviter = await client.query<{ readonly display_name: string }>(
        `SELECT display_name FROM qiju_users WHERE id = $1`,
        [input.inviterId],
      );
      const inviterName = inviter.rows[0]?.display_name;
      if (!inviterName) throw new ProductStoreNotFoundError("找不到房間邀請者");
      return {
        ...parseRoomInvitationPreview(row),
        inviterName,
      };
    });
  }

  async listRoomInvitations(
    recipientId: string,
    at?: number,
  ): Promise<readonly RoomInvitationPreview[]> {
    const user = await this.getUser(recipientId);
    if (!user)
      throw new ProductStoreNotFoundError(`找不到使用者：${recipientId}`);
    const result = await this.pool.query<RoomInvitationRow>(
      `
        SELECT i.id, i.room_code, i.game, i.inviter_id,
               u.display_name AS inviter_name, i.recipient_id, i.status,
               i.created_at, i.expires_at, i.entry_token_hash,
               i.entry_token_expires_at
        FROM qiju_room_invites i
        JOIN qiju_users u ON u.id = i.inviter_id
        WHERE i.recipient_id = $1
          AND i.status IN ('pending', 'accepted')
          AND i.expires_at > $2
        ORDER BY i.created_at DESC, i.id DESC
      `,
      [recipientId, new Date(timestamp(at))],
    );
    return result.rows.map(parseRoomInvitationPreview);
  }

  async acceptRoomInvitation(
    recipientId: string,
    invitationId: string,
    at?: number,
  ): Promise<AcceptedRoomInvitation> {
    const now = timestamp(at);
    return this.transaction(async (client) => {
      const inviterResult = await client.query<{
        readonly inviter_id: string;
      }>(
        `
          SELECT inviter_id
          FROM qiju_room_invites
          WHERE id = $1 AND recipient_id = $2
        `,
        [invitationId, recipientId],
      );
      const inviterId = inviterResult.rows[0]?.inviter_id;
      if (!inviterId) throw new ProductStoreNotFoundError("找不到房間邀請");
      // Lock the social pair before the invite row, matching create/block order.
      await this.assertRoomInvitationAllowed(client, inviterId, recipientId);
      const result = await client.query<RoomInvitationRow>(
        `
          SELECT i.id, i.room_code, i.game, i.inviter_id,
                 u.display_name AS inviter_name, i.recipient_id, i.status,
                 i.created_at, i.expires_at, i.entry_token_hash,
                 i.entry_token_expires_at
          FROM qiju_room_invites i
          JOIN qiju_users u ON u.id = i.inviter_id
          WHERE i.id = $1 AND i.recipient_id = $2
          FOR UPDATE OF i
        `,
        [invitationId, recipientId],
      );
      const row = result.rows[0];
      if (!row) throw new ProductStoreNotFoundError("找不到房間邀請");
      if (
        (row.status !== "pending" && row.status !== "accepted") ||
        requiredMillis(row.expires_at) <= now
      )
        throw new ProductStoreConflictError("房間邀請已過期或已處理");
      await this.assertRoomInvitationAllowed(
        client,
        row.inviter_id,
        recipientId,
      );
      const entryToken = createOpaqueToken();
      const entryTokenExpiresAt = Math.min(
        requiredMillis(row.expires_at),
        now + ROOM_ENTRY_TOKEN_TTL_MS,
      );
      const updated = await client.query(
        `
          UPDATE qiju_room_invites
          SET status = 'accepted', responded_at = $3,
              entry_token_hash = $4, entry_token_expires_at = $5
          WHERE id = $1 AND recipient_id = $2
        `,
        [
          invitationId,
          recipientId,
          new Date(now),
          hashSessionToken(entryToken),
          new Date(entryTokenExpiresAt),
        ],
      );
      if (updated.rowCount !== 1) throw new Error("接受房間邀請失敗");
      return {
        ...parseRoomInvitationPreview({ ...row, status: "accepted" }),
        entryToken,
      };
    });
  }

  async rejectRoomInvitation(
    recipientId: string,
    invitationId: string,
    at?: number,
  ): Promise<void> {
    const now = timestamp(at);
    await this.transaction(async (client) => {
      const result = await client.query<{ readonly status: string }>(
        `
          SELECT status FROM qiju_room_invites
          WHERE id = $1 AND recipient_id = $2
          FOR UPDATE
        `,
        [invitationId, recipientId],
      );
      const invite = result.rows[0];
      if (!invite) throw new ProductStoreNotFoundError("找不到房間邀請");
      if (invite.status !== "pending" && invite.status !== "accepted")
        throw new ProductStoreConflictError("房間邀請已處理");
      await client.query(
        `
          UPDATE qiju_room_invites
          SET status = 'rejected', responded_at = $3,
              entry_token_hash = NULL, entry_token_expires_at = NULL
          WHERE id = $1 AND recipient_id = $2
        `,
        [invitationId, recipientId, new Date(now)],
      );
    });
  }

  async consumeRoomInvitation(
    recipientId: string,
    invitationId: string,
    roomCode: string,
    entryToken: string,
    at?: number,
  ): Promise<void> {
    const now = timestamp(at);
    await this.transaction(async (client) => {
      const inviterResult = await client.query<{
        readonly inviter_id: string;
      }>(
        `
          SELECT inviter_id
          FROM qiju_room_invites
          WHERE id = $1 AND recipient_id = $2
        `,
        [invitationId, recipientId],
      );
      const inviterId = inviterResult.rows[0]?.inviter_id;
      if (!inviterId)
        throw new ProductStoreConflictError("房間邀請已失效，請重新接受邀請");
      // Lock the social pair before the invite row to prevent block/unfriend deadlocks.
      await this.assertRoomInvitationAllowed(client, inviterId, recipientId);
      const result = await client.query<RoomInvitationRow>(
        `
          SELECT i.id, i.room_code, i.game, i.inviter_id,
                 u.display_name AS inviter_name, i.recipient_id, i.status,
                 i.created_at, i.expires_at, i.entry_token_hash,
                 i.entry_token_expires_at
          FROM qiju_room_invites i
          JOIN qiju_users u ON u.id = i.inviter_id
          WHERE i.id = $1 AND i.recipient_id = $2
          FOR UPDATE OF i
        `,
        [invitationId, recipientId],
      );
      const invite = result.rows[0];
      if (
        !invite ||
        invite.room_code !== roomCode.toUpperCase() ||
        (invite.status !== "accepted" && invite.status !== "joined") ||
        requiredMillis(invite.expires_at) <= now ||
        !invite.entry_token_hash ||
        !invite.entry_token_expires_at ||
        requiredMillis(invite.entry_token_expires_at) <= now ||
        !matchesSessionToken(entryToken, invite.entry_token_hash)
      )
        throw new ProductStoreConflictError("房間邀請已失效，請重新接受邀請");
      await this.assertRoomInvitationAllowed(
        client,
        invite.inviter_id,
        recipientId,
      );
      const updated = await client.query(
        `
          UPDATE qiju_room_invites
          SET status = 'joined', responded_at = $3
          WHERE id = $1 AND recipient_id = $2
            AND status IN ('accepted', 'joined')
        `,
        [invitationId, recipientId, new Date(now)],
      );
      if (updated.rowCount !== 1)
        throw new ProductStoreConflictError("房間邀請已失效，請重新接受邀請");
    });
  }

  async sendFriendRequest(
    requesterId: string,
    friendCode: string,
    at?: number,
  ): Promise<FriendRequestRecord> {
    let normalizedCode = friendCode.trim().toLowerCase();
    try {
      normalizedCode = normalizePublicCode(friendCode);
    } catch {
      // Existing UUID codes remain usable while players transition to QJ codes.
    }
    const recipientResult = await this.pool.query<{ readonly id: string }>(
      `
        SELECT id
        FROM qiju_users
        WHERE public_code = $1 OR id::text = $2
        LIMIT 1
      `,
      [normalizedCode, normalizedCode],
    );
    const recipientId = recipientResult.rows[0]?.id;
    if (!recipientId) throw new ProductStoreNotFoundError("找不到這個玩家代碼");
    if (requesterId === recipientId)
      throw new ProductStoreConflictError("不能邀請自己成為好友");
    const createdAt = timestamp(at);
    return this.transaction(async (client) => {
      await this.lockSocialUsers(client, [requesterId, recipientId]);
      const preference = await client.query<{ readonly allowed: boolean }>(
        `
          SELECT COALESCE(p.friend_invites, TRUE) AS allowed
          FROM qiju_users u
          LEFT JOIN qiju_user_preferences p ON p.user_id = u.id
          WHERE u.id = $1
        `,
        [recipientId],
      );
      if (preference.rows[0]?.allowed === false)
        throw new ProductStoreConflictError("對方目前不接受好友邀請");
      if (await this.areSocialUsersBlocked(client, requesterId, recipientId))
        throw new ProductStoreConflictError("無法向這位玩家傳送好友邀請");
      const friendship = await client.query(
        `
          SELECT 1 FROM qiju_friendships
          WHERE user_low = LEAST($1::uuid, $2::uuid)
            AND user_high = GREATEST($1::uuid, $2::uuid)
        `,
        [requesterId, recipientId],
      );
      if (friendship.rowCount)
        throw new ProductStoreConflictError("你們已經是好友");
      const pending = await client.query(
        `
          SELECT 1 FROM qiju_friend_requests
          WHERE status = 'pending'
            AND LEAST(requester_id, recipient_id) = LEAST($1::uuid, $2::uuid)
            AND GREATEST(requester_id, recipient_id) = GREATEST($1::uuid, $2::uuid)
        `,
        [requesterId, recipientId],
      );
      if (pending.rowCount)
        throw new ProductStoreConflictError("你們已有待處理的好友邀請");
      const pendingCount = await client.query<{
        readonly total: number | string;
      }>(
        `
          SELECT COUNT(*) AS total
          FROM qiju_friend_requests
          WHERE requester_id = $1 AND status = 'pending'
        `,
        [requesterId],
      );
      if (
        Number(pendingCount.rows[0]?.total ?? 0) >= FRIEND_REQUEST_PENDING_LIMIT
      )
        throw new ProductStoreConflictError("待處理的好友邀請已達上限");
      const latestRequest = await client.query<{
        readonly status: string;
        readonly responded_at: Date | null;
      }>(
        `
          SELECT status, responded_at
          FROM qiju_friend_requests
          WHERE LEAST(requester_id, recipient_id) = LEAST($1::uuid, $2::uuid)
            AND GREATEST(requester_id, recipient_id) = GREATEST($1::uuid, $2::uuid)
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `,
        [requesterId, recipientId],
      );
      const latest = latestRequest.rows[0];
      if (
        latest?.status === "rejected" &&
        latest.responded_at !== null &&
        createdAt - requiredMillis(latest.responded_at) <
          FRIEND_REQUEST_REJECTION_COOLDOWN_MS
      )
        throw new ProductStoreConflictError("對方拒絕過邀請，請稍後再傳送");
      const result = await client.query<FriendRequestRow>(
        `
          INSERT INTO qiju_friend_requests (
            id, requester_id, recipient_id, status, created_at, responded_at
          )
          VALUES ($1, $2, $3, 'pending', $4, NULL)
          RETURNING id, requester_id, recipient_id, status, created_at, responded_at
        `,
        [randomUUID(), requesterId, recipientId, new Date(createdAt)],
      );
      const row = result.rows[0];
      if (!row) throw new Error("建立好友邀請失敗");
      return parseFriendRequest(row);
    });
  }

  async respondToFriendRequest(
    recipientId: string,
    requestId: string,
    action: "accept" | "reject",
    at?: number,
  ): Promise<FriendRequestRecord> {
    return this.transaction(async (client) => {
      const current = await client.query<FriendRequestRow>(
        `
          SELECT id, requester_id, recipient_id, status, created_at, responded_at
          FROM qiju_friend_requests
          WHERE id = $1 AND recipient_id = $2
        `,
        [requestId, recipientId],
      );
      const request = current.rows[0];
      if (!request || request.status !== "pending")
        throw new ProductStoreNotFoundError("找不到待處理的好友邀請");
      await this.lockSocialUsers(client, [recipientId, request.requester_id]);
      if (
        action === "accept" &&
        (await this.areSocialUsersBlocked(
          client,
          recipientId,
          request.requester_id,
        ))
      )
        throw new ProductStoreConflictError("解除封鎖後才能接受好友邀請");
      const respondedAt = timestamp(at);
      const updated = await client.query<FriendRequestRow>(
        `
          UPDATE qiju_friend_requests
          SET status = $3, responded_at = $4
          WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
          RETURNING id, requester_id, recipient_id, status, created_at, responded_at
        `,
        [
          requestId,
          recipientId,
          action === "accept" ? "accepted" : "rejected",
          new Date(respondedAt),
        ],
      );
      const row = updated.rows[0];
      if (!row) throw new ProductStoreConflictError("好友邀請已經處理");
      if (action === "accept")
        await client.query(
          `
            INSERT INTO qiju_friendships (user_low, user_high, created_at)
            VALUES (
              LEAST($1::uuid, $2::uuid),
              GREATEST($1::uuid, $2::uuid),
              $3
            )
            ON CONFLICT (user_low, user_high) DO NOTHING
          `,
          [request.requester_id, recipientId, new Date(respondedAt)],
        );
      return parseFriendRequest(row);
    });
  }

  async cancelFriendRequest(
    requesterId: string,
    requestId: string,
  ): Promise<void> {
    await this.transaction(async (client) => {
      const current = await client.query<FriendRequestRow>(
        `
          SELECT id, requester_id, recipient_id, status, created_at, responded_at
          FROM qiju_friend_requests
          WHERE id = $1 AND requester_id = $2
        `,
        [requestId, requesterId],
      );
      const request = current.rows[0];
      if (!request || request.status !== "pending")
        throw new ProductStoreNotFoundError("找不到待處理的好友邀請");
      await this.lockSocialUsers(client, [requesterId, request.recipient_id]);
      const result = await client.query(
        `
          UPDATE qiju_friend_requests
          SET status = 'cancelled', responded_at = NOW()
          WHERE id = $1 AND requester_id = $2 AND status = 'pending'
        `,
        [requestId, requesterId],
      );
      if (result.rowCount !== 1)
        throw new ProductStoreConflictError("好友邀請已經處理");
    });
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    if (userId === friendId)
      throw new ProductStoreConflictError("無法移除自己");
    await this.transaction(async (client) => {
      await this.lockSocialUsers(client, [userId, friendId]);
      const result = await client.query(
        `
          DELETE FROM qiju_friendships
          WHERE user_low = LEAST($1::uuid, $2::uuid)
            AND user_high = GREATEST($1::uuid, $2::uuid)
        `,
        [userId, friendId],
      );
      if (result.rowCount !== 1)
        throw new ProductStoreNotFoundError("找不到好友關係");
      await this.cancelRoomInvitationsBetween(
        client,
        userId,
        friendId,
        Date.now(),
      );
    });
  }

  async blockUser(
    userId: string,
    blockedUserId: string,
    at?: number,
  ): Promise<void> {
    if (userId === blockedUserId)
      throw new ProductStoreConflictError("不能封鎖自己");
    await this.transaction(async (client) => {
      await this.lockSocialUsers(client, [userId, blockedUserId]);
      const now = timestamp(at);
      await client.query(
        `
          INSERT INTO qiju_user_blocks (blocker_id, blocked_user_id, created_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (blocker_id, blocked_user_id) DO NOTHING
        `,
        [userId, blockedUserId, new Date(now)],
      );
      await client.query(
        `
          DELETE FROM qiju_friendships
          WHERE user_low = LEAST($1::uuid, $2::uuid)
            AND user_high = GREATEST($1::uuid, $2::uuid)
        `,
        [userId, blockedUserId],
      );
      await client.query(
        `
          UPDATE qiju_friend_requests
          SET status = 'cancelled', responded_at = $3
          WHERE status = 'pending'
            AND LEAST(requester_id, recipient_id) = LEAST($1::uuid, $2::uuid)
            AND GREATEST(requester_id, recipient_id) = GREATEST($1::uuid, $2::uuid)
        `,
        [userId, blockedUserId, new Date(now)],
      );
      await this.cancelRoomInvitationsBetween(
        client,
        userId,
        blockedUserId,
        now,
      );
    });
  }

  async unblockUser(userId: string, blockedUserId: string): Promise<void> {
    if (userId === blockedUserId)
      throw new ProductStoreConflictError("不能解除對自己的封鎖");
    await this.transaction(async (client) => {
      await this.lockSocialUsers(client, [userId, blockedUserId]);
      await client.query(
        `DELETE FROM qiju_user_blocks WHERE blocker_id = $1 AND blocked_user_id = $2`,
        [userId, blockedUserId],
      );
    });
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

  async getLeaderboard(
    game: GameId,
    limit = 50,
  ): Promise<readonly LeaderboardEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("排行榜筆數必須介於 1 到 100");
    const result = await this.pool.query<LeaderboardRow>(
      `
        SELECT rank() OVER (ORDER BY r.rating DESC)::int AS rank,
               u.public_code, u.display_name, r.rating, r.games_played,
               r.wins, r.losses, r.draws, r.provisional
        FROM qiju_ratings r
        JOIN qiju_users u ON u.id = r.user_id AND u.status = 'active'
        JOIN qiju_user_preferences p
          ON p.user_id = u.id AND p.show_in_leaderboard = TRUE
        WHERE r.game = $1 AND r.games_played > 0
        ORDER BY r.rating DESC, u.public_code ASC
        LIMIT $2
      `,
      [game, limit],
    );
    return result.rows.map((row) => ({
      rank: Number(row.rank),
      publicCode: row.public_code,
      displayName: row.display_name,
      rating: row.rating,
      gamesPlayed: row.games_played,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      provisional: row.provisional,
    }));
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

  private async lockSocialUsers(
    client: PoolClient,
    userIds: readonly [string, string],
  ): Promise<void> {
    const result = await client.query<SocialUserStatusRow>(
      `
        SELECT id, status
        FROM qiju_users
        WHERE id = ANY($1::uuid[])
        ORDER BY id
        FOR UPDATE
      `,
      [userIds],
    );
    if (result.rows.length !== 2)
      throw new ProductStoreNotFoundError("找不到好友邀請對象");
    if (result.rows.some((row) => row.status !== "active"))
      throw new ProductStoreConflictError("此玩家目前無法使用好友功能");
  }

  private async areSocialUsersBlocked(
    client: PoolClient,
    firstUserId: string,
    secondUserId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `
        SELECT 1
        FROM qiju_user_blocks
        WHERE (blocker_id = $1 AND blocked_user_id = $2)
           OR (blocker_id = $2 AND blocked_user_id = $1)
        LIMIT 1
      `,
      [firstUserId, secondUserId],
    );
    return result.rowCount === 1;
  }

  private async assertRoomInvitationAllowed(
    client: PoolClient,
    inviterId: string,
    recipientId: string,
  ): Promise<void> {
    await this.lockSocialUsers(client, [inviterId, recipientId]);
    if (await this.areSocialUsersBlocked(client, inviterId, recipientId))
      throw new ProductStoreConflictError("目前無法邀請這位玩家");
    const friendship = await client.query(
      `
        SELECT 1 FROM qiju_friendships
        WHERE user_low = LEAST($1::uuid, $2::uuid)
          AND user_high = GREATEST($1::uuid, $2::uuid)
      `,
      [inviterId, recipientId],
    );
    if (friendship.rowCount !== 1)
      throw new ProductStoreConflictError("房間邀請只提供給好友");
    const preference = await client.query<{ readonly allowed: boolean }>(
      `
        SELECT COALESCE(p.friend_invites, TRUE) AS allowed
        FROM qiju_users u
        LEFT JOIN qiju_user_preferences p ON p.user_id = u.id
        WHERE u.id = $1
      `,
      [recipientId],
    );
    if (preference.rows[0]?.allowed === false)
      throw new ProductStoreConflictError("對方目前不接受好友邀請");
  }

  private async cancelRoomInvitationsBetween(
    client: PoolClient,
    firstUserId: string,
    secondUserId: string,
    at: number,
  ): Promise<void> {
    await client.query(
      `
        UPDATE qiju_room_invites
        SET status = 'cancelled', responded_at = $3,
            entry_token_hash = NULL, entry_token_expires_at = NULL
        WHERE status IN ('pending', 'accepted')
          AND (
            (inviter_id = $1 AND recipient_id = $2)
            OR (inviter_id = $2 AND recipient_id = $1)
          )
      `,
      [firstUserId, secondUserId, new Date(at)],
    );
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
