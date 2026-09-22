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
    const comments = await cleanup.query<{
      table_name: string;
      description: string | null;
    }>(
      `
        SELECT
          c.relname AS table_name,
          obj_description(c.oid, 'pg_class') AS description
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema()
          AND c.relkind = 'r'
          AND c.relname = ANY($1::text[])
        ORDER BY c.relname
      `,
      [
        [
          "qiju_audit_log",
          "qiju_match_events",
          "qiju_match_participants",
          "qiju_matches",
          "qiju_room_players",
          "qiju_rooms",
          "qiju_sessions",
          "qiju_user_preferences",
          "qiju_users",
        ],
      ],
    );
    assert.deepEqual(comments.rows, [
      {
        table_name: "qiju_audit_log",
        description: "棋聚產品操作稽核紀錄。",
      },
      {
        table_name: "qiju_match_events",
        description: "棋聚對局事件流水，供稽核與必要的重建使用。",
      },
      {
        table_name: "qiju_match_participants",
        description: "棋聚對局參與者、座位與勝負結果。",
      },
      {
        table_name: "qiju_matches",
        description: "棋聚對局主檔與生命週期、結果摘要。",
      },
      {
        table_name: "qiju_room_players",
        description: "棋聚房間中的玩家座位、重連 token 雜湊與身份綁定。",
      },
      {
        table_name: "qiju_rooms",
        description: "棋聚進行中的遊戲房間與可恢復狀態。",
      },
      {
        table_name: "qiju_sessions",
        description: "棋聚玩家的登入／訪客 session，僅保存 token 雜湊。",
      },
      {
        table_name: "qiju_user_preferences",
        description: "棋聚玩家的個人偏好設定。",
      },
      {
        table_name: "qiju_users",
        description: "棋聚玩家身份與基本個人資料。",
      },
    ]);
    const missingColumnComments = await cleanup.query<{
      table_name: string;
      column_name: string;
    }>(
      `
        SELECT
          c.relname AS table_name,
          a.attname AS column_name
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        JOIN pg_attribute AS a ON a.attrelid = c.oid
        WHERE n.nspname = current_schema()
          AND c.relkind = 'r'
          AND c.relname = ANY($1::text[])
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND col_description(c.oid, a.attnum) IS NULL
        ORDER BY c.relname, a.attnum
      `,
      [
        [
          "qiju_audit_log",
          "qiju_match_events",
          "qiju_match_participants",
          "qiju_matches",
          "qiju_room_players",
          "qiju_rooms",
          "qiju_sessions",
          "qiju_user_preferences",
          "qiju_users",
        ],
      ],
    );
    assert.deepEqual(missingColumnComments.rows, []);
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
