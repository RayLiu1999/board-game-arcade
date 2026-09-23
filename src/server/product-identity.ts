import {
  createPasswordHash,
  createSessionToken,
  DEFAULT_SESSION_TTL_MS,
  normalizeAccountName,
  verifyPassword,
} from "./product-security.js";
import type {
  AccountCredentialRecord,
  SessionRecord,
  SessionStore,
  UserRecord,
  UserStore,
} from "./product-store.js";

export interface IdentitySession {
  readonly user: UserRecord;
  readonly session: SessionRecord;
  readonly token: string;
}

export interface AuthenticatedIdentity {
  readonly user: UserRecord;
  readonly session: SessionRecord;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("帳號或密碼錯誤");
    this.name = "InvalidCredentialsError";
  }
}

export class LoginRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("嘗試次數過多，請稍後再試");
    this.name = "LoginRateLimitError";
  }
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const LOGIN_BUCKET_LIMIT = 10_000;
const DUMMY_PASSWORD_HASH = createPasswordHash("qiju-invalid-login-dummy");

export class ProductIdentityService {
  private readonly loginAttempts = new Map<
    string,
    { failures: number; windowStartedAt: number; blockedUntil: number }
  >();

  constructor(
    private readonly users: UserStore,
    private readonly sessions: SessionStore,
    private readonly now: () => number = Date.now,
  ) {}

  async createGuestIdentity(
    displayName: string,
    ttlMs = DEFAULT_SESSION_TTL_MS,
  ): Promise<IdentitySession> {
    const now = this.now();
    const user = await this.users.createUser({ displayName, createdAt: now });
    const token = createSessionToken();
    const session = await this.sessions.createSession({
      userId: user.id,
      token,
      createdAt: now,
      expiresAt: now + ttlMs,
    });
    return { user, session, token };
  }

  async upgradeAccount(
    userId: string,
    loginName: string,
    password: string,
  ): Promise<UserRecord> {
    const normalizedLogin = normalizeAccountName(loginName);
    const passwordHash = await createPasswordHash(password);
    return this.users.upgradeAccount(
      userId,
      normalizedLogin,
      passwordHash,
      this.now(),
    );
  }

  async login(
    loginName: string,
    password: string,
    clientAddress: string,
    ttlMs = DEFAULT_SESSION_TTL_MS,
  ): Promise<IdentitySession> {
    const now = this.now();
    const address = clientAddress.trim() || "unknown";
    const bucket = this.loginAttempts.get(address);
    if (bucket?.blockedUntil && bucket.blockedUntil > now)
      throw new LoginRateLimitError(
        Math.ceil((bucket.blockedUntil - now) / 1000),
      );

    let credentials: AccountCredentialRecord | null = null;
    let normalizedLogin: string | null = null;
    try {
      normalizedLogin = normalizeAccountName(loginName);
    } catch {
      // Invalid account names use the same failure response and password work.
    }
    if (normalizedLogin)
      credentials = await this.users.findAccountByLoginName(normalizedLogin);
    const expectedHash =
      credentials?.passwordHash ?? (await DUMMY_PASSWORD_HASH);
    const valid = await verifyPassword(password, expectedHash);
    if (!credentials || !valid || credentials.user.status !== "active") {
      this.recordLoginFailure(address, now);
      throw new InvalidCredentialsError();
    }

    this.loginAttempts.delete(address);
    await this.users.touchUser(credentials.user.id, now);
    const token = createSessionToken();
    const session = await this.sessions.createSession({
      userId: credentials.user.id,
      token,
      createdAt: now,
      expiresAt: now + ttlMs,
    });
    const user = await this.users.getUser(credentials.user.id);
    if (!user) throw new InvalidCredentialsError();
    return { user, session, token };
  }

  async authenticate(token: string): Promise<AuthenticatedIdentity | null> {
    const session = await this.sessions.findActiveSession(token, this.now());
    if (!session) return null;
    const user = await this.users.getUser(session.userId);
    if (!user || user.status !== "active") return null;
    await this.users.touchUser(user.id, this.now());
    return { user, session };
  }

  revoke(token: string): Promise<boolean> {
    return this.sessions.revokeSession(token, this.now());
  }

  private recordLoginFailure(address: string, now: number): void {
    for (const [key, value] of this.loginAttempts) {
      if (
        value.blockedUntil <= now &&
        now - value.windowStartedAt >= LOGIN_WINDOW_MS
      )
        this.loginAttempts.delete(key);
    }
    const previous = this.loginAttempts.get(address);
    const active = previous && now - previous.windowStartedAt < LOGIN_WINDOW_MS;
    const failures = active ? previous.failures + 1 : 1;
    this.loginAttempts.set(address, {
      failures,
      windowStartedAt: active ? previous.windowStartedAt : now,
      blockedUntil: failures >= LOGIN_MAX_FAILURES ? now + LOGIN_WINDOW_MS : 0,
    });
    while (this.loginAttempts.size > LOGIN_BUCKET_LIMIT) {
      const oldestKey = this.loginAttempts.keys().next().value;
      if (oldestKey === undefined) break;
      this.loginAttempts.delete(oldestKey);
    }
  }
}
