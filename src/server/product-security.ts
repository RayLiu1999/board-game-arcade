import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = "qiju_session";

export const createSessionToken = (): string =>
  randomBytes(32).toString("base64url");

export const hashSessionToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

export const matchesSessionToken = (
  token: string,
  expectedHash: string,
): boolean => {
  const actual = Buffer.from(hashSessionToken(token), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export const sessionTokenFromCookie = (
  cookieHeader: string | undefined,
): string | null => {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return value ? decodeURIComponent(value) : null;
    } catch {
      return null;
    }
  }
  return null;
};

export const sessionCookie = (token: string, secure: boolean): string =>
  `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(DEFAULT_SESSION_TTL_MS / 1000)}${secure ? "; Secure" : ""}`;

export const clearSessionCookie = (secure: boolean): string =>
  `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
