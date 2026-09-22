import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import { createSessionToken } from "../src/server/product-security.js";
import { PostgresProductStore } from "../src/server/postgres-product-store.js";

const databaseUrl = process.env.QIJU_TEST_DATABASE_URL;

if (!databaseUrl) {
  void test(
    "PostgreSQL product foundation persists identity and matches",
    { skip: "未設定 QIJU_TEST_DATABASE_URL" },
    () => {},
  );
} else {
  void test("PostgreSQL product foundation persists identity and matches", async (t) => {
    const store = new PostgresProductStore({ connectionString: databaseUrl });
    const cleanup = new Pool({ connectionString: databaseUrl });
    const userId = randomUUID();
    const matchId = randomUUID();
    const secondMatchId = randomUUID();
    const token = createSessionToken();

    t.after(async () => {
      await store.close();
      await cleanup.query("DELETE FROM qiju_matches WHERE id = $1", [matchId]);
      await cleanup.query("DELETE FROM qiju_matches WHERE id = $1", [
        secondMatchId,
      ]);
      await cleanup.query("DELETE FROM qiju_users WHERE id = $1", [userId]);
      await cleanup.end();
    });

    await store.initialize();
    const user = await store.createUser({
      id: userId,
      displayName: "資料庫玩家",
      createdAt: 1_700_000_000_000,
    });
    const session = await store.createSession({
      userId: user.id,
      token,
      createdAt: 1_700_000_000_001,
      expiresAt: 1_700_000_100_000,
    });
    assert.equal((await store.getUserPreferences(user.id)).theme, "system");
    const preferences = await store.updateUserPreferences(user.id, {
      theme: "dark",
      soundEnabled: false,
    });
    assert.equal(preferences.theme, "dark");
    assert.equal(preferences.soundEnabled, false);
    assert.notEqual(session.tokenHash, token);
    assert.equal(
      (await store.findActiveSession(token, 1_700_000_000_002))?.userId,
      user.id,
    );

    const match = await store.createMatch({
      id: matchId,
      roomCode: "DB1234",
      game: "chess",
      mode: "friend",
      startedAt: 1_700_000_000_003,
    });
    await store.addMatchParticipant({
      matchId: match.id,
      seat: 0,
      userId: user.id,
      displayName: user.displayName,
      bot: false,
      joinedAt: 1_700_000_000_004,
    });
    await store.appendMatchEvent({
      matchId: match.id,
      sequence: 1,
      eventType: "board.move",
      actorSeat: 0,
      payload: { ply: 1, move: { from: 52, to: 36 } },
      createdAt: 1_700_000_000_005,
    });
    const completed = await store.completeMatch({
      matchId: match.id,
      outcome: { winnerSeat: 0, reason: "將死" },
      completedAt: 1_700_000_000_006,
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.participants[0]?.result, "win");
    assert.equal((await store.listMatchEvents(match.id)).length, 1);

    const secondMatch = await store.createMatch({
      id: secondMatchId,
      roomCode: "DB5678",
      game: "gomoku",
      mode: "friend",
      startedAt: 1_700_000_000_103,
    });
    await store.addMatchParticipant({
      matchId: secondMatch.id,
      seat: 0,
      userId: user.id,
      displayName: user.displayName,
      bot: false,
    });
    await store.addMatchParticipant({
      matchId: secondMatch.id,
      seat: 1,
      displayName: "另一位玩家",
      bot: false,
    });
    await store.completeMatch({
      matchId: secondMatch.id,
      outcome: { winnerSeat: 1, reason: "五連線" },
      completedAt: 1_700_000_000_104,
    });
    const history = await store.listMatchesForUser({
      userId: user.id,
      result: "loss",
      pageSize: 1,
    });
    assert.equal(history.total, 1);
    assert.equal(history.matches[0]?.id, secondMatch.id);
    const stats = await store.getUserMatchStats(user.id);
    assert.deepEqual(
      {
        completed: stats.completed,
        wins: stats.wins,
        losses: stats.losses,
        draws: stats.draws,
      },
      { completed: 2, wins: 1, losses: 1, draws: 0 },
    );
    assert.equal(await store.revokeSession(token, 1_700_000_000_007), true);
    assert.equal(await store.findActiveSession(token, 1_700_000_000_008), null);
  });
}
