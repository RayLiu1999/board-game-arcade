import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Pool, type PoolClient, type PoolConfig } from "pg";

import {
  parseRiichiSessionSnapshot,
  type RiichiSessionSnapshot,
} from "../../lib/riichi-session.js";
import type {
  BoardGameId,
  BoardState,
  RiichiWaitingState,
} from "../shared/game-types.js";
import { isGameId } from "../shared/protocol.js";
import type { RiichiSummary } from "./room-types.js";
import {
  RoomStoreConflictError,
  type RoomSnapshot,
  type RoomStore,
  type StoredRoomPlayer,
} from "./room-store.js";

interface RoomPlayerRow {
  readonly code: string;
  readonly game: string;
  readonly state_json: unknown;
  readonly rounds: number;
  readonly rematch_json: unknown;
  readonly revision: number | string;
  readonly touched_at: Date;
  readonly expires_at: Date;
  readonly riichi_json: unknown;
  readonly seat: number | null;
  readonly name: string | null;
  readonly token_hash: string | null;
  readonly bot: boolean | null;
}

export interface PostgresRoomStoreOptions {
  connectionString?: string;
  pool?: Pool;
}

const migrationDirectory = new URL("./migrations/", import.meta.url);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const boardGame = (value: string): BoardGameId => {
  if (!isGameId(value) || value === "riichi")
    throw new Error(`資料庫含有不支援的棋種：${value}`);
  return value;
};

const boardState = (value: unknown): BoardState => {
  if (!isRecord(value) || typeof value.game !== "string")
    throw new Error("資料庫房間 state 格式錯誤");
  const game = boardGame(value.game);
  if (!Array.isArray(value.board)) throw new Error("資料庫棋盤格式錯誤");
  return { ...value, game } as BoardState;
};

const riichiState = (value: unknown): RiichiSummary => {
  if (
    !isRecord(value) ||
    value.game !== "riichi" ||
    (typeof value.winner !== "number" && value.winner !== null) ||
    typeof value.ply !== "number" ||
    !Number.isSafeInteger(value.ply) ||
    value.ply < 0
  )
    throw new Error("資料庫日麻房間 state 格式錯誤");
  return {
    game: "riichi",
    winner: value.winner,
    ply: value.ply,
  };
};

const riichiWaitingState = (
  value: Record<string, unknown>,
): RiichiWaitingState => {
  if (
    value.phase !== "waiting" ||
    value.winner !== null ||
    value.ply !== 0 ||
    !Array.isArray(value.history) ||
    value.history.length !== 0
  )
    throw new Error("資料庫日麻等待房間 state 格式錯誤");
  return {
    game: "riichi",
    phase: "waiting",
    winner: null,
    ply: 0,
    history: [],
  };
};

const roomState = (
  value: unknown,
): BoardState | RiichiSummary | RiichiWaitingState => {
  if (!isRecord(value) || typeof value.game !== "string")
    throw new Error("資料庫房間 state 格式錯誤");
  if (value.game !== "riichi") return boardState(value);
  return value.phase === "waiting"
    ? riichiWaitingState(value)
    : riichiState(value);
};

const rematch = (value: unknown): number[] => {
  if (!Array.isArray(value)) throw new Error("資料庫再戰狀態格式錯誤");
  const result: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isInteger(entry))
      throw new Error("資料庫再戰狀態格式錯誤");
    result.push(entry);
  }
  return result;
};

const revision = (value: number | string): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error("資料庫 revision 格式錯誤");
  return parsed;
};

const dateMillis = (value: Date): number => {
  const parsed = value.getTime();
  if (!Number.isFinite(parsed)) throw new Error("資料庫時間格式錯誤");
  return parsed;
};

const player = (row: RoomPlayerRow): StoredRoomPlayer => {
  if (row.name === null || row.token_hash === null || row.bot === null)
    throw new Error("資料庫玩家格式錯誤");
  return {
    name: row.name,
    tokenHash: row.token_hash,
    bot: row.bot,
  };
};

const riichiSnapshot = (value: unknown): RiichiSessionSnapshot =>
  parseRiichiSessionSnapshot(value);

export class PostgresRoomStore implements RoomStore {
  private readonly pool: Pool;

  constructor(options: PostgresRoomStoreOptions = {}) {
    if (options.pool) {
      this.pool = options.pool;
      return;
    }
    const config: PoolConfig = {};
    if (options.connectionString)
      config.connectionString = options.connectionString;
    this.pool = new Pool(config);
  }

  async initialize(): Promise<void> {
    const files = (await readdir(fileURLToPath(migrationDirectory)))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const migration = await readFile(
        new URL(file, migrationDirectory),
        "utf8",
      );
      await this.pool.query(migration);
    }
  }

  async load(now: number): Promise<RoomSnapshot[]> {
    const result = await this.pool.query<RoomPlayerRow>(
      `
        SELECT
          r.code,
          r.game,
          r.state_json,
          r.rounds,
          r.rematch_json,
          r.revision,
          r.touched_at,
          r.expires_at,
          r.riichi_json,
          p.seat,
          p.name,
          p.token_hash,
          p.bot
        FROM qiju_rooms AS r
        LEFT JOIN qiju_room_players AS p ON p.room_code = r.code
        WHERE r.expires_at > to_timestamp($1 / 1000.0)
        ORDER BY r.code, p.seat
      `,
      [now],
    );
    const rooms = new Map<string, RoomSnapshot>();
    for (const row of result.rows) {
      let snapshot = rooms.get(row.code);
      if (!snapshot) {
        const state = roomState(row.state_json);
        if (state.game !== row.game)
          throw new Error(`房間 ${row.code} 的棋種與 state 不一致`);
        snapshot = {
          code: row.code,
          state,
          players: Array<StoredRoomPlayer | null>(
            state.game === "riichi" ? 4 : 2,
          ).fill(null),
          rounds: row.rounds,
          rematch: rematch(row.rematch_json),
          revision: revision(row.revision),
          touched: dateMillis(row.touched_at),
          expiresAt: dateMillis(row.expires_at),
        };
        if (state.game === "riichi" && row.riichi_json !== null)
          snapshot.riichi = riichiSnapshot(row.riichi_json);
        if (state.game !== "riichi" && row.riichi_json !== null)
          throw new Error(`一般棋類房間 ${row.code} 不應有日麻 snapshot`);
        rooms.set(row.code, snapshot);
      }
      if (row.seat !== null) {
        if (row.seat < 0 || row.seat >= snapshot.players.length)
          throw new Error(`房間 ${row.code} 的座位格式錯誤`);
        snapshot.players[row.seat] = player(row);
      }
    }
    return [...rooms.values()];
  }

  async pruneExpired(
    now: number,
    activeCodes: readonly string[],
  ): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM qiju_rooms
        WHERE expires_at <= to_timestamp($1 / 1000.0)
          AND NOT (code = ANY($2::varchar[]))
      `,
      [now, [...activeCodes]],
    );
  }

  async create(snapshot: RoomSnapshot): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        `
          INSERT INTO qiju_rooms (
            code, game, state_json, rounds, rematch_json,
            revision, touched_at, expires_at, riichi_json
          )
          VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7, $8, $9::jsonb)
        `,
        this.roomParameters(snapshot),
      );
      await this.insertPlayers(client, snapshot);
    });
  }

  async update(
    snapshot: RoomSnapshot,
    expectedRevision: number,
  ): Promise<number> {
    return this.transaction(async (client) => {
      const nextRevision = expectedRevision + 1;
      const result = await client.query(
        `
          UPDATE qiju_rooms
          SET
            state_json = $2::jsonb,
            rounds = $3,
            rematch_json = $4::jsonb,
            revision = $5,
            touched_at = $6,
            expires_at = $7,
            riichi_json = $8::jsonb
          WHERE code = $1 AND revision = $9
        `,
        [
          snapshot.code,
          JSON.stringify(snapshot.state),
          snapshot.rounds,
          JSON.stringify(snapshot.rematch),
          nextRevision,
          new Date(snapshot.touched),
          new Date(snapshot.expiresAt),
          snapshot.riichi ? JSON.stringify(snapshot.riichi) : null,
          expectedRevision,
        ],
      );
      if (result.rowCount !== 1)
        throw new RoomStoreConflictError(snapshot.code);
      await client.query("DELETE FROM qiju_room_players WHERE room_code = $1", [
        snapshot.code,
      ]);
      await this.insertPlayers(client, snapshot);
      return nextRevision;
    });
  }

  async delete(code: string): Promise<void> {
    await this.pool.query("DELETE FROM qiju_rooms WHERE code = $1", [code]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private roomParameters(snapshot: RoomSnapshot): unknown[] {
    return [
      snapshot.code,
      snapshot.state.game,
      JSON.stringify(snapshot.state),
      snapshot.rounds,
      JSON.stringify(snapshot.rematch),
      snapshot.revision,
      new Date(snapshot.touched),
      new Date(snapshot.expiresAt),
      snapshot.riichi ? JSON.stringify(snapshot.riichi) : null,
    ];
  }

  private async insertPlayers(
    client: PoolClient,
    snapshot: RoomSnapshot,
  ): Promise<void> {
    for (const [seat, entry] of snapshot.players.entries()) {
      if (!entry) continue;
      await client.query(
        `
          INSERT INTO qiju_room_players (
            room_code, seat, name, token_hash, bot
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [snapshot.code, seat, entry.name, entry.tokenHash, entry.bot],
      );
    }
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
