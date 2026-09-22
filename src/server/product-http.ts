import type { IncomingMessage, ServerResponse } from "node:http";

import { isGameId, type GameId } from "../shared/protocol.js";
import type {
  AuthenticatedIdentity,
  ProductIdentityService,
} from "./product-identity.js";
import type { ClaimedRoomIdentity } from "./room-manager.js";
import {
  clearSessionCookie,
  sessionCookie,
  sessionTokenFromCookie,
} from "./product-security.js";
import {
  ProductStoreConflictError,
  ProductStoreNotFoundError,
  type MatchHistoryResult,
  type MatchMode,
  type MatchRecord,
  type ProductStore,
  type RatingRecord,
  type UpdateUserPreferencesInput,
} from "./product-store.js";

const MAX_BODY_BYTES = 16 * 1024;
const modes: readonly MatchMode[] = [
  "ai",
  "local",
  "friend",
  "public",
  "rated",
];

export interface ProductHttpDependencies {
  readonly identity: ProductIdentityService;
  readonly productStore: ProductStore;
  readonly claimRoom: (
    code: string,
    roomToken: string,
    userId: string,
  ) => Promise<ClaimedRoomIdentity>;
}

export type ProductHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

class ProductHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProductHttpError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sendJson = (
  response: ServerResponse,
  status: number,
  value: unknown,
): void => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
};

const sendNoContent = (response: ServerResponse): void => {
  response.writeHead(204, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end();
};

const requestIsSecure = (request: IncomingMessage): boolean =>
  (request.socket as typeof request.socket & { encrypted?: boolean })
    .encrypted === true || request.headers["x-forwarded-proto"] === "https";

const requireSameOrigin = (request: IncomingMessage): void => {
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers.host;
  if (!host) throw new ProductHttpError(403, "無法確認請求來源");
  try {
    if (new URL(origin).host !== host)
      throw new ProductHttpError(403, "請求來源不符");
  } catch (error: unknown) {
    if (error instanceof ProductHttpError) throw error;
    throw new ProductHttpError(403, "請求來源不符");
  }
};

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new ProductHttpError(413, "請求內容過大");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ProductHttpError(400, "JSON 格式錯誤");
  }
};

const readRecord = async (
  request: IncomingMessage,
): Promise<Record<string, unknown>> => {
  const body = await readBody(request);
  if (!isRecord(body)) throw new ProductHttpError(400, "請求內容格式錯誤");
  return body;
};

const publicUser = (
  identity: AuthenticatedIdentity | { user: AuthenticatedIdentity["user"] },
) => ({
  id: identity.user.id,
  displayName: identity.user.displayName,
  status: identity.user.status,
  createdAt: identity.user.createdAt,
  lastActiveAt: identity.user.lastActiveAt,
});

const authFromRequest = async (
  request: IncomingMessage,
  identity: ProductIdentityService,
): Promise<AuthenticatedIdentity | null> => {
  const token = sessionTokenFromCookie(request.headers.cookie);
  return token ? identity.authenticate(token) : null;
};

const requireIdentity = async (
  request: IncomingMessage,
  identity: ProductIdentityService,
): Promise<AuthenticatedIdentity> => {
  const authenticated = await authFromRequest(request, identity);
  if (!authenticated) throw new ProductHttpError(401, "請先建立 guest session");
  return authenticated;
};

const optionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new ProductHttpError(400, `${label}格式錯誤`);
  return value;
};

const optionalBoolean = (
  value: unknown,
  label: string,
): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean")
    throw new ProductHttpError(400, `${label}格式錯誤`);
  return value;
};

const optionalInteger = (
  value: string | null,
  label: string,
): number | undefined => {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) throw new ProductHttpError(400, `${label}格式錯誤`);
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new ProductHttpError(400, `${label}格式錯誤`);
  return result;
};

const optionalTime = (
  value: string | null,
  label: string,
): number | undefined => {
  if (value === null) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new ProductHttpError(400, `${label}格式錯誤`);
};

const optionalGame = (value: string | null): GameId | undefined => {
  if (value === null) return undefined;
  if (!isGameId(value)) throw new ProductHttpError(400, "棋種格式錯誤");
  return value;
};

const optionalMode = (value: string | null): MatchMode | undefined => {
  if (value === null) return undefined;
  if (!modes.includes(value as MatchMode))
    throw new ProductHttpError(400, "對局模式格式錯誤");
  return value as MatchMode;
};

const optionalResult = (
  value: string | null,
): MatchHistoryResult | undefined => {
  if (value === null) return undefined;
  if (value !== "win" && value !== "loss" && value !== "draw")
    throw new ProductHttpError(400, "對局結果格式錯誤");
  return value;
};

const publicMatch = (match: MatchRecord, userId: string) => {
  const self = match.participants.find(
    (participant) => participant.userId === userId,
  );
  return {
    id: match.id,
    game: match.game,
    mode: match.mode,
    status: match.status,
    startedAt: match.startedAt,
    completedAt: match.completedAt,
    result: self?.result ?? "unknown",
    outcome: match.outcome,
    participants: match.participants.map((participant) => ({
      seat: participant.seat,
      displayName: participant.displayName,
      bot: participant.bot,
      result: participant.result,
      self: participant.userId === userId,
    })),
  };
};

const publicRating = (rating: RatingRecord) => ({
  game: rating.game,
  rating: rating.rating,
  gamesPlayed: rating.gamesPlayed,
  wins: rating.wins,
  losses: rating.losses,
  draws: rating.draws,
  provisional: rating.provisional,
  ratingVersion: rating.ratingVersion,
  updatedAt: rating.updatedAt,
});

const apiError = (error: unknown): { status: number; message: string } => {
  if (error instanceof ProductHttpError)
    return { status: error.status, message: error.message };
  if (error instanceof ProductStoreNotFoundError)
    return { status: 404, message: error.message };
  if (error instanceof ProductStoreConflictError)
    return { status: 409, message: error.message };
  return { status: 500, message: "伺服器錯誤" };
};

export const createProductHttpHandler =
  (dependencies: ProductHttpDependencies): ProductHttpHandler =>
  async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return false;
    try {
      const secure = requestIsSecure(request);
      if (url.pathname === "/api/guest-session" && request.method === "POST") {
        requireSameOrigin(request);
        const body = await readRecord(request);
        const requestedName = optionalString(body.displayName, "顯示名稱");
        const existing = await authFromRequest(request, dependencies.identity);
        if (existing) {
          const user = requestedName
            ? await dependencies.productStore.updateUserProfile(
                existing.user.id,
                {
                  displayName: requestedName,
                },
              )
            : existing.user;
          const preferences =
            await dependencies.productStore.getUserPreferences(user.id);
          sendJson(response, 200, { user: publicUser({ user }), preferences });
          return true;
        }
        const created = await dependencies.identity.createGuestIdentity(
          requestedName || "訪客棋手",
        );
        const preferences = await dependencies.productStore.getUserPreferences(
          created.user.id,
        );
        response.setHeader("Set-Cookie", sessionCookie(created.token, secure));
        sendJson(response, 201, {
          user: publicUser(created),
          preferences,
          expiresAt: created.session.expiresAt,
        });
        return true;
      }

      if (url.pathname === "/api/session" && request.method === "DELETE") {
        requireSameOrigin(request);
        const token = sessionTokenFromCookie(request.headers.cookie);
        if (token) await dependencies.identity.revoke(token);
        response.setHeader("Set-Cookie", clearSessionCookie(secure));
        sendNoContent(response);
        return true;
      }

      if (url.pathname === "/api/me" && request.method === "GET") {
        const authenticated = await requireIdentity(
          request,
          dependencies.identity,
        );
        const preferences = await dependencies.productStore.getUserPreferences(
          authenticated.user.id,
        );
        sendJson(response, 200, {
          user: publicUser(authenticated),
          preferences,
        });
        return true;
      }

      if (url.pathname === "/api/me" && request.method === "PATCH") {
        requireSameOrigin(request);
        const authenticated = await requireIdentity(
          request,
          dependencies.identity,
        );
        const body = await readRecord(request);
        const displayName = optionalString(body.displayName, "顯示名稱");
        const profileKeys = displayName === undefined ? 0 : 1;
        const requestedLocale = optionalString(body.locale, "語言");
        const requestedSound = optionalBoolean(body.soundEnabled, "音效");
        const requestedHistoryPublic = optionalBoolean(
          body.historyPublic,
          "歷史公開設定",
        );
        const requestedFriendInvites = optionalBoolean(
          body.friendInvites,
          "好友邀請設定",
        );
        const requestedOnlineStatus = optionalBoolean(
          body.showOnlineStatus,
          "線上狀態設定",
        );
        const preferences: UpdateUserPreferencesInput = {
          ...(requestedLocale === undefined ? {} : { locale: requestedLocale }),
          ...(body.theme === undefined
            ? {}
            : { theme: body.theme as "system" | "light" | "dark" }),
          ...(requestedSound === undefined
            ? {}
            : { soundEnabled: requestedSound }),
          ...(requestedHistoryPublic === undefined
            ? {}
            : { historyPublic: requestedHistoryPublic }),
          ...(requestedFriendInvites === undefined
            ? {}
            : { friendInvites: requestedFriendInvites }),
          ...(requestedOnlineStatus === undefined
            ? {}
            : { showOnlineStatus: requestedOnlineStatus }),
        };
        const preferenceKeys = Object.keys(preferences).length;
        if (profileKeys === 0 && preferenceKeys === 0)
          throw new ProductHttpError(400, "沒有可更新的欄位");
        const user =
          displayName === undefined
            ? authenticated.user
            : await dependencies.productStore.updateUserProfile(
                authenticated.user.id,
                { displayName },
              );
        const updatedPreferences =
          preferenceKeys === 0
            ? await dependencies.productStore.getUserPreferences(user.id)
            : await dependencies.productStore.updateUserPreferences(
                user.id,
                preferences,
              );
        sendJson(response, 200, {
          user: publicUser({ user }),
          preferences: updatedPreferences,
        });
        return true;
      }

      if (url.pathname === "/api/me/matches" && request.method === "GET") {
        const authenticated = await requireIdentity(
          request,
          dependencies.identity,
        );
        const game = optionalGame(url.searchParams.get("game"));
        const mode = optionalMode(url.searchParams.get("mode"));
        const result = optionalResult(url.searchParams.get("result"));
        const from = optionalTime(url.searchParams.get("from"), "歷史起始時間");
        const to = optionalTime(url.searchParams.get("to"), "歷史結束時間");
        const page = optionalInteger(url.searchParams.get("page"), "歷史頁碼");
        const pageSize = optionalInteger(
          url.searchParams.get("pageSize"),
          "歷史每頁筆數",
        );
        const history = await dependencies.productStore.listMatchesForUser({
          userId: authenticated.user.id,
          ...(game === undefined ? {} : { game }),
          ...(mode === undefined ? {} : { mode }),
          ...(result === undefined ? {} : { result }),
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
          ...(page === undefined ? {} : { page }),
          ...(pageSize === undefined ? {} : { pageSize }),
        });
        sendJson(response, 200, {
          ...history,
          matches: history.matches.map((match) =>
            publicMatch(match, authenticated.user.id),
          ),
        });
        return true;
      }

      if (url.pathname === "/api/me/stats" && request.method === "GET") {
        const authenticated = await requireIdentity(
          request,
          dependencies.identity,
        );
        const stats = await dependencies.productStore.getUserMatchStats(
          authenticated.user.id,
        );
        sendJson(response, 200, {
          completed: stats.completed,
          wins: stats.wins,
          losses: stats.losses,
          draws: stats.draws,
          byGame: stats.byGame,
        });
        return true;
      }

      if (url.pathname === "/api/me/ratings" && request.method === "GET") {
        const authenticated = await requireIdentity(
          request,
          dependencies.identity,
        );
        const ratings = await dependencies.productStore.getUserRatings(
          authenticated.user.id,
        );
        sendJson(response, 200, { ratings: ratings.map(publicRating) });
        return true;
      }

      if (url.pathname === "/api/me/claim-room" && request.method === "POST") {
        requireSameOrigin(request);
        const authenticated = await requireIdentity(
          request,
          dependencies.identity,
        );
        const body = await readRecord(request);
        const code = optionalString(body.code, "房間代碼")
          ?.trim()
          .toUpperCase();
        const token = optionalString(body.token, "房間 token");
        if (!code || !token)
          throw new ProductHttpError(400, "房間代碼與 token 不可為空");
        const claimed = await dependencies.claimRoom(
          code,
          token,
          authenticated.user.id,
        );
        sendJson(response, 200, claimed);
        return true;
      }

      sendJson(response, 404, { error: "找不到 API" });
      return true;
    } catch (error: unknown) {
      const result = apiError(error);
      sendJson(response, result.status, { error: result.message });
      return true;
    }
  };
