import test from "node:test";
import assert from "node:assert/strict";

import {
  MATCH_EVENT_SCHEMA_VERSION,
  MemoryProductStore,
  ProductStoreConflictError,
} from "../src/server/product-store.js";
import { ProductIdentityService } from "../src/server/product-identity.js";

void test("identity sessions are hashed, expirable, and revocable", async () => {
  let now = 1_700_000_000_000;
  const store = new MemoryProductStore();
  const identity = new ProductIdentityService(store, store, () => now);

  const created = await identity.createGuestIdentity("甲");
  assert.notEqual(created.session.tokenHash, created.token);
  assert.equal(
    (await identity.authenticate(created.token))?.user.id,
    created.user.id,
  );

  now += 30 * 24 * 60 * 60 * 1000 + 1;
  assert.equal(await identity.authenticate(created.token), null);
  assert.equal(await identity.revoke(created.token), true);
});

void test("match events and completion are idempotent but reject conflicts", async () => {
  const store = new MemoryProductStore();
  const match = await store.createMatch({
    roomCode: "ABC123",
    game: "gomoku",
    mode: "friend",
    startedAt: 1_700_000_000_000,
  });
  await store.addMatchParticipant({
    matchId: match.id,
    seat: 0,
    displayName: "甲",
    bot: false,
  });
  await store.addMatchParticipant({
    matchId: match.id,
    seat: 1,
    displayName: "乙",
    bot: false,
  });

  const event = await store.appendMatchEvent({
    matchId: match.id,
    sequence: 1,
    eventType: "board.move",
    actorSeat: 0,
    payload: { ply: 1, move: { to: 112 } },
    createdAt: 1_700_000_000_001,
  });
  const duplicate = await store.appendMatchEvent({
    ...event,
    createdAt: event.createdAt + 100,
  });
  assert.deepEqual(duplicate, event);
  await assert.rejects(
    store.appendMatchEvent({
      ...event,
      payload: { ply: 1, move: { to: 113 } },
    }),
    ProductStoreConflictError,
  );

  const outcome = { winnerSeat: 0, reason: "五連線" } as const;
  const completed = await store.completeMatch({
    matchId: match.id,
    outcome,
    completedAt: 1_700_000_000_010,
  });
  const retried = await store.completeMatch({
    matchId: match.id,
    outcome,
    completedAt: 1_700_000_000_020,
  });
  assert.equal(completed.status, "completed");
  assert.deepEqual(retried.outcome, outcome);
  assert.equal(retried.participants[0]?.result, "win");
  assert.equal(retried.participants[1]?.result, "loss");
  assert.equal(
    (await store.listMatchEvents(match.id))[0]?.schemaVersion,
    MATCH_EVENT_SCHEMA_VERSION,
  );
});
