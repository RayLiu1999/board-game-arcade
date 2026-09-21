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

const verifyReachablePosition = (state: BoardState): void => {
  if (state.winner !== null || state.phase !== "play") return;
  const moves = legalMoves(state);
  assert.ok(
    moves.length > 0,
    `${state.game} has no legal move in a live state`,
  );

  for (const move of moves) {
    const before = structuredClone(state);
    const next = applyBoardMove(state, move);
    assert.deepEqual(state, before, `${state.game} mutated a reachable state`);
    assert.equal(next.ply, state.ply + 1, state.game);
    assert.equal(next.history.length, state.history.length + 1, state.game);
  }
};

const walk = (game: BoardGameId, choices: readonly number[]): void => {
  let state = boardState(game);
  for (const choice of choices) {
    verifyReachablePosition(state);
    if (state.winner !== null || state.phase !== "play") break;
    const moves = legalMoves(state);
    const move = moves[choice % moves.length];
    assert.ok(move, `${game} did not expose the selected legal move`);
    state = applyBoardMove(state, move);
  }
  verifyReachablePosition(state);
};

register(
  "reachable random positions accept every advertised legal move",
  () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 255 }), { minLength: 4, maxLength: 10 }),
        (choices) => {
          for (const game of BOARD_GAMES) walk(game, choices);
        },
      ),
      { endOnFailure: true, numRuns: 12, seed: 20260922 },
    );
  },
);
