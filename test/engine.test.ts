import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  legalMoves,
  applyMove,
  inCheck,
  scoringAction,
  areaScore,
} from "../src/shared/engine.js";
import { chooseMove, createSeededRandom } from "../src/client/ai.js";
import type {
  BoardGameId,
  BoardState,
  ChessState,
  GameMove,
  GameState,
  NumericBoardGameId,
  NumericBoardState,
  PlayerSide,
  ScoringAction,
} from "../src/shared/game-types.js";

const register = (name: string, callback: () => void): void => {
  void test(name, callback);
};

const boardState = (state: GameState): BoardState => {
  if (state.game === "riichi") throw new Error("測試收到日麻狀態");
  return state;
};

const next = (state: BoardState, move: GameMove): BoardState =>
  boardState(applyMove(state, move));

const boardGame = (game: BoardGameId, size?: number): BoardState =>
  boardState(createGame(game, size));

const chessGame = (): ChessState => {
  const state = boardGame("chess");
  if (state.game !== "chess") throw new Error("測試收到非西洋棋狀態");
  return state;
};

const chessNext = (state: ChessState, move: GameMove): ChessState => {
  const nextState = next(state, move);
  if (nextState.game !== "chess") throw new Error("測試收到非西洋棋狀態");
  return nextState;
};

const numericGame = (
  game: NumericBoardGameId,
  size?: number,
): NumericBoardState => {
  const state = boardGame(game, size);
  if (state.game === "chess" || state.game === "shogi")
    throw new Error("測試收到非數字棋盤狀態");
  return state;
};

const numericNext = (
  state: NumericBoardState,
  move: GameMove,
): NumericBoardState => {
  const nextState = next(state, move);
  if (nextState.game === "chess" || nextState.game === "shogi")
    throw new Error("測試收到非數字棋盤狀態");
  return nextState;
};

const score = (
  state: NumericBoardState,
  action: ScoringAction,
  side: PlayerSide,
): NumericBoardState => {
  const nextState = boardState(scoringAction(state, action, side));
  if (nextState.game === "chess" || nextState.game === "shogi")
    throw new Error("測試收到非數字棋盤狀態");
  return nextState;
};

const empty = (game: NumericBoardGameId): NumericBoardState => {
  const s = numericGame(game);
  s.board.fill(0);
  s.positions = [];
  return s;
};
register(
  "six games have legal moves; transitions do not mutate the input",
  () => {
    for (const game of [
      "chess",
      "xiangqi",
      "checkers",
      "gomoku",
      "go",
      "reversi",
    ] as const) {
      const s = boardGame(game);
      const before = structuredClone(s);
      const firstMove = legalMoves(s)[0];
      assert.ok(firstMove);
      const n = next(s, firstMove);
      assert.equal(n.ply, 1);
      assert.deepEqual(s, before);
      assert.equal(n.history.length, 1);
    }
  },
);
register("chess rejects illegal moves and detects Fool’s Mate", () => {
  let s = chessGame();
  assert.equal(legalMoves(s).length, 20);
  assert.throws(() => next(s, { from: 60, to: 36 }));
  for (const m of [
    { from: 53, to: 45 },
    { from: 12, to: 28 },
    { from: 54, to: 38 },
    { from: 3, to: 39 },
  ])
    s = chessNext(s, m);
  assert.equal(s.winner, -1);
  assert.equal(s.reason, "將死");
  assert.throws(() => next(s, { from: 52, to: 44 }));
});
register("chess castling, en passant and underpromotion", () => {
  let s = chessGame();
  s.fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
  assert(legalMoves(s).some((m) => m.from === 60 && m.to === 62));
  s = chessNext(s, { from: 60, to: 62 });
  assert.equal(s.board[61], "wr");
  s = chessGame();
  for (const m of [
    { from: 52, to: 36 },
    { from: 8, to: 16 },
    { from: 36, to: 28 },
    { from: 11, to: 27 },
    { from: 28, to: 19 },
  ])
    s = chessNext(s, m);
  assert.equal(s.board[27], 0);
  assert.equal(s.board[19], "wp");
  s = chessGame();
  s.fen = "7k/P7/8/8/8/8/8/7K w - - 0 1";
  assert.equal(
    legalMoves(s).filter((m) => m.from === 8 && m.to === 0).length,
    4,
  );
  s = chessNext(s, { from: 8, to: 0, promotion: "n" });
  assert.equal(s.board[0], "wn");
});
register("chess retains threefold repetition across moves", () => {
  let s = chessGame();
  for (let cycle = 0; cycle < 2; cycle++)
    for (const m of [
      { from: 62, to: 45 },
      { from: 6, to: 21 },
      { from: 45, to: 62 },
      { from: 21, to: 6 },
    ])
      s = chessNext(s, m);
  assert.equal(s.winner, 0);
  assert.equal(s.reason, "三次重複局面");
});
register("xiangqi horse leg, river, palace and facing generals", () => {
  const s = boardGame("xiangqi");
  assert.equal(legalMoves(s).length, 44);
  assert(!legalMoves(s).some((m) => m.from === 82 && m.to === 75));
  const n = empty("xiangqi");
  n.board[4] = -7;
  n.board[85] = 7;
  n.board[49] = 3;
  assert(!legalMoves(n).some((m) => m.from === 49 && m.to === 48));
  n.board[49] = 0;
  assert(inCheck(n));
  n.board[49] = 1;
  n.board[47] = 5;
  assert(!legalMoves(n).some((m) => m.from === 47 && m.to === 27));
  assert(!legalMoves(n).some((m) => m.from === 85 && m.to === 83));
});
register("xiangqi cannon requires exactly one screen", () => {
  const s = empty("xiangqi");
  s.board[4] = -7;
  s.board[85] = 7;
  s.board[49] = 1;
  s.board[64] = 2;
  s.board[37] = -1;
  s.board[10] = -3;
  const moves = legalMoves(s).filter((m) => m.from === 64);
  assert(moves.some((m) => m.to === 10));
  assert(!moves.some((m) => m.to === 37));
  assert(!moves.some((m) => m.to === 28));
});
register("checkers mandatory capture and same-piece continuation", () => {
  let s = empty("checkers");
  s.board[40] = 1;
  s.board[33] = -1;
  s.board[19] = -1;
  s.board[46] = 1;
  s.board[1] = -1;
  assert.deepEqual(legalMoves(s), [{ from: 40, to: 26, capture: 33 }]);
  s = numericNext(s, { from: 40, to: 26 });
  assert.equal(s.turn, 1);
  assert.equal(s.forced, 26);
  assert.throws(() => numericNext(s, { from: 46, to: 37 }));
  s = numericNext(s, { from: 26, to: 12 });
  assert.equal(s.turn, -1);
  assert.equal(s.board[19], 0);
});
register("checkers crowning ends the turn", () => {
  let s = empty("checkers");
  s.board[17] = 1;
  s.board[10] = -1;
  s.board[12] = -1;
  s = numericNext(s, { from: 17, to: 3 });
  assert.equal(s.board[3], 2);
  assert.equal(s.turn, -1);
  assert.equal(s.forced, null);
});
register("gomoku detects wins on every axis", () => {
  for (const step of [1, 15, 16, 14]) {
    let s = empty("gomoku");
    const start = step === 14 ? 14 : 0;
    for (let j = 0; j < 4; j++) s.board[start + j * step] = 1;
    s = numericNext(s, { to: start + 4 * step });
    assert.equal(s.winner, 1);
  }
});
register("gomoku AI finishes a win and blocks immediate defeat", () => {
  let s = empty("gomoku");
  for (let i = 0; i < 4; i++) s.board[i] = 1;
  const winningMove = chooseMove(s, "hard");
  assert.ok(winningMove);
  assert.equal(winningMove.to, 4);
  s = empty("gomoku");
  for (let i = 0; i < 4; i++) s.board[i] = -1;
  const blockingMove = chooseMove(s, "hard");
  assert.ok(blockingMove);
  assert.equal(blockingMove.to, 4);
});
register("seeded AI decisions are reproducible", () => {
  const state = numericGame("reversi");
  const first = chooseMove(state, "easy", createSeededRandom(2026));
  const second = chooseMove(state, "easy", createSeededRandom(2026));
  assert.deepEqual(second, first);
});
register("reversi flips enclosed stones and ends with a score", () => {
  let s = numericGame("reversi");
  assert.deepEqual(
    legalMoves(s).map((m) => m.to),
    [19, 26, 37, 44],
  );
  s = numericNext(s, { to: 19 });
  assert.equal(s.board[27], 1);
  assert.equal(s.board.filter((p) => p === 1).length, 4);
  s = empty("reversi");
  s.board.fill(1);
  s.board[0] = 0;
  s.board[1] = -1;
  s = numericNext(s, { to: 0 });
  assert.equal(s.winner, 1);
});
register("go capture, suicide prohibition and positional superko", () => {
  let s = empty("go");
  s.board[10] = -1;
  for (const i of [1, 9, 11]) s.board[i] = 1;
  s = numericNext(s, { to: 19 });
  assert.equal(s.board[10], 0);
  assert.equal(s.captures[1], 1);
  assert.throws(() => numericNext(s, { to: 10 }));
  const n = empty("go");
  const future = [...n.board];
  future[40] = 1;
  n.positions = [future.join(",")];
  assert.throws(() => numericNext(n, { to: 40 }));
});
register(
  "go scoring requires both confirmations and dead edits reset consent",
  () => {
    let s = numericGame("go");
    s = numericNext(s, { to: 40 });
    s = numericNext(s, { pass: true });
    s = numericNext(s, { pass: true });
    assert.equal(s.phase, "scoring");
    assert.equal(s.winner, null);
    s = score(s, { type: "accept" }, 1);
    assert.equal(s.accepted.length, 1);
    s = score(s, { type: "dead", to: 40 }, -1);
    assert.equal(s.accepted.length, 0);
    assert.deepEqual(areaScore(s), { 1: 0, "-1": 6.5 });
    s = score(s, { type: "accept" }, 1);
    s = score(s, { type: "accept" }, -1);
    assert.equal(s.winner, -1);
    assert.equal(s.phase, "finished");
  },
);
register("go disputed scoring can resume play", () => {
  let s = numericGame("go", 13);
  s = numericNext(numericNext(s, { pass: true }), { pass: true });
  s = score(s, { type: "resume" }, 1);
  assert.equal(s.phase, "play");
  assert.equal(s.passes, 0);
  assert.equal(s.rows, 13);
  assert.equal(numericNext(s, { to: 84 }).board[84], 1);
});
register("every AI returns applicable moves", () => {
  for (const g of ["chess", "xiangqi", "checkers", "go", "reversi"] as const) {
    let s = boardGame(g);
    for (let j = 0; j < 4; j++) {
      const move = chooseMove(s, "easy");
      assert.ok(move);
      s = next(s, move);
      assert.equal(s.ply, j + 1);
    }
  }
});
