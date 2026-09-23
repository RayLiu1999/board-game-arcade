import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import { createSessionToken } from "../src/server/product-security.js";
import { ProductIdentityService } from "../src/server/product-identity.js";
import { PostgresProductStore } from "../src/server/postgres-product-store.js";
import { PostgresRoomStore } from "../src/server/postgres-room-store.js";
import { createGame } from "../src/shared/engine.js";
import { ROOM_INVITATION_TTL_MS } from "../src/server/product-store.js";
import { ROOM_TTL_MS, type RoomSnapshot } from "../src/server/room-store.js";

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
    const roomStore = new PostgresRoomStore({ connectionString: databaseUrl });
    const cleanup = new Pool({ connectionString: databaseUrl });
    const userId = randomUUID();
    const opponentId = randomUUID();
    const matchId = randomUUID();
    const secondMatchId = randomUUID();
    const ratedMatchId = randomUUID();
    const token = createSessionToken();
    const inviteRoomCode = "SOC123";

    t.after(async () => {
      await roomStore.delete(inviteRoomCode).catch(() => {});
      await roomStore.close();
      await store.close();
      await cleanup.query("DELETE FROM qiju_matches WHERE id = $1", [matchId]);
      await cleanup.query("DELETE FROM qiju_matches WHERE id = $1", [
        secondMatchId,
      ]);
      await cleanup.query("DELETE FROM qiju_matches WHERE id = $1", [
        ratedMatchId,
      ]);
      await cleanup.query("DELETE FROM qiju_users WHERE id = $1", [userId]);
      await cleanup.query("DELETE FROM qiju_users WHERE id = $1", [opponentId]);
      await cleanup.end();
    });

    await store.initialize();
    await roomStore.initialize();
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
          "qiju_friend_requests",
          "qiju_friendships",
          "qiju_match_events",
          "qiju_match_participants",
          "qiju_matches",
          "qiju_rating_results",
          "qiju_ratings",
          "qiju_room_invites",
          "qiju_room_players",
          "qiju_rooms",
          "qiju_sessions",
          "qiju_user_blocks",
          "qiju_user_preferences",
          "qiju_user_presence",
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
        table_name: "qiju_friend_requests",
        description:
          "棋聚玩家之間的好友邀請與處理狀態；一列代表一筆單向邀請及其終態。",
      },
      {
        table_name: "qiju_friendships",
        description:
          "棋聚已接受的雙向好友關係；一列代表依 UUID 排序保存的一對好友。",
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
        table_name: "qiju_rating_results",
        description:
          "棋聚 rated 對局的不可重複評分結算明細；一列代表一名參與者在一局中的分數變化。",
      },
      {
        table_name: "qiju_ratings",
        description:
          "棋聚玩家依棋種保存的目前 rated 評分與戰績摘要；一列代表一名玩家在一個棋種的評分。",
      },
      {
        table_name: "qiju_room_invites",
        description:
          "好友加入指定私人房間的短期授權；每列代表一位邀請對象的一次邀請。",
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
        table_name: "qiju_user_blocks",
        description:
          "棋聚玩家封鎖關係；一列代表 blocker 不接受 blocked_user 的好友邀請。",
      },
      {
        table_name: "qiju_user_preferences",
        description: "棋聚玩家的個人偏好設定。",
      },
      {
        table_name: "qiju_user_presence",
        description:
          "玩家即時連線租約；每列代表一條已驗證的 WebSocket 連線，過期即視為離線。",
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
          "qiju_friend_requests",
          "qiju_friendships",
          "qiju_match_events",
          "qiju_match_participants",
          "qiju_matches",
          "qiju_rating_results",
          "qiju_ratings",
          "qiju_room_invites",
          "qiju_room_players",
          "qiju_rooms",
          "qiju_sessions",
          "qiju_user_blocks",
          "qiju_user_preferences",
          "qiju_user_presence",
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
    const opponent = await store.createUser({
      id: opponentId,
      displayName: "資料庫對手",
      createdAt: 1_700_000_000_001,
    });
    const identity = new ProductIdentityService(store, store);
    const loginName = `test_${user.id.replaceAll("-", "").slice(0, 12)}`;
    const upgradedUser = await identity.upgradeAccount(
      user.id,
      loginName,
      "correct horse battery staple",
    );
    assert.equal(upgradedUser.id, user.id);
    const recovered = await identity.login(
      loginName,
      "correct horse battery staple",
      "127.0.0.1",
    );
    assert.equal(recovered.user.id, user.id);
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
      mode: "public",
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
    const ratedMatch = await store.createMatch({
      id: ratedMatchId,
      roomCode: "RATE01",
      game: "gomoku",
      mode: "rated",
      startedAt: 1_700_000_000_200,
    });
    await store.addMatchParticipant({
      matchId: ratedMatch.id,
      seat: 0,
      userId: user.id,
      displayName: user.displayName,
      bot: false,
    });
    await store.addMatchParticipant({
      matchId: ratedMatch.id,
      seat: 1,
      userId: opponent.id,
      displayName: opponent.displayName,
      bot: false,
    });
    await store.completeMatch({
      matchId: ratedMatch.id,
      outcome: { winnerSeat: 0, reason: "五連線" },
      completedAt: 1_700_000_000_201,
    });
    const rated = await store.getUserRating(user.id, "gomoku");
    assert.equal(rated.rating, 1520);
    assert.equal(rated.gamesPlayed, 1);
    assert.equal((await store.getUserRatings(user.id)).length, 1);
    await store.completeMatch({
      matchId: ratedMatch.id,
      outcome: { winnerSeat: 0, reason: "五連線" },
      completedAt: 1_700_000_000_202,
    });
    assert.equal((await store.getUserRating(user.id, "gomoku")).rating, 1520);

    const now = Date.now();
    const friendRequest = await store.sendFriendRequest(
      user.id,
      opponent.publicCode,
      now,
    );
    await store.respondToFriendRequest(
      opponent.id,
      friendRequest.id,
      "accept",
      now,
    );
    await store.updateUserPreferences(
      opponent.id,
      { showOnlineStatus: true },
      now,
    );
    const presenceId = randomUUID();
    await store.touchPresence(presenceId, opponent.id, now, now + 60_000);
    assert.equal(
      (await store.getSocialOverview(user.id)).friends[0]?.online,
      true,
    );
    await store.removePresence(presenceId);
    assert.equal(
      (await store.getSocialOverview(user.id)).friends[0]?.online,
      false,
    );

    await store.updateUserPreferences(
      user.id,
      { showInLeaderboard: true },
      now,
    );
    assert.equal(
      (await store.getLeaderboard("gomoku")).some(
        (entry) => entry.publicCode === user.publicCode,
      ),
      true,
    );

    const initialState = createGame("chess");
    if (initialState.game === "riichi") throw new Error("測試收到日麻狀態");
    const snapshot: RoomSnapshot = {
      code: inviteRoomCode,
      state: initialState,
      players: [null, null],
      rounds: 1,
      rematch: [],
      revision: 0,
      touched: now,
      expiresAt: now + ROOM_TTL_MS,
    };
    await roomStore.create(snapshot);
    const invitation = await store.createRoomInvitation(
      {
        roomCode: inviteRoomCode,
        game: "chess",
        inviterId: user.id,
        recipientId: opponent.id,
      },
      now,
    );
    const accepted = await store.acceptRoomInvitation(
      opponent.id,
      invitation.id,
      now + 100,
    );
    await store.consumeRoomInvitation(
      opponent.id,
      invitation.id,
      inviteRoomCode,
      accepted.entryToken,
      now + 200,
    );
    assert.deepEqual(
      await store.listRoomInvitations(opponent.id, now + 200),
      [],
    );
    const expiryTime = now + 1000;
    const expiringInvitation = await store.createRoomInvitation(
      {
        roomCode: inviteRoomCode,
        game: "chess",
        inviterId: user.id,
        recipientId: opponent.id,
      },
      expiryTime,
    );
    const replacementInvitation = await store.createRoomInvitation(
      {
        roomCode: inviteRoomCode,
        game: "chess",
        inviterId: user.id,
        recipientId: opponent.id,
      },
      expiryTime + ROOM_INVITATION_TTL_MS + 1,
    );
    assert.notEqual(replacementInvitation.id, expiringInvitation.id);
    await store.rejectRoomInvitation(
      opponent.id,
      replacementInvitation.id,
      expiryTime + ROOM_INVITATION_TTL_MS + 2,
    );
    assert.deepEqual(
      await store.listRoomInvitations(
        opponent.id,
        expiryTime + ROOM_INVITATION_TTL_MS + 2,
      ),
      [],
    );

    assert.equal(await store.revokeSession(token, 1_700_000_000_007), true);
    assert.equal(await store.findActiveSession(token, 1_700_000_000_008), null);
  });
}
