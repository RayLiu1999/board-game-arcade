import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { applyMove, createGame } from "../src/shared/engine.js";
import { PostgresRoomStore } from "../src/server/postgres-room-store.js";
import {
  RoomStoreConflictError,
  ROOM_TTL_MS,
  type RoomSnapshot,
} from "../src/server/room-store.js";

const databaseUrl = process.env.QIJU_TEST_DATABASE_URL;

if (!databaseUrl) {
  void test(
    "PostgreSQL room store integration",
    { skip: "未設定 QIJU_TEST_DATABASE_URL" },
    () => {},
  );
} else {
  void test("PostgreSQL room store persists board snapshots and revisions", async (t) => {
    const store = new PostgresRoomStore({ connectionString: databaseUrl });
    const recoveredStore = new PostgresRoomStore({
      connectionString: databaseUrl,
    });
    const code = `T${randomBytes(3).toString("hex").slice(0, 5).toUpperCase()}`;

    t.after(async () => {
      await store.delete(code).catch(() => {});
      await store.close();
      await recoveredStore.close();
    });

    await store.initialize();
    await recoveredStore.initialize();

    const created = createGame("gomoku");
    if (created.game === "riichi") throw new Error("測試收到日麻狀態");
    const now = Date.now();
    const snapshot: RoomSnapshot = {
      code,
      state: created,
      players: [
        {
          name: "甲",
          tokenHash: "a".repeat(64),
          bot: false,
        },
        null,
      ],
      rounds: 1,
      rematch: [],
      revision: 0,
      touched: now,
      expiresAt: now + ROOM_TTL_MS,
    };

    await store.create(snapshot);
    const loaded = await recoveredStore.load(now);
    assert.deepEqual(loaded, [snapshot]);

    const next = applyMove(created, { to: 112 });
    if (next.game === "riichi") throw new Error("測試收到日麻狀態");
    const updated: RoomSnapshot = {
      ...snapshot,
      state: next,
      touched: now + 1000,
      expiresAt: now + 1000 + ROOM_TTL_MS,
    };
    assert.equal(await recoveredStore.update(updated, 0), 1);
    await assert.rejects(
      store.update(updated, 0),
      (error: unknown) => error instanceof RoomStoreConflictError,
    );

    const afterUpdate = await store.load(updated.touched);
    assert.equal(afterUpdate.length, 1);
    const saved = afterUpdate[0];
    assert.ok(saved);
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.state, next);
    assert.deepEqual(await store.load(saved.expiresAt + 1), []);

    await store.pruneExpired(saved.expiresAt + 1, []);
    await store.create({
      ...snapshot,
      touched: saved.expiresAt + 2,
      expiresAt: saved.expiresAt + 2 + ROOM_TTL_MS,
    });
  });
}
