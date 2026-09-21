import test from "node:test";
import assert from "node:assert/strict";

import { RiichiSession } from "../lib/riichi-session.js";
import { RoomManager } from "../src/server/room-manager.js";
import {
  MemoryRoomStore,
  ROOM_TTL_MS,
  type RoomSnapshot,
} from "../src/server/room-store.js";

void test("room operations for one room execute serially", async () => {
  const manager = new RoomManager();
  const events: string[] = [];

  await Promise.all([
    manager.runExclusive("ABC123", async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => setImmediate(resolve));
      events.push("first:end");
    }),
    manager.runExclusive("ABC123", async () => {
      events.push("second:start");
      events.push("second:end");
      await Promise.resolve();
    }),
  ]);

  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
  await manager.closeAll();
});

void test("room manager restores a paused riichi snapshot", async () => {
  const source = new RiichiSession({ humans: [0], auto: false, rounds: 0 });
  source.start();
  for (let i = 0; i < 10; i++) source.step();
  const now = Date.now();
  const snapshot: RoomSnapshot = {
    code: "RIICHI",
    state: {
      game: "riichi",
      winner: null,
      ply: source.revision,
    },
    players: [
      { name: "甲", tokenHash: "a".repeat(64), bot: false },
      { name: "AI 南", tokenHash: "b".repeat(64), bot: true },
      { name: "AI 西", tokenHash: "c".repeat(64), bot: true },
      { name: "AI 北", tokenHash: "d".repeat(64), bot: true },
    ],
    rounds: 0,
    rematch: [],
    revision: 0,
    touched: now,
    expiresAt: now + ROOM_TTL_MS,
    riichi: source.snapshot(),
  };
  const store = new MemoryRoomStore();
  await store.create(snapshot);
  const manager = new RoomManager({ store, now: () => now });
  try {
    await manager.ready;
    const room = manager.rooms.get(snapshot.code);
    assert.ok(room);
    assert.ok(room.session);
    assert.equal(room.session.paused, true);
    assert.deepEqual(room.session.view(0), {
      ...source.view(0),
      paused: true,
    });
  } finally {
    source.close();
    await manager.closeAll();
  }
});
