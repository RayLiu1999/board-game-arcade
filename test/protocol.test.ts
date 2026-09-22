import test from "node:test";
import assert from "node:assert/strict";

import {
  CHAT_MAX_LENGTH,
  GAME_IDS,
  isBoardMove,
  isGameId,
  isPlayerSide,
  isRiichiSeat,
  parseClientMessage,
} from "../src/shared/protocol.js";

const register = (name: string, callback: () => void): void => {
  void test(name, callback);
};

const rejectsMessage = (value: unknown): void => {
  assert.throws(() => {
    parseClientMessage(value);
  });
};

register(
  "protocol guards accept valid game, side, seat and board move values",
  () => {
    for (const game of GAME_IDS) assert.equal(isGameId(game), true);
    assert.equal(isGameId("unknown"), false);
    assert.equal(isPlayerSide(1), true);
    assert.equal(isPlayerSide(-1), true);
    assert.equal(isPlayerSide(0), false);
    assert.equal(isRiichiSeat(0), true);
    assert.equal(isRiichiSeat(3), true);
    assert.equal(isRiichiSeat(4), false);
    assert.equal(isBoardMove({ from: 1, to: 2, promote: true }), true);
    assert.equal(isBoardMove({ pass: true }), true);
  },
);

register("protocol guards reject malformed board moves", () => {
  assert.equal(isBoardMove(null), false);
  assert.equal(isBoardMove({ to: "2" }), false);
  assert.equal(isBoardMove({ pass: "yes" }), false);
  assert.equal(isBoardMove({ promotion: 3 }), false);
});

register("protocol parser normalizes supported room and game commands", () => {
  assert.deepEqual(
    parseClientMessage({
      type: "create",
      game: "go",
      mode: "rated",
      size: 13,
      name: "甲",
      rounds: 0,
    }),
    {
      type: "create",
      game: "go",
      mode: "rated",
      size: 13,
      name: "甲",
      rounds: 0,
    },
  );
  assert.deepEqual(
    parseClientMessage({ type: "join", code: "ABC123", token: "secret" }),
    { type: "join", code: "ABC123", token: "secret" },
  );
  assert.deepEqual(
    parseClientMessage({ type: "move", ply: 4, move: { to: 40 } }),
    { type: "move", ply: 4, move: { to: 40 } },
  );
  assert.deepEqual(
    parseClientMessage({ type: "riichi-action", actionId: "3:0:2" }),
    { type: "riichi-action", actionId: "3:0:2" },
  );
  assert.deepEqual(parseClientMessage({ type: "chat", text: "  你好 🀄  " }), {
    type: "chat",
    text: "你好 🀄",
  });
  assert.deepEqual(parseClientMessage({ type: "dead", to: 40 }), {
    type: "dead",
    to: 40,
  });
  assert.deepEqual(
    parseClientMessage({
      type: "matchmake",
      game: "gomoku",
      mode: "rated",
      timeControl: "unlimited",
    }),
    {
      type: "matchmake",
      game: "gomoku",
      mode: "rated",
      timeControl: "unlimited",
    },
  );
  assert.deepEqual(
    parseClientMessage({ type: "matchmake-cancel", ticket: "ticket-1" }),
    { type: "matchmake-cancel", ticket: "ticket-1" },
  );
  assert.deepEqual(parseClientMessage({ type: "leave" }), { type: "leave" });
});

register("protocol parser rejects invalid messages at the boundary", () => {
  rejectsMessage(null);
  rejectsMessage({});
  rejectsMessage({ type: "create", game: "mahjong" });
  rejectsMessage({ type: "create", game: "go", mode: "ranked" });
  rejectsMessage({
    type: "matchmake",
    game: "riichi",
    mode: "rated",
    timeControl: "unlimited",
  });
  rejectsMessage({
    type: "matchmake",
    game: "go",
    mode: "ranked",
    timeControl: "unlimited",
  });
  rejectsMessage({ type: "matchmake-cancel", ticket: 3 });
  rejectsMessage({ type: "create", game: "go", rounds: "0" });
  rejectsMessage({ type: "join", code: 123 });
  rejectsMessage({ type: "move", ply: 0, move: { to: "40" } });
  rejectsMessage({ type: "move", ply: 0, move: { to: 40, pass: "true" } });
  rejectsMessage({ type: "riichi-action", actionId: 3 });
  rejectsMessage({ type: "chat", text: "" });
  rejectsMessage({ type: "chat", text: " ".repeat(2) });
  rejectsMessage({ type: "chat", text: "🙂".repeat(CHAT_MAX_LENGTH + 1) });
  rejectsMessage({ type: "chat", text: "不允\u0000許" });
  rejectsMessage({ type: "dead", to: "40" });
  rejectsMessage({ type: "unknown" });
});
