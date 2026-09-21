import test from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";

import { applyMove, createGame, legalMoves } from "../src/shared/engine.js";
import type {
  BoardGameId,
  BoardState,
  GameMove,
} from "../src/shared/game-types.js";

const register = (name: string, callback: () => void): void => {
  void test(name, callback);
};

const BOARD_GAMES: readonly BoardGameId[] = [
  "shogi",
  "chess",
  "xiangqi",
  "checkers",
  "gomoku",
  "go",
  "reversi",
];

const boardState = (game: BoardGameId): BoardState => {
  const state = createGame(game);
  if (state.game === "riichi") throw new Error("測試收到日麻狀態");
  return state;
};

const applyBoardMove = (state: BoardState, move: GameMove): BoardState => {
  const next = applyMove(state, move);
  if (next.game === "riichi") throw new Error("測試收到日麻狀態");
  return next;
};

const walk = (game: BoardGameId, choices: readonly number[]): void => {
  let state = boardState(game);
  for (const choice of choices) {
    if (state.winner !== null || state.phase !== "play") break;
    const moves = legalMoves(state);
    assert.ok(moves.length > 0, `${game} has no legal move during a live game`);
    const move = moves[choice % moves.length];
    assert.ok(move, `${game} did not expose the selected legal move`);

    const before = structuredClone(state);
    const next = applyBoardMove(state, move);
    assert.deepEqual(state, before, `${game} mutated a property-test input`);
    assert.equal(next.board.length, before.board.length, game);
    assert.equal(next.ply, before.ply + 1, game);
    assert.equal(next.history.length, before.history.length + 1, game);
    state = next;
  }
};

register("property-based legal walks preserve board state boundaries", () => {
  fc.assert(
    fc.property(
      fc.array(fc.nat({ max: 255 }), { minLength: 1, maxLength: 16 }),
      (choices) => {
        for (const game of BOARD_GAMES) walk(game, choices);
      },
    ),
    { endOnFailure: true, numRuns: 40, seed: 20260921 },
  );
});
