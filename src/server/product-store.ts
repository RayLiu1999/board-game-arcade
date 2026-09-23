import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { GameId } from "../shared/protocol.js";
import {
  createOpaqueToken,
  createPublicCode,
  hashSessionToken,
  matchesSessionToken,
  normalizeAccountName,
  normalizePublicCode,
} from "./product-security.js";
import {
  calculateElo,
  INITIAL_RATING,
  RATING_VERSION,
  type RatingResult,
} from "./rating.js";

export const PRODUCT_SCHEMA_VERSION = 1;
export const MATCH_EVENT_SCHEMA_VERSION = 1;
export const FRIEND_REQUEST_PENDING_LIMIT = 50;
export const FRIEND_REQUEST_REJECTION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const ROOM_INVITATION_TTL_MS = 10 * 60 * 1000;
export const ROOM_ENTRY_TOKEN_TTL_MS = 3 * 60 * 1000;
export const ROOM_INVITATION_PENDING_LIMIT = 20;

export type UserStatus = "active" | "suspended" | "deactivated";
export type MatchMode = "ai" | "local" | "friend" | "public" | "rated";
export type MatchStatus = "active" | "completed" | "cancelled" | "aborted";
export type ParticipantResult = "win" | "loss" | "draw" | "unknown";

export interface UserRecord {
  readonly id: string;
  readonly publicCode: string;
  readonly loginName: string | null;
  readonly displayName: string;
  readonly status: UserStatus;
  readonly createdAt: number;
  readonly lastActiveAt: number;
}

export interface FriendConnection {
  readonly userId: string;
  readonly displayName: string;
  readonly since: number;
  readonly online: boolean | null;
}

export interface FriendRequestPreview {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string;
  readonly createdAt: number;
}

export interface BlockedUserPreview {
  readonly userId: string;
  readonly displayName: string;
  readonly blockedAt: number;
}

export interface SocialOverview {
  /** Shareable player code; it is not a login or room-reconnection credential. */
  readonly friendCode: string;
  readonly friends: readonly FriendConnection[];
  readonly incomingRequests: readonly FriendRequestPreview[];
  readonly outgoingRequests: readonly FriendRequestPreview[];
  readonly blockedUsers: readonly BlockedUserPreview[];
}

export interface FriendRequestRecord {
  readonly id: string;
  readonly requesterId: string;
  readonly recipientId: string;
  readonly status: "pending" | "accepted" | "rejected" | "cancelled";
  readonly createdAt: number;
  readonly respondedAt: number | null;
}

export type UserTheme = "system" | "light" | "dark";

export interface UserPreferences {
  readonly userId: string;
  readonly locale: string;
  readonly theme: UserTheme;
  readonly soundEnabled: boolean;
  readonly historyPublic: boolean;
  readonly friendInvites: boolean;
  readonly showOnlineStatus: boolean;
  readonly showInLeaderboard: boolean;
  readonly updatedAt: number;
}

export interface UpdateUserProfileInput {
  readonly displayName?: string;
}

export interface UpdateUserPreferencesInput {
  readonly locale?: string;
  readonly theme?: UserTheme;
  readonly soundEnabled?: boolean;
  readonly historyPublic?: boolean;
  readonly friendInvites?: boolean;
  readonly showOnlineStatus?: boolean;
  readonly showInLeaderboard?: boolean;
}

export interface CreateUserInput {
  readonly id?: string;
  readonly publicCode?: string;
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

export type MatchHistoryResult = "win" | "loss" | "draw";

export interface ListMatchHistoryInput {
  readonly userId: string;
  readonly game?: GameId;
  readonly mode?: MatchMode;
  readonly result?: MatchHistoryResult;
  readonly from?: number;
  readonly to?: number;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface MatchHistoryPage {
  readonly matches: readonly MatchRecord[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly hasNext: boolean;
}

export interface UserMatchStatsByGame {
  readonly game: GameId;
  readonly completed: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

export interface UserMatchStats {
  readonly userId: string;
  readonly completed: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly byGame: readonly UserMatchStatsByGame[];
}

export interface RatingRecord {
  readonly userId: string;
  readonly game: GameId;
  readonly rating: number;
  readonly gamesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly provisional: boolean;
  readonly ratingVersion: number;
  readonly updatedAt: number;
}

export interface RatingChange {
  readonly matchId: string;
  readonly userId: string;
  readonly game: GameId;
  readonly seat: number;
  readonly result: RatingResult;
  readonly ratingBefore: number;
  readonly ratingAfter: number;
  readonly ratingDelta: number;
  readonly gamesBefore: number;
  readonly gamesAfter: number;
  readonly kFactor: number;
  readonly provisional: boolean;
  readonly ratingVersion: number;
  readonly createdAt: number;
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

export interface AccountCredentialRecord {
  readonly user: UserRecord;
  readonly passwordHash: string;
}

export interface LeaderboardEntry {
  readonly rank: number;
  readonly publicCode: string;
  readonly displayName: string;
  readonly rating: number;
  readonly gamesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly provisional: boolean;
}

export interface RoomInvitationPreview {
  readonly id: string;
  readonly roomCode: string;
  readonly game: GameId;
  readonly inviterId: string;
  readonly inviterName: string;
  readonly status: "pending" | "accepted";
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface AcceptedRoomInvitation extends RoomInvitationPreview {
  readonly entryToken: string;
}

export interface CreateRoomInvitationInput {
  readonly roomCode: string;
  readonly game: GameId;
  readonly inviterId: string;
  readonly recipientId: string;
}

interface StoredRoomInvitation {
  readonly id: string;
  readonly roomCode: string;
  readonly game: GameId;
  readonly inviterId: string;
  readonly recipientId: string;
  readonly status: "pending" | "accepted" | "rejected" | "joined" | "cancelled";
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly respondedAt: number | null;
  readonly entryTokenHash: string | null;
  readonly entryTokenExpiresAt: number | null;
}

export interface RoomInvitationStore {
  createRoomInvitation(
    input: CreateRoomInvitationInput,
    at?: number,
  ): Promise<RoomInvitationPreview>;
  listRoomInvitations(
    recipientId: string,
    at?: number,
  ): Promise<readonly RoomInvitationPreview[]>;
  acceptRoomInvitation(
    recipientId: string,
    invitationId: string,
    at?: number,
  ): Promise<AcceptedRoomInvitation>;
  rejectRoomInvitation(
    recipientId: string,
    invitationId: string,
    at?: number,
  ): Promise<void>;
  consumeRoomInvitation(
    recipientId: string,
    invitationId: string,
    roomCode: string,
    entryToken: string,
    at?: number,
  ): Promise<void>;
}

export interface UserStore {
  createUser(input: CreateUserInput): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  upgradeAccount(
    userId: string,
    loginName: string,
    passwordHash: string,
    at?: number,
  ): Promise<UserRecord>;
  findAccountByLoginName(
    loginName: string,
  ): Promise<AccountCredentialRecord | null>;
  updateUserProfile(
    id: string,
    input: UpdateUserProfileInput,
    at?: number,
  ): Promise<UserRecord>;
  getUserPreferences(id: string): Promise<UserPreferences>;
  updateUserPreferences(
    id: string,
    input: UpdateUserPreferencesInput,
    at?: number,
  ): Promise<UserPreferences>;
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
  linkMatchParticipant(
    matchId: string,
    seat: number,
    userId: string,
  ): Promise<MatchParticipant>;
  appendMatchEvent(input: AppendMatchEventInput): Promise<MatchEvent>;
  listMatchEvents(matchId: string): Promise<MatchEvent[]>;
  listMatchesForUser(input: ListMatchHistoryInput): Promise<MatchHistoryPage>;
  getUserMatchStats(userId: string): Promise<UserMatchStats>;
  getUserRating(userId: string, game: GameId): Promise<RatingRecord>;
  getUserRatings(userId: string): Promise<readonly RatingRecord[]>;
  getLeaderboard(
    game: GameId,
    limit?: number,
  ): Promise<readonly LeaderboardEntry[]>;
  completeMatch(input: CompleteMatchInput): Promise<MatchRecord>;
  abortMatch(input: AbortMatchInput): Promise<MatchRecord>;
}

export interface AuditStore {
  recordAudit(input: RecordAuditInput): Promise<AuditRecord>;
}

export interface SocialStore {
  getSocialOverview(userId: string): Promise<SocialOverview>;
  sendFriendRequest(
    requesterId: string,
    friendCode: string,
    at?: number,
  ): Promise<FriendRequestRecord>;
  respondToFriendRequest(
    recipientId: string,
    requestId: string,
    action: "accept" | "reject",
    at?: number,
  ): Promise<FriendRequestRecord>;
  cancelFriendRequest(requesterId: string, requestId: string): Promise<void>;
  removeFriend(userId: string, friendId: string): Promise<void>;
  blockUser(userId: string, blockedUserId: string, at?: number): Promise<void>;
  unblockUser(userId: string, blockedUserId: string): Promise<void>;
  areUsersBlocked(firstUserId: string, secondUserId: string): Promise<boolean>;
  getBlockedUserIds(userId: string): Promise<readonly string[]>;
}

export interface PresenceStore {
  touchPresence(
    connectionId: string,
    userId: string,
    touchedAt: number,
    expiresAt: number,
  ): Promise<void>;
  removePresence(connectionId: string): Promise<void>;
}

export interface ProductStore
  extends UserStore,
    SessionStore,
    MatchStore,
    AuditStore,
    SocialStore,
    PresenceStore,
    RoomInvitationStore {
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

export const defaultUserPreferences = (
  userId: string,
  updatedAt = Date.now(),
): UserPreferences => ({
  userId,
  locale: "zh-Hant",
  theme: "system",
  soundEnabled: true,
  historyPublic: false,
  friendInvites: true,
  showOnlineStatus: false,
  showInLeaderboard: false,
  updatedAt,
});

export const defaultUserRating = (
  userId: string,
  game: GameId,
  updatedAt = Date.now(),
): RatingRecord => ({
  userId,
  game,
  rating: INITIAL_RATING,
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  provisional: true,
  ratingVersion: RATING_VERSION,
  updatedAt,
});

const locale = (value: string): string => {
  const normalized = value.trim();
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})?$/.test(normalized))
    throw new Error("語言格式錯誤");
  return normalized;
};

const theme = (value: unknown): UserTheme => {
  if (value === "system" || value === "light" || value === "dark") return value;
  throw new Error("主題格式錯誤");
};

export const mergeUserPreferences = (
  current: UserPreferences,
  input: UpdateUserPreferencesInput,
  at = Date.now(),
): UserPreferences => ({
  ...current,
  ...(input.locale === undefined ? {} : { locale: locale(input.locale) }),
  ...(input.theme === undefined ? {} : { theme: theme(input.theme) }),
  ...(input.soundEnabled === undefined
    ? {}
    : { soundEnabled: input.soundEnabled }),
  ...(input.historyPublic === undefined
    ? {}
    : { historyPublic: input.historyPublic }),
  ...(input.friendInvites === undefined
    ? {}
    : { friendInvites: input.friendInvites }),
  ...(input.showOnlineStatus === undefined
    ? {}
    : { showOnlineStatus: input.showOnlineStatus }),
  ...(input.showInLeaderboard === undefined
    ? {}
    : { showInLeaderboard: input.showInLeaderboard }),
  updatedAt: timestamp(at),
});

const positiveInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label}格式錯誤`);
  return value;
};

const historyPage = (value: number | undefined): number => {
  const result = value ?? 1;
  if (!Number.isSafeInteger(result) || result < 1)
    throw new Error("歷史頁碼格式錯誤");
  return result;
};

const historyPageSize = (value: number | undefined): number => {
  const result = value ?? 20;
  if (!Number.isSafeInteger(result) || result < 1 || result > 50)
    throw new Error("歷史每頁筆數必須介於 1 到 50");
  return result;
};

const historyTime = (
  value: number | undefined,
  label: string,
): number | null => {
  if (value === undefined) return null;
  if (!Number.isFinite(value)) throw new Error(`${label}格式錯誤`);
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

const ratedParticipants = (
  match: MatchRecord,
  outcome: MatchOutcome,
  explicit: CompleteMatchInput["participantResults"],
): Array<{ participant: MatchParticipant; result: RatingResult }> => {
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
    const userId = participant.userId;
    if (participant.bot || userId === null)
      throw new ProductStoreConflictError("rated 對局需要綁定真人身份");
    if (userIds.has(userId))
      throw new ProductStoreConflictError("rated 對局不能由同一玩家佔用兩席");
    userIds.add(userId);
    const result = resultForSeat(outcome, participant.seat);
    if (result === "unknown") throw new Error("rated 對局結果格式錯誤");
    const requested = explicit?.find(
      (entry) => entry.seat === participant.seat,
    );
    if (requested && requested.result !== result)
      throw new ProductStoreConflictError("rated 對局結果不可由呼叫端修改");
    return { participant, result };
  });
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
  private readonly passwordHashes = new Map<string, string>();
  private readonly preferences = new Map<string, UserPreferences>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly matches = new Map<string, MatchRecord>();
  private readonly ratings = new Map<string, RatingRecord>();
  private readonly events = new Map<string, Map<number, MatchEvent>>();
  private readonly audits: AuditRecord[] = [];
  private readonly friendRequests = new Map<string, FriendRequestRecord>();
  private readonly friendships = new Map<
    string,
    {
      readonly userLow: string;
      readonly userHigh: string;
      readonly since: number;
    }
  >();
  private readonly blocks = new Map<
    string,
    {
      readonly userId: string;
      readonly blockedUserId: string;
      readonly at: number;
    }
  >();
  private readonly presence = new Map<
    string,
    { readonly userId: string; readonly expiresAt: number }
  >();
  private readonly roomInvitations = new Map<string, StoredRoomInvitation>();

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
      let publicCode = normalizePublicCode(
        input.publicCode ?? createPublicCode(),
      );
      if (input.publicCode !== undefined) {
        if (
          [...this.users.values()].some(
            (user) => user.publicCode === publicCode,
          )
        )
          throw new ProductStoreConflictError("玩家代碼已存在");
      } else {
        for (let attempt = 0; attempt < 5; attempt++) {
          if (
            ![...this.users.values()].some(
              (user) => user.publicCode === publicCode,
            )
          )
            break;
          publicCode = createPublicCode();
        }
        if (
          [...this.users.values()].some(
            (user) => user.publicCode === publicCode,
          )
        )
          throw new ProductStoreConflictError("無法產生唯一玩家代碼，請重試");
      }
      const user: UserRecord = {
        id,
        publicCode,
        loginName: null,
        displayName: displayName(input.displayName),
        status: "active",
        createdAt,
        lastActiveAt: createdAt,
      };
      this.users.set(id, clone(user));
      this.preferences.set(id, defaultUserPreferences(id, createdAt));
      return clone(user);
    });
  }

  getUser(id: string): Promise<UserRecord | null> {
    return Promise.resolve(clone(this.users.get(id) ?? null));
  }

  upgradeAccount(
    userId: string,
    loginName: string,
    passwordHash: string,
    at?: number,
  ): Promise<UserRecord> {
    return Promise.resolve().then(() => {
      const user = this.users.get(userId);
      if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${userId}`);
      if (user.status !== "active")
        throw new ProductStoreConflictError("此玩家目前無法升級帳號");
      if (user.loginName)
        throw new ProductStoreConflictError("此玩家身份已綁定登入帳號");
      const normalizedLogin = normalizeAccountName(loginName);
      if (
        [...this.users.values()].some(
          (entry) => entry.loginName === normalizedLogin,
        )
      )
        throw new ProductStoreConflictError("帳號名稱已被使用");
      if (!passwordHash.startsWith("scrypt$"))
        throw new Error("密碼驗證值格式錯誤");
      const updated: UserRecord = {
        ...user,
        loginName: normalizedLogin,
        lastActiveAt: timestamp(at),
      };
      this.users.set(userId, updated);
      this.passwordHashes.set(userId, passwordHash);
      return clone(updated);
    });
  }

  findAccountByLoginName(
    loginName: string,
  ): Promise<AccountCredentialRecord | null> {
    return Promise.resolve().then(() => {
      const normalizedLogin = normalizeAccountName(loginName);
      const user = [...this.users.values()].find(
        (entry) => entry.loginName === normalizedLogin,
      );
      if (!user) return null;
      const passwordHash = this.passwordHashes.get(user.id);
      if (!passwordHash) throw new Error("帳號缺少密碼驗證值");
      return { user: clone(user), passwordHash };
    });
  }

  updateUserProfile(
    id: string,
    input: UpdateUserProfileInput,
    at?: number,
  ): Promise<UserRecord> {
    return Promise.resolve().then(() => {
      const user = this.users.get(id);
      if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${id}`);
      const updated = {
        ...user,
        ...(input.displayName === undefined
          ? {}
          : { displayName: displayName(input.displayName) }),
        lastActiveAt: timestamp(at),
      };
      this.users.set(id, updated);
      return clone(updated);
    });
  }

  getUserPreferences(id: string): Promise<UserPreferences> {
    return Promise.resolve().then(() => {
      const user = this.users.get(id);
      if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${id}`);
      const current =
        this.preferences.get(id) ?? defaultUserPreferences(id, user.createdAt);
      this.preferences.set(id, clone(current));
      return clone(current);
    });
  }

  updateUserPreferences(
    id: string,
    input: UpdateUserPreferencesInput,
    at?: number,
  ): Promise<UserPreferences> {
    return Promise.resolve().then(() => {
      const user = this.users.get(id);
      if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${id}`);
      const current =
        this.preferences.get(id) ?? defaultUserPreferences(id, user.createdAt);
      const updated = mergeUserPreferences(current, input, at);
      this.preferences.set(id, clone(updated));
      return clone(updated);
    });
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

  getSocialOverview(userId: string): Promise<SocialOverview> {
    return Promise.resolve().then(() => {
      const user = this.users.get(userId);
      if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${userId}`);
      const friends: FriendConnection[] = [];
      for (const friendship of this.friendships.values()) {
        const friendId =
          friendship.userLow === userId
            ? friendship.userHigh
            : friendship.userHigh === userId
              ? friendship.userLow
              : null;
        if (!friendId) continue;
        const friend = this.users.get(friendId);
        if (friend)
          friends.push({
            userId: friend.id,
            displayName: friend.displayName,
            since: friendship.since,
            online:
              this.preferences.get(friend.id)?.showOnlineStatus === true
                ? this.isOnline(friend.id, Date.now())
                : null,
          });
      }
      const incomingRequests: FriendRequestPreview[] = [];
      const outgoingRequests: FriendRequestPreview[] = [];
      for (const request of this.friendRequests.values()) {
        if (request.status !== "pending") continue;
        if (request.recipientId === userId) {
          const requester = this.users.get(request.requesterId);
          if (requester)
            incomingRequests.push({
              id: request.id,
              userId: requester.id,
              displayName: requester.displayName,
              createdAt: request.createdAt,
            });
        } else if (request.requesterId === userId) {
          const recipient = this.users.get(request.recipientId);
          if (recipient)
            outgoingRequests.push({
              id: request.id,
              userId: recipient.id,
              displayName: recipient.displayName,
              createdAt: request.createdAt,
            });
        }
      }
      const blockedUsers: BlockedUserPreview[] = [];
      for (const block of this.blocks.values()) {
        if (block.userId !== userId) continue;
        const blocked = this.users.get(block.blockedUserId);
        if (blocked)
          blockedUsers.push({
            userId: blocked.id,
            displayName: blocked.displayName,
            blockedAt: block.at,
          });
      }
      const byName = (
        left: { displayName: string },
        right: { displayName: string },
      ) => left.displayName.localeCompare(right.displayName, "zh-Hant");
      return {
        friendCode: user.publicCode,
        friends: friends.sort(byName),
        incomingRequests: incomingRequests.sort(
          (left, right) => left.createdAt - right.createdAt,
        ),
        outgoingRequests: outgoingRequests.sort(
          (left, right) => left.createdAt - right.createdAt,
        ),
        blockedUsers: blockedUsers.sort(byName),
      };
    });
  }

  areUsersBlocked(firstUserId: string, secondUserId: string): Promise<boolean> {
    return Promise.resolve(this.isBlocked(firstUserId, secondUserId));
  }

  getBlockedUserIds(userId: string): Promise<readonly string[]> {
    return Promise.resolve(
      [...this.blocks.values()]
        .filter(
          (block) => block.userId === userId || block.blockedUserId === userId,
        )
        .map((block) =>
          block.userId === userId ? block.blockedUserId : block.userId,
        )
        .sort(),
    );
  }

  sendFriendRequest(
    requesterId: string,
    friendCode: string,
    at?: number,
  ): Promise<FriendRequestRecord> {
    return Promise.resolve().then(() => {
      const requester = this.activeSocialUser(requesterId);
      let lookupCode = friendCode.trim().toLowerCase();
      try {
        lookupCode = normalizePublicCode(friendCode);
      } catch {
        // Existing UUID codes remain usable while players transition to QJ codes.
      }
      const recipient = [...this.users.values()].find(
        (user) => user.publicCode === lookupCode || user.id === lookupCode,
      );
      if (!recipient) throw new ProductStoreNotFoundError("找不到這個玩家代碼");
      const recipientId = recipient.id;
      this.activeSocialUser(recipientId);
      const createdAt = timestamp(at);
      if (requesterId === recipientId)
        throw new ProductStoreConflictError("不能邀請自己成為好友");
      if (
        !this.preferences.get(recipientId)?.friendInvites &&
        this.preferences.has(recipientId)
      )
        throw new ProductStoreConflictError("對方目前不接受好友邀請");
      const pair = this.friendshipKey(requesterId, recipientId);
      if (this.isBlocked(requesterId, recipientId))
        throw new ProductStoreConflictError("無法向這位玩家傳送好友邀請");
      if (this.friendships.has(pair))
        throw new ProductStoreConflictError("你們已經是好友");
      if (
        [...this.friendRequests.values()].some(
          (request) =>
            request.status === "pending" &&
            this.friendshipKey(request.requesterId, request.recipientId) ===
              pair,
        )
      )
        throw new ProductStoreConflictError("你們已有待處理的好友邀請");
      const pendingCount = [...this.friendRequests.values()].filter(
        (request) =>
          request.requesterId === requesterId && request.status === "pending",
      ).length;
      if (pendingCount >= FRIEND_REQUEST_PENDING_LIMIT)
        throw new ProductStoreConflictError("待處理的好友邀請已達上限");
      const latestRequest = [...this.friendRequests.values()]
        .filter(
          (request) =>
            this.friendshipKey(request.requesterId, request.recipientId) ===
            pair,
        )
        .sort((left, right) => right.createdAt - left.createdAt)[0];
      if (
        latestRequest?.status === "rejected" &&
        latestRequest.respondedAt !== null &&
        createdAt - latestRequest.respondedAt <
          FRIEND_REQUEST_REJECTION_COOLDOWN_MS
      )
        throw new ProductStoreConflictError("對方拒絕過邀請，請稍後再傳送");
      const request: FriendRequestRecord = {
        id: randomUUID(),
        requesterId: requester.id,
        recipientId: recipient.id,
        status: "pending",
        createdAt,
        respondedAt: null,
      };
      this.friendRequests.set(request.id, request);
      return clone(request);
    });
  }

  respondToFriendRequest(
    recipientId: string,
    requestId: string,
    action: "accept" | "reject",
    at?: number,
  ): Promise<FriendRequestRecord> {
    return Promise.resolve().then(() => {
      this.activeSocialUser(recipientId);
      const request = this.friendRequests.get(requestId);
      if (!request || request.recipientId !== recipientId)
        throw new ProductStoreNotFoundError("找不到待處理的好友邀請");
      if (request.status !== "pending")
        throw new ProductStoreConflictError("好友邀請已經處理");
      this.activeSocialUser(request.requesterId);
      if (
        action === "accept" &&
        this.isBlocked(recipientId, request.requesterId)
      )
        throw new ProductStoreConflictError("解除封鎖後才能接受好友邀請");
      const now = timestamp(at);
      const updated: FriendRequestRecord = {
        ...request,
        status: action === "accept" ? "accepted" : "rejected",
        respondedAt: now,
      };
      this.friendRequests.set(request.id, updated);
      if (action === "accept") {
        const [userLow, userHigh] = this.sortedUsers(
          request.requesterId,
          request.recipientId,
        );
        this.friendships.set(this.friendshipKey(userLow, userHigh), {
          userLow,
          userHigh,
          since: now,
        });
      }
      return clone(updated);
    });
  }

  cancelFriendRequest(requesterId: string, requestId: string): Promise<void> {
    return Promise.resolve().then(() => {
      const request = this.friendRequests.get(requestId);
      if (!request || request.requesterId !== requesterId)
        throw new ProductStoreNotFoundError("找不到待處理的好友邀請");
      if (request.status !== "pending")
        throw new ProductStoreConflictError("好友邀請已經處理");
      this.friendRequests.set(requestId, {
        ...request,
        status: "cancelled",
        respondedAt: Date.now(),
      });
    });
  }

  removeFriend(userId: string, friendId: string): Promise<void> {
    return Promise.resolve().then(() => {
      this.activeSocialUser(userId);
      this.activeSocialUser(friendId);
      if (userId === friendId)
        throw new ProductStoreConflictError("無法移除自己");
      const removed = this.friendships.delete(
        this.friendshipKey(userId, friendId),
      );
      if (!removed) throw new ProductStoreNotFoundError("找不到好友關係");
      this.cancelRoomInvitationsBetween(userId, friendId, Date.now());
    });
  }

  blockUser(userId: string, blockedUserId: string, at?: number): Promise<void> {
    return Promise.resolve().then(() => {
      this.activeSocialUser(userId);
      this.activeSocialUser(blockedUserId);
      if (userId === blockedUserId)
        throw new ProductStoreConflictError("不能封鎖自己");
      const blockKey = this.blockKey(userId, blockedUserId);
      const now = timestamp(at);
      if (!this.blocks.has(blockKey))
        this.blocks.set(blockKey, { userId, blockedUserId, at: now });
      this.friendships.delete(this.friendshipKey(userId, blockedUserId));
      for (const [id, request] of this.friendRequests) {
        if (
          request.status === "pending" &&
          this.friendshipKey(request.requesterId, request.recipientId) ===
            this.friendshipKey(userId, blockedUserId)
        )
          this.friendRequests.set(id, {
            ...request,
            status: "cancelled",
            respondedAt: now,
          });
      }
      this.cancelRoomInvitationsBetween(userId, blockedUserId, now);
    });
  }

  unblockUser(userId: string, blockedUserId: string): Promise<void> {
    return Promise.resolve().then(() => {
      this.activeSocialUser(userId);
      this.activeSocialUser(blockedUserId);
      this.blocks.delete(this.blockKey(userId, blockedUserId));
    });
  }

  private activeSocialUser(userId: string): UserRecord {
    const user = this.users.get(userId);
    if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${userId}`);
    if (user.status !== "active")
      throw new ProductStoreConflictError("此玩家目前無法使用好友功能");
    return user;
  }

  private sortedUsers(left: string, right: string): [string, string] {
    return left < right ? [left, right] : [right, left];
  }

  private friendshipKey(left: string, right: string): string {
    return this.sortedUsers(left, right).join(":");
  }

  private blockKey(blockerId: string, blockedId: string): string {
    return `${blockerId}:${blockedId}`;
  }

  private isBlocked(left: string, right: string): boolean {
    return (
      this.blocks.has(this.blockKey(left, right)) ||
      this.blocks.has(this.blockKey(right, left))
    );
  }

  private isOnline(userId: string, now: number): boolean {
    for (const entry of this.presence.values())
      if (entry.userId === userId && entry.expiresAt > now) return true;
    return false;
  }

  private cancelRoomInvitationsBetween(
    firstUserId: string,
    secondUserId: string,
    at: number,
  ): void {
    for (const [id, invite] of this.roomInvitations) {
      if (
        (invite.inviterId === firstUserId &&
          invite.recipientId === secondUserId) ||
        (invite.inviterId === secondUserId &&
          invite.recipientId === firstUserId)
      ) {
        if (invite.status === "pending" || invite.status === "accepted")
          this.roomInvitations.set(id, {
            ...invite,
            status: "cancelled",
            respondedAt: at,
            entryTokenHash: null,
            entryTokenExpiresAt: null,
          });
      }
    }
  }

  private roomInvitationPreview(
    invite: StoredRoomInvitation,
  ): RoomInvitationPreview {
    const inviter = this.users.get(invite.inviterId);
    if (!inviter) throw new Error("房間邀請者不存在");
    if (invite.status !== "pending" && invite.status !== "accepted")
      throw new ProductStoreConflictError("房間邀請已失效");
    return {
      id: invite.id,
      roomCode: invite.roomCode,
      game: invite.game,
      inviterId: invite.inviterId,
      inviterName: inviter.displayName,
      status: invite.status,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
    };
  }

  private assertRoomInvitationAllowed(
    inviterId: string,
    recipientId: string,
  ): void {
    this.activeSocialUser(inviterId);
    this.activeSocialUser(recipientId);
    if (this.isBlocked(inviterId, recipientId))
      throw new ProductStoreConflictError("目前無法邀請這位玩家");
    if (!this.friendships.has(this.friendshipKey(inviterId, recipientId)))
      throw new ProductStoreConflictError("房間邀請只提供給好友");
    const preferences = this.preferences.get(recipientId);
    if (preferences && !preferences.friendInvites)
      throw new ProductStoreConflictError("對方目前不接受好友邀請");
  }

  touchPresence(
    connectionId: string,
    userId: string,
    touchedAt: number,
    expiresAt: number,
  ): Promise<void> {
    return Promise.resolve().then(() => {
      if (!this.users.has(userId))
        throw new ProductStoreNotFoundError(`找不到使用者：${userId}`);
      if (
        !Number.isFinite(touchedAt) ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= touchedAt ||
        expiresAt - touchedAt > 120_000
      )
        throw new Error("玩家上線租約時間格式錯誤");
      this.presence.set(connectionId, { userId, expiresAt });
    });
  }

  removePresence(connectionId: string): Promise<void> {
    this.presence.delete(connectionId);
    return Promise.resolve();
  }

  createRoomInvitation(
    input: CreateRoomInvitationInput,
    at?: number,
  ): Promise<RoomInvitationPreview> {
    return Promise.resolve().then(() => {
      const now = timestamp(at);
      const roomCode = input.roomCode.trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(roomCode)) throw new Error("房間代碼格式錯誤");
      if (input.inviterId === input.recipientId)
        throw new ProductStoreConflictError("不能邀請自己加入房間");
      this.assertRoomInvitationAllowed(input.inviterId, input.recipientId);
      for (const [id, invite] of this.roomInvitations) {
        if (
          invite.roomCode === roomCode &&
          invite.recipientId === input.recipientId &&
          (invite.status === "pending" || invite.status === "accepted") &&
          invite.expiresAt <= now
        )
          this.roomInvitations.set(id, {
            ...invite,
            status: "cancelled",
            respondedAt: now,
            entryTokenHash: null,
            entryTokenExpiresAt: null,
          });
      }
      const existing = [...this.roomInvitations.values()].find(
        (invite) =>
          invite.roomCode === roomCode &&
          invite.recipientId === input.recipientId &&
          (invite.status === "pending" || invite.status === "accepted") &&
          invite.expiresAt > now,
      );
      if (existing) return this.roomInvitationPreview(existing);
      const activeCount = [...this.roomInvitations.values()].filter(
        (invite) =>
          invite.inviterId === input.inviterId &&
          (invite.status === "pending" || invite.status === "accepted") &&
          invite.expiresAt > now,
      ).length;
      if (activeCount >= ROOM_INVITATION_PENDING_LIMIT)
        throw new ProductStoreConflictError("待處理的房間邀請已達上限");
      const invite: StoredRoomInvitation = {
        id: randomUUID(),
        roomCode,
        game: input.game,
        inviterId: input.inviterId,
        recipientId: input.recipientId,
        status: "pending",
        createdAt: now,
        expiresAt: now + ROOM_INVITATION_TTL_MS,
        respondedAt: null,
        entryTokenHash: null,
        entryTokenExpiresAt: null,
      };
      this.roomInvitations.set(invite.id, invite);
      return this.roomInvitationPreview(invite);
    });
  }

  listRoomInvitations(
    recipientId: string,
    at?: number,
  ): Promise<readonly RoomInvitationPreview[]> {
    return Promise.resolve().then(() => {
      this.activeSocialUser(recipientId);
      const now = timestamp(at);
      return [...this.roomInvitations.values()]
        .filter(
          (invite) =>
            invite.recipientId === recipientId &&
            invite.expiresAt > now &&
            (invite.status === "pending" || invite.status === "accepted"),
        )
        .sort((left, right) => left.createdAt - right.createdAt)
        .map((invite) => this.roomInvitationPreview(invite));
    });
  }

  acceptRoomInvitation(
    recipientId: string,
    invitationId: string,
    at?: number,
  ): Promise<AcceptedRoomInvitation> {
    return Promise.resolve().then(() => {
      const now = timestamp(at);
      const invite = this.roomInvitations.get(invitationId);
      if (!invite || invite.recipientId !== recipientId)
        throw new ProductStoreNotFoundError("找不到房間邀請");
      if (
        (invite.status !== "pending" && invite.status !== "accepted") ||
        invite.expiresAt <= now
      )
        throw new ProductStoreConflictError("房間邀請已過期或已處理");
      this.assertRoomInvitationAllowed(invite.inviterId, recipientId);
      const entryToken = createOpaqueToken();
      const accepted: StoredRoomInvitation = {
        ...invite,
        status: "accepted",
        respondedAt: now,
        entryTokenHash: hashSessionToken(entryToken),
        entryTokenExpiresAt: Math.min(
          invite.expiresAt,
          now + ROOM_ENTRY_TOKEN_TTL_MS,
        ),
      };
      this.roomInvitations.set(invitationId, accepted);
      return {
        ...this.roomInvitationPreview(accepted),
        entryToken,
      };
    });
  }

  rejectRoomInvitation(
    recipientId: string,
    invitationId: string,
    at?: number,
  ): Promise<void> {
    return Promise.resolve().then(() => {
      this.activeSocialUser(recipientId);
      const invite = this.roomInvitations.get(invitationId);
      if (!invite || invite.recipientId !== recipientId)
        throw new ProductStoreNotFoundError("找不到房間邀請");
      if (invite.status !== "pending" && invite.status !== "accepted")
        throw new ProductStoreConflictError("房間邀請已處理");
      this.roomInvitations.set(invitationId, {
        ...invite,
        status: "rejected",
        respondedAt: timestamp(at),
        entryTokenHash: null,
        entryTokenExpiresAt: null,
      });
    });
  }

  consumeRoomInvitation(
    recipientId: string,
    invitationId: string,
    roomCode: string,
    entryToken: string,
    at?: number,
  ): Promise<void> {
    return Promise.resolve().then(() => {
      const now = timestamp(at);
      const invite = this.roomInvitations.get(invitationId);
      if (
        !invite ||
        invite.recipientId !== recipientId ||
        invite.roomCode !== roomCode.toUpperCase() ||
        (invite.status !== "accepted" && invite.status !== "joined") ||
        invite.expiresAt <= now ||
        invite.entryTokenExpiresAt === null ||
        invite.entryTokenExpiresAt <= now ||
        invite.entryTokenHash === null ||
        !matchesSessionToken(entryToken, invite.entryTokenHash)
      )
        throw new ProductStoreConflictError("房間邀請已失效，請重新接受邀請");
      this.assertRoomInvitationAllowed(invite.inviterId, recipientId);
      this.roomInvitations.set(invitationId, {
        ...invite,
        status: "joined",
        respondedAt: now,
      });
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

  linkMatchParticipant(
    matchId: string,
    seat: number,
    userId: string,
  ): Promise<MatchParticipant> {
    return Promise.resolve().then(() => {
      if (!this.users.has(userId))
        throw new ProductStoreNotFoundError(`找不到使用者：${userId}`);
      const match = this.matches.get(matchId);
      if (!match) throw new ProductStoreNotFoundError(`找不到對局：${matchId}`);
      const participant = match.participants.find(
        (entry) => entry.seat === seat,
      );
      if (!participant)
        throw new ProductStoreNotFoundError(
          `找不到對局參與者：${matchId}/${String(seat)}`,
        );
      if (participant.userId !== null && participant.userId !== userId)
        throw new ProductStoreConflictError(
          `對局參與者已綁定其他使用者：${matchId}/${String(seat)}`,
        );
      const updatedParticipant = { ...participant, userId };
      this.matches.set(matchId, {
        ...match,
        participants: match.participants.map((entry) =>
          entry.seat === seat ? updatedParticipant : entry,
        ),
      });
      return clone(updatedParticipant);
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

  listMatchesForUser(input: ListMatchHistoryInput): Promise<MatchHistoryPage> {
    return Promise.resolve().then(() => {
      if (!this.users.has(input.userId))
        throw new ProductStoreNotFoundError(`找不到使用者：${input.userId}`);
      const page = historyPage(input.page);
      const pageSize = historyPageSize(input.pageSize);
      const from = historyTime(input.from, "歷史起始時間");
      const to = historyTime(input.to, "歷史結束時間");
      const filtered = [...this.matches.values()]
        .filter(
          (match) =>
            match.status !== "active" &&
            match.participants.some(
              (participant) =>
                participant.userId === input.userId &&
                (input.result === undefined ||
                  participant.result === input.result),
            ) &&
            (input.game === undefined || match.game === input.game) &&
            (input.mode === undefined || match.mode === input.mode) &&
            (from === null || match.startedAt >= from) &&
            (to === null || match.startedAt <= to),
        )
        .sort(
          (left, right) =>
            right.startedAt - left.startedAt || right.id.localeCompare(left.id),
        );
      const offset = (page - 1) * pageSize;
      const matches = filtered.slice(offset, offset + pageSize).map(clone);
      return {
        matches,
        page,
        pageSize,
        total: filtered.length,
        hasNext: offset + matches.length < filtered.length,
      };
    });
  }

  getUserMatchStats(userId: string): Promise<UserMatchStats> {
    return Promise.resolve().then(() => {
      if (!this.users.has(userId))
        throw new ProductStoreNotFoundError(`找不到使用者：${userId}`);
      const byGame = new Map<GameId, UserMatchStatsByGame>();
      let completed = 0;
      let wins = 0;
      let losses = 0;
      let draws = 0;
      for (const match of this.matches.values()) {
        if (match.status !== "completed") continue;
        const participant = match.participants.find(
          (entry) => entry.userId === userId,
        );
        if (!participant) continue;
        completed += 1;
        if (participant.result === "win") wins += 1;
        else if (participant.result === "loss") losses += 1;
        else if (participant.result === "draw") draws += 1;
        const current = byGame.get(match.game) ?? {
          game: match.game,
          completed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
        };
        byGame.set(match.game, {
          ...current,
          completed: current.completed + 1,
          wins: current.wins + (participant.result === "win" ? 1 : 0),
          losses: current.losses + (participant.result === "loss" ? 1 : 0),
          draws: current.draws + (participant.result === "draw" ? 1 : 0),
        });
      }
      return {
        userId,
        completed,
        wins,
        losses,
        draws,
        byGame: [...byGame.values()].sort((left, right) =>
          left.game.localeCompare(right.game),
        ),
      };
    });
  }

  getUserRating(userId: string, game: GameId): Promise<RatingRecord> {
    return Promise.resolve().then(() => {
      const user = this.users.get(userId);
      if (!user) throw new ProductStoreNotFoundError(`找不到使用者：${userId}`);
      return clone(
        this.ratings.get(`${userId}:${game}`) ??
          defaultUserRating(user.id, game),
      );
    });
  }

  getUserRatings(userId: string): Promise<readonly RatingRecord[]> {
    return Promise.resolve().then(() => {
      if (!this.users.has(userId))
        throw new ProductStoreNotFoundError(`找不到使用者：${userId}`);
      return [...this.ratings.values()]
        .filter((rating) => rating.userId === userId)
        .sort((left, right) => left.game.localeCompare(right.game))
        .map(clone);
    });
  }

  getLeaderboard(
    game: GameId,
    limit = 50,
  ): Promise<readonly LeaderboardEntry[]> {
    return Promise.resolve().then(() => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new Error("排行榜筆數必須介於 1 到 100");
      const ordered = [...this.ratings.values()]
        .filter((rating) => {
          const user = this.users.get(rating.userId);
          return (
            rating.game === game &&
            rating.gamesPlayed > 0 &&
            user?.status === "active" &&
            this.preferences.get(user.id)?.showInLeaderboard === true
          );
        })
        .sort((left, right) => {
          const score = right.rating - left.rating;
          if (score !== 0) return score;
          const leftCode = this.users.get(left.userId)?.publicCode ?? "";
          const rightCode = this.users.get(right.userId)?.publicCode ?? "";
          return leftCode.localeCompare(rightCode);
        });
      let lastRating: number | null = null;
      let currentRank = 0;
      return ordered.slice(0, limit).map((rating, index) => {
        const user = this.users.get(rating.userId);
        if (!user) throw new Error("排行榜使用者不存在");
        if (rating.rating !== lastRating) currentRank = index + 1;
        lastRating = rating.rating;
        return {
          rank: currentRank,
          publicCode: user.publicCode,
          displayName: user.displayName,
          rating: rating.rating,
          gamesPlayed: rating.gamesPlayed,
          wins: rating.wins,
          losses: rating.losses,
          draws: rating.draws,
          provisional: rating.provisional,
        };
      });
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
      const rated =
        match.mode === "rated"
          ? ratedParticipants(match, input.outcome, input.participantResults)
          : null;
      const completedAt = timestamp(input.completedAt);
      const ratingUpdates = rated?.map(({ participant, result }) => {
        if (!participant.userId || !this.users.has(participant.userId))
          throw new ProductStoreNotFoundError(
            `找不到 rated 玩家：${participant.userId ?? ""}`,
          );
        const current =
          this.ratings.get(`${participant.userId}:${match.game}`) ??
          defaultUserRating(participant.userId, match.game, completedAt);
        if (current.ratingVersion !== RATING_VERSION)
          throw new ProductStoreConflictError("評分版本不相容");
        return { participant, result, current };
      });
      if (ratingUpdates) {
        const first = ratingUpdates[0];
        const second = ratingUpdates[1];
        if (!first || !second) throw new Error("rated 對局玩家資料不足");
        const firstCalculation = calculateElo({
          rating: first.current.rating,
          opponentRating: second.current.rating,
          gamesPlayed: first.current.gamesPlayed,
          result: first.result,
        });
        const secondCalculation = calculateElo({
          rating: second.current.rating,
          opponentRating: first.current.rating,
          gamesPlayed: second.current.gamesPlayed,
          result: second.result,
        });
        for (const [entry, calculation] of [
          [first, firstCalculation],
          [second, secondCalculation],
        ] as const) {
          const { current, participant, result } = entry;
          const updated: RatingRecord = {
            ...current,
            rating: calculation.ratingAfter,
            gamesPlayed: calculation.gamesAfter,
            wins: current.wins + (result === "win" ? 1 : 0),
            losses: current.losses + (result === "loss" ? 1 : 0),
            draws: current.draws + (result === "draw" ? 1 : 0),
            provisional: calculation.provisional,
            updatedAt: completedAt,
          };
          const userId = participant.userId;
          if (!userId) throw new Error("rated 玩家身份遺失");
          this.ratings.set(`${userId}:${match.game}`, updated);
        }
      }
      const outcome = clone(input.outcome);
      const updated: MatchRecord = {
        ...match,
        status: "completed",
        completedAt,
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
