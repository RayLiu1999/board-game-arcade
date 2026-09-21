import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const createRoomToken = (): string => randomBytes(24).toString("hex");

export const hashRoomToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

export const matchesRoomToken = (
  token: string,
  expectedHash: string,
): boolean => {
  const actual = Buffer.from(hashRoomToken(token), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
