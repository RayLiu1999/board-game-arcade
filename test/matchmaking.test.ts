import test from "node:test";
import assert from "node:assert/strict";

import {
  INITIAL_MATCHMAKING_RATING_RANGE,
  MATCHMAKING_RATING_RANGE_STEP_MS,
  MatchmakingQueue,
  matchmakingRatingRange,
} from "../src/server/matchmaking.js";

const ticket = (
  overrides: Partial<Parameters<MatchmakingQueue["enqueue"]>[0]> = {},
) => ({
  userId: "user-a",
  displayName: "玩家甲",
  game: "gomoku" as const,
  mode: "rated" as const,
  timeControl: "unlimited" as const,
  rating: 1500,
  createdAt: 1_700_000_000_000,
  ...overrides,
});

void test("matchmaking rating range widens predictably", () => {
  assert.equal(matchmakingRatingRange(0), INITIAL_MATCHMAKING_RATING_RANGE);
  assert.equal(
    matchmakingRatingRange(MATCHMAKING_RATING_RANGE_STEP_MS),
    INITIAL_MATCHMAKING_RATING_RANGE + 100,
  );
});

void test("matchmaking pairs compatible rated tickets and keeps incompatible ones", () => {
  const queue = new MatchmakingQueue();
  const first = queue.enqueue(ticket());
  assert.equal(first.match, null);
  const incompatible = queue.enqueue(
    ticket({ userId: "user-b", displayName: "玩家乙", game: "chess" }),
  );
  assert.equal(incompatible.match, null);
  queue.enqueue(
    ticket({
      userId: "user-d",
      displayName: "玩家丁",
      createdAt: first.ticket.createdAt,
      rating: 1800,
    }),
  );
  const matched = queue.enqueue(
    ticket({ userId: "user-c", displayName: "玩家丙", rating: 1650 }),
  );
  assert.equal(matched.match?.userId, "user-a");
  assert.equal(queue.size, 2);
});

void test("casual matchmaking ignores rating but still separates mode and game", () => {
  const queue = new MatchmakingQueue();
  queue.enqueue(ticket({ userId: "user-a", mode: "casual", rating: null }));
  const matched = queue.enqueue(
    ticket({ userId: "user-b", mode: "casual", rating: null }),
  );
  assert.equal(matched.match?.userId, "user-a");
  queue.enqueue(ticket({ userId: "user-c" }));
  assert.throws(() => queue.enqueue(ticket({ userId: "user-c" })), /公開配對/);
});

void test("matchmaking tickets can be cancelled and expire", () => {
  const queue = new MatchmakingQueue();
  const createdAt = 1_700_000_000_000;
  const waiting = queue.enqueue(ticket({ createdAt }));
  assert.ok(queue.cancel(waiting.ticket.id, "user-a"));
  assert.equal(queue.size, 0);
  queue.enqueue(ticket({ createdAt, expiresAt: createdAt + 10 }));
  assert.equal(queue.expire(createdAt + 10).length, 1);
  assert.equal(queue.size, 0);
});
