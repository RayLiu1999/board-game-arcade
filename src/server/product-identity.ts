import {
  createSessionToken,
  DEFAULT_SESSION_TTL_MS,
} from "./product-security.js";
import type {
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

export class ProductIdentityService {
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
}
