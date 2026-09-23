import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = "qiju_session";
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_COST = 32768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;

export const normalizeAccountName = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized))
    throw new Error("帳號須為 3 到 24 個英數字或底線，且以英數字開頭");
  return normalized;
};

export const normalizePublicCode = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  if (!/^QJ-[0-9A-F]{10}$/.test(normalized))
    throw new Error("玩家代碼格式錯誤");
  return normalized;
};

export const createPublicCode = (): string =>
  `QJ-${randomBytes(5).toString("hex").toUpperCase()}`;

const validatePassword = (password: string): void => {
  const length = Array.from(password).length;
  if (length < 10 || length > 128 || Buffer.byteLength(password, "utf8") > 512)
    throw new Error("密碼長度須為 10 到 128 個字元");
};

const deriveKey = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELISM,
        maxmem: 64 * 1024 * 1024,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });

export const createPasswordHash = async (password: string): Promise<string> => {
  validatePassword(password);
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return [
    "scrypt",
    String(SCRYPT_COST),
    String(SCRYPT_BLOCK_SIZE),
    String(SCRYPT_PARALLELISM),
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
};

export const verifyPassword = async (
  password: string,
  encoded: string,
): Promise<boolean> => {
  try {
    if (Buffer.byteLength(password, "utf8") > 512) return false;
    const [algorithm, cost, blockSize, parallelism, saltText, keyText, extra] =
      encoded.split("$");
    if (
      algorithm !== "scrypt" ||
      cost !== String(SCRYPT_COST) ||
      blockSize !== String(SCRYPT_BLOCK_SIZE) ||
      parallelism !== String(SCRYPT_PARALLELISM) ||
      !saltText ||
      !keyText ||
      extra !== undefined
    )
      return false;
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(keyText, "base64url");
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH)
      return false;
    const actual = await deriveKey(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

export const createOpaqueToken = (): string =>
  randomBytes(32).toString("base64url");

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
