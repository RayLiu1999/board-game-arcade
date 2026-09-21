import type { BoardState, RiichiWaitingState } from "../shared/game-types.js";
import type { RiichiSessionSnapshot } from "../../lib/riichi-session.js";
import type { RiichiSummary } from "./room-types.js";

export const ROOM_TTL_MS = 30 * 60 * 1000;

export interface StoredRoomPlayer {
  name: string;
  tokenHash: string;
  bot: boolean;
}

export interface RoomSnapshot {
  code: string;
  state: BoardState | RiichiSummary | RiichiWaitingState;
  players: Array<StoredRoomPlayer | null>;
  rounds: number;
  rematch: number[];
  revision: number;
  touched: number;
  expiresAt: number;
  riichi?: RiichiSessionSnapshot;
}

export interface RoomStore {
  initialize(): Promise<void>;
  load(now: number): Promise<RoomSnapshot[]>;
  pruneExpired(now: number, activeCodes: readonly string[]): Promise<void>;
  create(snapshot: RoomSnapshot): Promise<void>;
  update(snapshot: RoomSnapshot, expectedRevision: number): Promise<number>;
  delete(code: string): Promise<void>;
  close(): Promise<void>;
}

export class RoomStoreConflictError extends Error {
  constructor(code: string) {
    super(`房間 ${code} 已被其他程序更新`);
    this.name = "RoomStoreConflictError";
  }
}

const clone = (snapshot: RoomSnapshot): RoomSnapshot =>
  structuredClone(snapshot);

export class MemoryRoomStore implements RoomStore {
  private readonly snapshots = new Map<string, RoomSnapshot>();

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  load(now: number): Promise<RoomSnapshot[]> {
    return Promise.resolve(
      [...this.snapshots.values()]
        .filter((snapshot) => snapshot.expiresAt > now)
        .map(clone),
    );
  }

  pruneExpired(now: number, activeCodes: readonly string[]): Promise<void> {
    return Promise.resolve().then(() => {
      const active = new Set(activeCodes);
      for (const [code, snapshot] of this.snapshots) {
        if (snapshot.expiresAt <= now && !active.has(code))
          this.snapshots.delete(code);
      }
    });
  }

  create(snapshot: RoomSnapshot): Promise<void> {
    return Promise.resolve().then(() => {
      if (this.snapshots.has(snapshot.code))
        throw new Error(`房間代碼已存在：${snapshot.code}`);
      this.snapshots.set(snapshot.code, clone(snapshot));
    });
  }

  update(snapshot: RoomSnapshot, expectedRevision: number): Promise<number> {
    return Promise.resolve().then(() => {
      const current = this.snapshots.get(snapshot.code);
      if (!current || current.revision !== expectedRevision)
        throw new RoomStoreConflictError(snapshot.code);
      const revision = expectedRevision + 1;
      this.snapshots.set(snapshot.code, clone({ ...snapshot, revision }));
      return revision;
    });
  }

  delete(code: string): Promise<void> {
    return Promise.resolve().then(() => {
      this.snapshots.delete(code);
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
