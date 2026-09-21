import test from "node:test";
import assert from "node:assert/strict";

import { chooseMove, createSeededRandom } from "../src/client/ai.js";
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

register("all board games satisfy the initial state contract", () => {
  for (const game of BOARD_GAMES) {
    const state = boardState(game);
    const moves = legalMoves(state);

    assert.equal(state.board.length, state.rows * state.cols, game);
    assert.equal(state.phase, "play", game);
    assert.equal(state.winner, null, game);
    assert.ok(moves.length > 0, `${game} must start with a legal move`);

    for (const move of moves) {
      const before = structuredClone(state);
      const next = applyBoardMove(state, move);
      const history = next.history[0];

      assert.deepEqual(state, before, `${game} mutated its input state`);
      assert.equal(next.board.length, state.board.length, game);
      assert.equal(next.ply, 1, game);
      assert.equal(next.history.length, 1, game);
      assert.deepEqual(next.last, move, game);
      assert.ok(history, `${game} must record the move`);
      assert.equal(history.side, state.turn, game);
      if (next.forced === null && next.winner === null)
        assert.notEqual(next.turn, state.turn, game);
      if (next.forced !== null) assert.equal(next.turn, state.turn, game);
    }
  }
});

register("deterministic board walks preserve transition contracts", () => {
  for (const [index, game] of BOARD_GAMES.entries()) {
    let state = boardState(game);
    const random = createSeededRandom(2026 + index);

    for (let step = 0; step < 24; step++) {
      if (state.winner !== null || state.phase !== "play") break;
      const moves = legalMoves(state);
      assert.ok(moves.length > 0, `${game} stalled at step ${String(step)}`);
      const move = moves[Math.floor(random() * moves.length)];
      assert.ok(move, `${game} did not provide a selected move`);

      const before = structuredClone(state);
      const next = applyBoardMove(state, move);
      assert.deepEqual(state, before, `${game} mutated a random-walk input`);
      assert.equal(next.ply, before.ply + 1, game);
      assert.equal(next.history.length, before.history.length + 1, game);
      state = next;
    }

    assert.ok(state.ply > 0, `${game} random walk made no progress`);
  }
});

register("AI choices satisfy the same legal move contract", () => {
  for (const [index, game] of BOARD_GAMES.entries()) {
    const state = boardState(game);
    const move = chooseMove(state, "medium", createSeededRandom(3030 + index));
    assert.ok(move, `${game} AI must return a move`);
    assert.ok(
      legalMoves(state).some(
        (candidate) =>
          candidate.from === move.from &&
          candidate.to === move.to &&
          candidate.drop === move.drop &&
          candidate.pass === move.pass &&
          candidate.promote === move.promote &&
          candidate.promotion === move.promotion,
      ),
      `${game} AI returned an illegal move`,
    );
  }
});
