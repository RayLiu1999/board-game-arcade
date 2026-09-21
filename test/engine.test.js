import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  legalMoves,
  applyMove,
  inCheck,
  scoringAction,
  areaScore,
} from "../public/engine.js";
import { chooseMove } from "../public/ai.js";
const empty = (game) => {
  const s = createGame(game);
  s.board.fill(0);
  s.positions = [];
  return s;
};
test("six games have legal moves; transitions do not mutate the input", () => {
  for (const game of [
    "chess",
    "xiangqi",
    "checkers",
    "gomoku",
    "go",
    "reversi",
  ]) {
    const s = createGame(game),
      before = structuredClone(s),
      n = applyMove(s, legalMoves(s)[0]);
    assert.equal(n.ply, 1);
    assert.deepEqual(s, before);
    assert.equal(n.history.length, 1);
  }
});
test("chess rejects illegal moves and detects Fool’s Mate", () => {
  let s = createGame("chess");
  assert.equal(legalMoves(s).length, 20);
  assert.throws(() => applyMove(s, { from: 60, to: 36 }));
  for (const m of [
    { from: 53, to: 45 },
    { from: 12, to: 28 },
    { from: 54, to: 38 },
    { from: 3, to: 39 },
  ])
    s = applyMove(s, m);
  assert.equal(s.winner, -1);
  assert.equal(s.reason, "將死");
  assert.throws(() => applyMove(s, { from: 52, to: 44 }));
});
test("chess castling, en passant and underpromotion", () => {
  let s = createGame("chess");
  s.fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
  assert(legalMoves(s).some((m) => m.from === 60 && m.to === 62));
  s = applyMove(s, { from: 60, to: 62 });
  assert.equal(s.board[61], "wr");
  s = createGame("chess");
  for (const m of [
    { from: 52, to: 36 },
    { from: 8, to: 16 },
    { from: 36, to: 28 },
    { from: 11, to: 27 },
    { from: 28, to: 19 },
  ])
    s = applyMove(s, m);
  assert.equal(s.board[27], 0);
  assert.equal(s.board[19], "wp");
  s = createGame("chess");
  s.fen = "7k/P7/8/8/8/8/8/7K w - - 0 1";
  assert.equal(
    legalMoves(s).filter((m) => m.from === 8 && m.to === 0).length,
    4,
  );
  s = applyMove(s, { from: 8, to: 0, promotion: "n" });
  assert.equal(s.board[0], "wn");
});
test("chess retains threefold repetition across moves", () => {
  let s = createGame("chess");
  for (let cycle = 0; cycle < 2; cycle++)
    for (const m of [
      { from: 62, to: 45 },
      { from: 6, to: 21 },
      { from: 45, to: 62 },
      { from: 21, to: 6 },
    ])
      s = applyMove(s, m);
  assert.equal(s.winner, 0);
  assert.equal(s.reason, "三次重複局面");
});
test("xiangqi horse leg, river, palace and facing generals", () => {
  const s = createGame("xiangqi");
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
test("xiangqi cannon requires exactly one screen", () => {
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
test("checkers mandatory capture and same-piece continuation", () => {
  let s = empty("checkers");
  s.board[40] = 1;
  s.board[33] = -1;
  s.board[19] = -1;
  s.board[46] = 1;
  s.board[1] = -1;
  assert.deepEqual(legalMoves(s), [{ from: 40, to: 26, capture: 33 }]);
  s = applyMove(s, { from: 40, to: 26 });
  assert.equal(s.turn, 1);
  assert.equal(s.forced, 26);
  assert.throws(() => applyMove(s, { from: 46, to: 37 }));
  s = applyMove(s, { from: 26, to: 12 });
  assert.equal(s.turn, -1);
  assert.equal(s.board[19], 0);
});
test("checkers crowning ends the turn", () => {
  let s = empty("checkers");
  s.board[17] = 1;
  s.board[10] = -1;
  s.board[12] = -1;
  s = applyMove(s, { from: 17, to: 3 });
  assert.equal(s.board[3], 2);
  assert.equal(s.turn, -1);
  assert.equal(s.forced, null);
});
test("gomoku detects wins on every axis", () => {
  for (const step of [1, 15, 16, 14]) {
    let s = empty("gomoku");
    const start = step === 14 ? 14 : 0;
    for (let j = 0; j < 4; j++) s.board[start + j * step] = 1;
    s = applyMove(s, { to: start + 4 * step });
    assert.equal(s.winner, 1);
  }
});
test("gomoku AI finishes a win and blocks immediate defeat", () => {
  let s = empty("gomoku");
  for (let i = 0; i < 4; i++) s.board[i] = 1;
  assert.equal(chooseMove(s, "hard").to, 4);
  s = empty("gomoku");
  for (let i = 0; i < 4; i++) s.board[i] = -1;
  assert.equal(chooseMove(s, "hard").to, 4);
});
test("reversi flips enclosed stones and ends with a score", () => {
  let s = createGame("reversi");
  assert.deepEqual(
    legalMoves(s).map((m) => m.to),
    [19, 26, 37, 44],
  );
  s = applyMove(s, { to: 19 });
  assert.equal(s.board[27], 1);
  assert.equal(s.board.filter((p) => p === 1).length, 4);
  s = empty("reversi");
  s.board.fill(1);
  s.board[0] = 0;
  s.board[1] = -1;
  s = applyMove(s, { to: 0 });
  assert.equal(s.winner, 1);
});
test("go capture, suicide prohibition and positional superko", () => {
  let s = empty("go");
  s.board[10] = -1;
  for (const i of [1, 9, 11]) s.board[i] = 1;
  s = applyMove(s, { to: 19 });
  assert.equal(s.board[10], 0);
  assert.equal(s.captures[1], 1);
  assert.throws(() => applyMove(s, { to: 10 }));
  const n = empty("go");
  const future = [...n.board];
  future[40] = 1;
  n.positions = [future.join(",")];
  assert.throws(() => applyMove(n, { to: 40 }));
});
test("go scoring requires both confirmations and dead edits reset consent", () => {
  let s = createGame("go");
  s = applyMove(s, { to: 40 });
  s = applyMove(s, { pass: true });
  s = applyMove(s, { pass: true });
  assert.equal(s.phase, "scoring");
  assert.equal(s.winner, null);
  s = scoringAction(s, { type: "accept" }, 1);
  assert.equal(s.accepted.length, 1);
  s = scoringAction(s, { type: "dead", to: 40 }, -1);
  assert.equal(s.accepted.length, 0);
  assert.deepEqual(areaScore(s), { 1: 0, "-1": 6.5 });
  s = scoringAction(s, { type: "accept" }, 1);
  s = scoringAction(s, { type: "accept" }, -1);
  assert.equal(s.winner, -1);
  assert.equal(s.phase, "finished");
});
test("go disputed scoring can resume play", () => {
  let s = createGame("go", 13);
  s = applyMove(applyMove(s, { pass: true }), { pass: true });
  s = scoringAction(s, { type: "resume" }, 1);
  assert.equal(s.phase, "play");
  assert.equal(s.passes, 0);
  assert.equal(s.rows, 13);
  assert.equal(applyMove(s, { to: 84 }).board[84], 1);
});
test("every AI returns applicable moves", () => {
  for (const g of ["chess", "xiangqi", "checkers", "go", "reversi"]) {
    let s = createGame(g);
    for (let j = 0; j < 4; j++) {
      s = applyMove(s, chooseMove(s, "easy"));
      assert.equal(s.ply, j + 1);
    }
  }
});
