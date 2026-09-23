import test from "node:test";
import assert from "node:assert/strict";

import {
  MATCH_EVENT_SCHEMA_VERSION,
  MemoryProductStore,
  ProductStoreConflictError,
  ROOM_INVITATION_TTL_MS,
} from "../src/server/product-store.js";
import {
  InvalidCredentialsError,
  ProductIdentityService,
} from "../src/server/product-identity.js";

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

void test("guest account upgrade and login preserve the same player identity", async () => {
  let now = 1_700_000_000_000;
  const store = new MemoryProductStore();
  const identity = new ProductIdentityService(store, store, () => now);
  const guest = await identity.createGuestIdentity("訪客玩家");

  const upgraded = await identity.upgradeAccount(
    guest.user.id,
    "Alice_01",
    "correct horse battery staple",
  );
  assert.equal(upgraded.id, guest.user.id);
  assert.equal(upgraded.loginName, "alice_01");
  assert.equal(upgraded.publicCode, guest.user.publicCode);

  await assert.rejects(
    identity.login("alice_01", "wrong password", "127.0.0.1"),
    InvalidCredentialsError,
  );
  now += 1000;
  const recovered = await identity.login(
    "ALICE_01",
    "correct horse battery staple",
    "127.0.0.1",
  );
  assert.equal(recovered.user.id, guest.user.id);
  assert.notEqual(recovered.token, guest.token);
  assert.equal(
    (await identity.authenticate(recovered.token))?.user.id,
    guest.user.id,
  );
});

void test("friend privacy, online leases, leaderboard consent, and room invite grants are enforced", async () => {
  const now = Date.now();
  const store = new MemoryProductStore();
  const inviter = await store.createUser({
    displayName: "邀請者",
    createdAt: now,
  });
  const recipient = await store.createUser({
    displayName: "受邀者",
    createdAt: now,
  });

  const request = await store.sendFriendRequest(
    inviter.id,
    recipient.publicCode,
    now,
  );
  await store.respondToFriendRequest(recipient.id, request.id, "accept", now);

  let recipientView = await store.getSocialOverview(inviter.id);
  assert.equal(recipientView.friendCode, inviter.publicCode);
  assert.equal(recipientView.friends[0]?.online, null);
  await store.updateUserPreferences(
    recipient.id,
    { showOnlineStatus: true },
    now,
  );
  await store.touchPresence("friend-socket", recipient.id, now, now + 10_000);
  recipientView = await store.getSocialOverview(inviter.id);
  assert.equal(recipientView.friends[0]?.online, true);
  await store.removePresence("friend-socket");
  recipientView = await store.getSocialOverview(inviter.id);
  assert.equal(recipientView.friends[0]?.online, false);

  const ratedMatch = await store.createMatch({
    roomCode: "RATE01",
    game: "gomoku",
    mode: "rated",
    startedAt: now,
  });
  await store.addMatchParticipant({
    matchId: ratedMatch.id,
    seat: 0,
    userId: inviter.id,
    displayName: inviter.displayName,
    bot: false,
  });
  await store.addMatchParticipant({
    matchId: ratedMatch.id,
    seat: 1,
    userId: recipient.id,
    displayName: recipient.displayName,
    bot: false,
  });
  await store.completeMatch({
    matchId: ratedMatch.id,
    outcome: { winnerSeat: 0, reason: "五連線" },
    completedAt: now + 100,
  });
  assert.equal((await store.getLeaderboard("gomoku")).length, 0);
  await store.updateUserPreferences(
    inviter.id,
    { showInLeaderboard: true },
    now + 200,
  );
  const leaderboard = await store.getLeaderboard("gomoku");
  assert.equal(leaderboard.length, 1);
  assert.equal(leaderboard[0]?.publicCode, inviter.publicCode);

  const invitation = await store.createRoomInvitation(
    {
      roomCode: "ROOM01",
      game: "chess",
      inviterId: inviter.id,
      recipientId: recipient.id,
    },
    now,
  );
  assert.equal(invitation.expiresAt, now + ROOM_INVITATION_TTL_MS);
  const accepted = await store.acceptRoomInvitation(
    recipient.id,
    invitation.id,
    now + 100,
  );
  await assert.rejects(
    store.consumeRoomInvitation(
      inviter.id,
      invitation.id,
      invitation.roomCode,
      accepted.entryToken,
      now + 200,
    ),
    ProductStoreConflictError,
  );
  await assert.rejects(
    store.consumeRoomInvitation(
      recipient.id,
      invitation.id,
      invitation.roomCode,
      `${accepted.entryToken}wrong`,
      now + 200,
    ),
    ProductStoreConflictError,
  );
  await store.consumeRoomInvitation(
    recipient.id,
    invitation.id,
    invitation.roomCode,
    accepted.entryToken,
    now + 200,
  );
  await store.consumeRoomInvitation(
    recipient.id,
    invitation.id,
    invitation.roomCode,
    accepted.entryToken,
    now + 300,
  );
  assert.deepEqual(
    await store.listRoomInvitations(recipient.id, now + 300),
    [],
  );

  const expiryTime = now + 1000;
  const expiringInvitation = await store.createRoomInvitation(
    {
      roomCode: "ROOM02",
      game: "chess",
      inviterId: inviter.id,
      recipientId: recipient.id,
    },
    expiryTime,
  );
  const replacementInvitation = await store.createRoomInvitation(
    {
      roomCode: "ROOM02",
      game: "chess",
      inviterId: inviter.id,
      recipientId: recipient.id,
    },
    expiryTime + ROOM_INVITATION_TTL_MS + 1,
  );
  assert.notEqual(replacementInvitation.id, expiringInvitation.id);
  await store.rejectRoomInvitation(
    recipient.id,
    replacementInvitation.id,
    expiryTime + ROOM_INVITATION_TTL_MS + 2,
  );
  assert.deepEqual(
    await store.listRoomInvitations(
      recipient.id,
      expiryTime + ROOM_INVITATION_TTL_MS + 2,
    ),
    [],
  );
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
