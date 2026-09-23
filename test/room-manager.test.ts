import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";

import { RiichiSession } from "../lib/riichi-session.js";
import {
  MATCHMAKING_TICKET_TTL_MS,
  MatchmakingQueue,
} from "../src/server/matchmaking.js";
import { MemoryProductStore } from "../src/server/product-store.js";
import { RoomManager } from "../src/server/room-manager.js";
import type { ClientSocket } from "../src/server/room-types.js";
import {
  MemoryRoomStore,
  ROOM_TTL_MS,
  type RoomSnapshot,
} from "../src/server/room-store.js";

const matchmake = {
  type: "matchmake" as const,
  game: "gomoku" as const,
  mode: "casual" as const,
  timeControl: "unlimited" as const,
};

const matchmakingSocket = (userId: string): ClientSocket =>
  ({
    userId,
    room: null,
    matchmakingTicketId: null,
    readyState: WebSocket.OPEN,
  }) as ClientSocket;

void test("one player cannot queue from two tabs, but can retry after disconnect", async () => {
  const productStore = new MemoryProductStore();
  const user = await productStore.createUser({ displayName: "玩家甲" });
  const manager = new RoomManager({ productStore, sendMessage: () => {} });
  const first = matchmakingSocket(user.id);
  const second = matchmakingSocket(user.id);
  try {
    await manager.enqueueMatchmaking(first, matchmake);
    const ticket = first.matchmakingTicketId;
    assert.ok(ticket);
    await assert.rejects(manager.enqueueMatchmaking(second, matchmake), /佇列/);
    await assert.rejects(
      manager.cancelMatchmaking(second, ticket),
      /其他連線/,
    );
    assert.equal(first.matchmakingTicketId, ticket);
    assert.equal(manager.matchmaking.size, 1);
    await manager.detach(first);
    assert.equal(manager.matchmaking.size, 0);
    await manager.enqueueMatchmaking(second, matchmake);
    assert.ok(second.matchmakingTicketId);
  } finally {
    await manager.closeAll();
  }
});

void test("closing a connection before queue admission leaves no ticket", async () => {
  const productStore = new MemoryProductStore();
  const user = await productStore.createUser({ displayName: "玩家甲" });
  const manager = new RoomManager({ productStore, sendMessage: () => {} });
  const socket = matchmakingSocket(user.id);
  try {
    const pending = manager.enqueueMatchmaking(socket, matchmake);
    Object.assign(socket, { readyState: WebSocket.CLOSED });
    await assert.rejects(pending, /連線已中斷/);
    assert.equal(manager.matchmaking.size, 0);
  } finally {
    await manager.closeAll();
  }
});

void test("disconnect at match time releases both tickets for retry", async () => {
  const productStore = new MemoryProductStore();
  const firstUser = await productStore.createUser({ displayName: "玩家甲" });
  const secondUser = await productStore.createUser({ displayName: "玩家乙" });
  const first = matchmakingSocket(firstUser.id);
  const second = matchmakingSocket(secondUser.id);
  const messages: Array<{ status?: string }> = [];
  class DisconnectingQueue extends MatchmakingQueue {
    override enqueue(input: Parameters<MatchmakingQueue["enqueue"]>[0]) {
      const result = super.enqueue(input);
      if (result.match) Object.assign(first, { readyState: WebSocket.CLOSED });
      return result;
    }
  }
  const manager = new RoomManager({
    productStore,
    matchmaking: new DisconnectingQueue(),
    sendMessage: (socket, data) => {
      if (socket === second) messages.push(data as { status?: string });
    },
  });
  try {
    await manager.enqueueMatchmaking(first, matchmake);
    await assert.rejects(
      manager.enqueueMatchmaking(second, matchmake),
      /對手已離線/,
    );
    assert.equal(manager.matchmaking.size, 0);
    assert.equal(first.matchmakingTicketId, null);
    assert.equal(second.matchmakingTicketId, null);
    assert.ok(messages.some((message) => message.status === "cancelled"));
    await manager.enqueueMatchmaking(second, matchmake);
    assert.ok(second.matchmakingTicketId);
  } finally {
    await manager.closeAll();
  }
});

void test("disconnect while saving a match aborts it and leaves no room", async () => {
  let savingStarted!: () => void;
  let finishSaving!: () => void;
  const saving = new Promise<void>((resolve) => {
    savingStarted = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    finishSaving = resolve;
  });
  class DelayedRoomStore extends MemoryRoomStore {
    override async create(snapshot: RoomSnapshot): Promise<void> {
      savingStarted();
      await resume;
      await super.create(snapshot);
    }
  }
  const store = new DelayedRoomStore();
  const productStore = new MemoryProductStore();
  const firstUser = await productStore.createUser({ displayName: "玩家甲" });
  const secondUser = await productStore.createUser({ displayName: "玩家乙" });
  const first = matchmakingSocket(firstUser.id);
  const second = matchmakingSocket(secondUser.id);
  const manager = new RoomManager({
    store,
    productStore,
    sendMessage: () => {},
  });
  try {
    await manager.enqueueMatchmaking(first, matchmake);
    const matching = manager.enqueueMatchmaking(second, matchmake);
    await saving;
    Object.assign(first, { readyState: WebSocket.CLOSED });
    finishSaving();
    await assert.rejects(matching, /對手已離線/);
    assert.equal(manager.matchmaking.size, 0);
    assert.equal(manager.rooms.size, 0);
    assert.equal(first.matchmakingTicketId, null);
    assert.equal(second.matchmakingTicketId, null);
    assert.deepEqual(await store.load(Date.now()), []);
    const history = await productStore.listMatchesForUser({ userId: firstUser.id });
    assert.equal(history.total, 1);
    assert.equal(history.matches[0]?.status, "aborted");
    await manager.enqueueMatchmaking(second, matchmake);
    assert.ok(second.matchmakingTicketId);
  } finally {
    finishSaving();
    await manager.closeAll();
  }
});

void test("expired matchmaking tickets notify players and free the queue", async () => {
  let now = 1_700_000_000_000;
  const productStore = new MemoryProductStore();
  const user = await productStore.createUser({ displayName: "玩家甲" });
  const socket = matchmakingSocket(user.id);
  const statuses: string[] = [];
  const manager = new RoomManager({
    productStore,
    now: () => now,
    sendMessage: (_socket, data) => {
      const status = (data as { status?: string }).status;
      if (status) statuses.push(status);
    },
  });
  try {
    await manager.enqueueMatchmaking(socket, matchmake);
    now += MATCHMAKING_TICKET_TTL_MS;
    await manager.pruneInactive(now);
    assert.equal(manager.matchmaking.size, 0);
    assert.equal(socket.matchmakingTicketId, null);
    assert.deepEqual(statuses, ["waiting", "expired"]);
    await manager.enqueueMatchmaking(socket, matchmake);
    assert.ok(socket.matchmakingTicketId);
  } finally {
    await manager.closeAll();
  }
});

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
