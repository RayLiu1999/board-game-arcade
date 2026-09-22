import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
