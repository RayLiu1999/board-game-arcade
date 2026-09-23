import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";

import { createServer } from "../src/server/server.js";

const closeServer = (server: ReturnType<typeof createServer>["server"]) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const portOf = (server: ReturnType<typeof createServer>["server"]): number => {
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("伺服器尚未監聽");
  return address.port;
};

const socketInbox = (
  socket: WebSocket,
): { next: () => Promise<Record<string, unknown>> } => {
  const queue: Record<string, unknown>[] = [];
  const pending: Array<(message: Record<string, unknown>) => void> = [];
  socket.on("message", (raw: string | Buffer) => {
    const message = JSON.parse(String(raw)) as Record<string, unknown>;
    const resolve = pending.shift();
    if (resolve) resolve(message);
    else queue.push(message);
  });
  return {
    next: () => {
      const message = queue.shift();
      if (message) return Promise.resolve(message);
      return new Promise((resolve) => pending.push(resolve));
    },
  };
};

void test("product HTTP supports guest profile, preferences, history, and stats", async (t) => {
  const bundle = createServer();
  await bundle.ready;
  bundle.server.listen(0, "127.0.0.1");
  await once(bundle.server, "listening");
  const base = `http://127.0.0.1:${String(portOf(bundle.server))}`;
  t.after(async () => {
    for (const socket of bundle.wss.clients) socket.terminate();
    await closeServer(bundle.server);
  });

  const created = await fetch(`${base}/api/guest-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "歷史玩家" }),
  });
  assert.equal(created.status, 201);
  const cookieHeader = created.headers.get("set-cookie");
  if (!cookieHeader) throw new Error("缺少 session cookie");
  const cookie = cookieHeader.split(";", 1)[0] ?? "";
  if (!cookie) throw new Error("session cookie 格式錯誤");
  const identity = (await created.json()) as {
    user: { id: string; displayName: string };
    preferences: { theme: string };
  };
  assert.equal(identity.user.displayName, "歷史玩家");
  assert.equal(identity.preferences.theme, "system");

  const me = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.equal(
    ((await me.json()) as { user: { id: string } }).user.id,
    identity.user.id,
  );

  const updated = await fetch(`${base}/api/me`, {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      theme: "dark",
      soundEnabled: false,
      historyPublic: true,
    }),
  });
  assert.equal(updated.status, 200);
  const updatedPayload = (await updated.json()) as {
    preferences: {
      userId: string;
      locale: string;
      theme: string;
      soundEnabled: boolean;
      historyPublic: boolean;
      friendInvites: boolean;
      showOnlineStatus: boolean;
      showInLeaderboard: boolean;
      updatedAt: number;
    };
  };
  assert.deepEqual(updatedPayload.preferences, {
    userId: identity.user.id,
    locale: "zh-Hant",
    theme: "dark",
    soundEnabled: false,
    historyPublic: true,
    friendInvites: true,
    showOnlineStatus: false,
    showInLeaderboard: false,
    updatedAt: updatedPayload.preferences.updatedAt,
  });

  const first = await bundle.productStore.createMatch({
    roomCode: "HIST01",
    game: "gomoku",
    mode: "friend",
    startedAt: 1_700_000_000_000,
  });
  await bundle.productStore.addMatchParticipant({
    matchId: first.id,
    seat: 0,
    userId: identity.user.id,
    displayName: "歷史玩家",
    bot: false,
  });
  await bundle.productStore.addMatchParticipant({
    matchId: first.id,
    seat: 1,
    displayName: "對手",
    bot: false,
  });
  await bundle.productStore.completeMatch({
    matchId: first.id,
    outcome: { winnerSeat: 0, reason: "五連線" },
    completedAt: 1_700_000_000_100,
  });
  const second = await bundle.productStore.createMatch({
    roomCode: "HIST02",
    game: "chess",
    mode: "friend",
    startedAt: 1_700_000_001_000,
  });
  await bundle.productStore.addMatchParticipant({
    matchId: second.id,
    seat: 0,
    userId: identity.user.id,
    displayName: "歷史玩家",
    bot: false,
  });
  await bundle.productStore.addMatchParticipant({
    matchId: second.id,
    seat: 1,
    displayName: "另一位對手",
    bot: false,
  });
  await bundle.productStore.completeMatch({
    matchId: second.id,
    outcome: { winnerSeat: 1, reason: "將死" },
    completedAt: 1_700_000_001_100,
  });

  const history = await fetch(`${base}/api/me/matches?pageSize=1&game=gomoku`, {
    headers: { Cookie: cookie },
  });
  assert.equal(history.status, 200);
  const historyPayload = (await history.json()) as {
    total: number;
    hasNext: boolean;
    matches: Array<{
      id: string;
      result: string;
      participants: Array<Record<string, unknown>>;
    }>;
  };
  assert.equal(historyPayload.total, 1);
  assert.equal(historyPayload.hasNext, false);
  const historyMatch = historyPayload.matches[0];
  assert.ok(historyMatch);
  assert.equal(historyMatch.result, "win");
  const historyParticipant = historyMatch.participants[0];
  assert.ok(historyParticipant);
  assert.equal("userId" in historyParticipant, false);

  const stats = await fetch(`${base}/api/me/stats`, {
    headers: { Cookie: cookie },
  });
  assert.equal(stats.status, 200);
  assert.deepEqual(await stats.json(), {
    completed: 2,
    wins: 1,
    losses: 1,
    draws: 0,
    byGame: [
      { game: "chess", completed: 1, wins: 0, losses: 1, draws: 0 },
      { game: "gomoku", completed: 1, wins: 1, losses: 0, draws: 0 },
    ],
  });

  const ratings = await fetch(`${base}/api/me/ratings`, {
    headers: { Cookie: cookie },
  });
  assert.equal(ratings.status, 200);
  assert.deepEqual(await ratings.json(), { ratings: [] });

  const websocketUrl = base.replace("http:", "ws:");
  const authenticatedSocket = new WebSocket(websocketUrl, {
    headers: { Cookie: cookie },
  });
  await once(authenticatedSocket, "open");
  const authenticatedInbox = socketInbox(authenticatedSocket);
  authenticatedSocket.send(JSON.stringify({ type: "create", game: "go" }));
  const authenticatedJoined = await authenticatedInbox.next();
  assert.equal(authenticatedJoined.type, "joined");
  await authenticatedInbox.next();
  const authenticatedRoom = bundle.rooms.get(
    authenticatedJoined.code as string,
  );
  assert.ok(authenticatedRoom?.matchId);
  const authenticatedMatch = await bundle.productStore.getMatch(
    authenticatedRoom.matchId,
  );
  assert.equal(authenticatedMatch?.participants[0]?.userId, identity.user.id);

  const anonymousSocket = new WebSocket(websocketUrl);
  await once(anonymousSocket, "open");
  const anonymousInbox = socketInbox(anonymousSocket);
  anonymousSocket.send(JSON.stringify({ type: "create", game: "go" }));
  const anonymousJoined = await anonymousInbox.next();
  assert.equal(anonymousJoined.type, "joined");
  await anonymousInbox.next();
  const claimed = await fetch(`${base}/api/me/claim-room`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      code: anonymousJoined.code,
      token: anonymousJoined.token,
    }),
  });
  assert.equal(claimed.status, 200);
  const claimedRoom = bundle.rooms.get(anonymousJoined.code as string);
  assert.ok(claimedRoom);
  assert.equal(claimedRoom.players[0]?.userId, identity.user.id);
  assert.ok(claimedRoom.matchId);
  const claimedMatch = await bundle.productStore.getMatch(claimedRoom.matchId);
  assert.equal(claimedMatch?.participants[0]?.userId, identity.user.id);
  authenticatedSocket.terminate();
  anonymousSocket.terminate();

  const logout = await fetch(`${base}/api/session`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  assert.equal(logout.status, 204);
  const afterLogout = await fetch(`${base}/api/me`, {
    headers: { Cookie: cookie },
  });
  assert.equal(afterLogout.status, 401);
});

void test("account upgrade and login restore the existing guest player", async (t) => {
  const bundle = createServer();
  await bundle.ready;
  bundle.server.listen(0, "127.0.0.1");
  await once(bundle.server, "listening");
  const base = `http://127.0.0.1:${String(portOf(bundle.server))}`;
  t.after(async () => {
    for (const socket of bundle.wss.clients) socket.terminate();
    await closeServer(bundle.server);
  });

  const created = await fetch(`${base}/api/guest-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "跨裝置玩家" }),
  });
  assert.equal(created.status, 201);
  const firstCookie = created.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(firstCookie);
  const guest = (await created.json()) as {
    user: { id: string; publicCode: string };
  };

  const upgrade = await fetch(`${base}/api/account/upgrade`, {
    method: "POST",
    headers: {
      Cookie: firstCookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      loginName: "Player_01",
      password: "correct horse battery staple",
    }),
  });
  assert.equal(upgrade.status, 200);
  const upgraded = (await upgrade.json()) as {
    user: Record<string, unknown>;
  };
  assert.equal(upgraded.user.id, guest.user.id);
  assert.equal(upgraded.user.publicCode, guest.user.publicCode);
  assert.equal(upgraded.user.loginName, "player_01");
  assert.equal(upgraded.user.hasAccount, true);
  assert.equal("passwordHash" in upgraded.user, false);

  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      loginName: "PLAYER_01",
      password: "correct horse battery staple",
    }),
  });
  assert.equal(login.status, 200);
  const secondCookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(secondCookie);
  const restored = await fetch(`${base}/api/me/profile`, {
    headers: { Cookie: secondCookie },
  });
  assert.equal(restored.status, 200);
  const profile = (await restored.json()) as {
    user: {
      id: string;
      publicCode: string;
      loginName: string;
      hasAccount: boolean;
      displayName: string;
    };
  };
  assert.equal(profile.user.id, guest.user.id);
  assert.equal(profile.user.publicCode, guest.user.publicCode);
  assert.equal(profile.user.loginName, "player_01");
  assert.equal(profile.user.hasAccount, true);
  assert.equal(profile.user.displayName, "跨裝置玩家");
});

void test("friend room invitations authorize only the invited player to take a seat", async (t) => {
  const bundle = createServer();
  await bundle.ready;
  bundle.server.listen(0, "127.0.0.1");
  await once(bundle.server, "listening");
  const base = `http://127.0.0.1:${String(portOf(bundle.server))}`;
  t.after(async () => {
    for (const socket of bundle.wss.clients) socket.terminate();
    await closeServer(bundle.server);
  });

  const createGuest = async (displayName: string) => {
    const response = await fetch(`${base}/api/guest-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    });
    assert.equal(response.status, 201);
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);
    const payload = (await response.json()) as {
      user: { id: string; publicCode: string };
    };
    return { cookie, user: payload.user };
  };

  const inviter = await createGuest("房主");
  const recipient = await createGuest("好友");
  const friendRequest = await bundle.productStore.sendFriendRequest(
    inviter.user.id,
    recipient.user.publicCode,
  );
  await bundle.productStore.respondToFriendRequest(
    recipient.user.id,
    friendRequest.id,
    "accept",
  );

  const websocketUrl = base.replace("http:", "ws:");
  const inviterSocket = new WebSocket(websocketUrl, {
    headers: { Cookie: inviter.cookie },
  });
  await once(inviterSocket, "open");
  const inviterInbox = socketInbox(inviterSocket);
  inviterSocket.send(JSON.stringify({ type: "create", game: "chess" }));
  const inviterJoined = await inviterInbox.next();
  assert.equal(inviterJoined.type, "joined");
  await inviterInbox.next();

  const createdInvite = await fetch(`${base}/api/me/room-invites`, {
    method: "POST",
    headers: {
      Cookie: inviter.cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      roomCode: inviterJoined.code,
      friendUserId: recipient.user.id,
    }),
  });
  assert.equal(createdInvite.status, 201);
  const invitation = (await createdInvite.json()) as {
    id: string;
    roomCode: string;
  };

  const accepted = await fetch(
    `${base}/api/me/room-invites/${encodeURIComponent(invitation.id)}/accept`,
    {
      method: "POST",
      headers: { Cookie: recipient.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  assert.equal(accepted.status, 200);
  const grant = (await accepted.json()) as {
    entryToken: string;
    roomCode: string;
  };

  const recipientSocket = new WebSocket(websocketUrl, {
    headers: { Cookie: recipient.cookie },
  });
  await once(recipientSocket, "open");
  const recipientInbox = socketInbox(recipientSocket);
  recipientSocket.send(
    JSON.stringify({
      type: "join",
      code: grant.roomCode,
      invitationId: invitation.id,
      invitationToken: grant.entryToken,
    }),
  );
  const recipientJoined = await recipientInbox.next();
  assert.equal(recipientJoined.type, "joined");
  await recipientInbox.next();

  const room = bundle.rooms.get(invitation.roomCode);
  assert.ok(room);
  assert.equal(
    room.players.some((player) => player?.userId === recipient.user.id),
    true,
  );
  inviterSocket.terminate();
  recipientSocket.terminate();
});
