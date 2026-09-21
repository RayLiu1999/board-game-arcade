import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  applyMove,
  legalMoves,
  inCheck,
} from "../public/engine.js";
import { shogiKey } from "../public/shogi.js";
import { chooseMove } from "../public/ai.js";
const fixture = () => {
  const s = createGame("shogi");
  s.board.fill(0);
  s.board[4] = -8;
  s.board[76] = 8;
  return s;
};
test("shogi starts with 30 legal moves and an AI legal reply", () => {
  let s = createGame("shogi");
  assert.equal(legalMoves(s).length, 30);
  s = applyMove(s, { from: 56, to: 47 });
  const before = structuredClone(s);
  const m = chooseMove(s, "medium");
  assert.equal(applyMove(s, m).turn, 1);
  assert.deepEqual(s, before);
});
test("shogi captured promoted pieces become unpromoted hand pieces", () => {
  let s = fixture();
  s.board[40] = 7;
  s.board[31] = -9;
  s = applyMove(s, { from: 40, to: 31 });
  assert.equal(s.hands[1][1], 1);
  assert.equal(s.board[31], 7);
  assert.equal(s.turn, -1);
});
test("shogi optional and mandatory promotion", () => {
  let s = fixture();
  s.board[30] = 6;
  let moves = legalMoves(s).filter((m) => m.from === 30 && m.to === 20);
  assert.equal(moves.length, 2);
  assert(moves.some((m) => m.promote));
  assert.equal(applyMove(s, { from: 30, to: 20, promote: true }).board[20], 14);
  s = fixture();
  s.board[9] = 1;
  moves = legalMoves(s).filter((m) => m.from === 9 && m.to === 0);
  assert.equal(moves.length, 1);
  assert(moves[0].promote);
  assert.throws(() => applyMove(s, { from: 9, to: 0 }));
});
test("shogi drops prohibit nifu and stranded pawn/lance/knight", () => {
  let s = fixture();
  s.hands[1][1] = 1;
  s.hands[1][2] = 1;
  s.hands[1][3] = 1;
  s.board[54] = 1;
  let moves = legalMoves(s);
  assert(!moves.some((m) => m.drop === 1 && m.to % 9 === 0));
  assert(!moves.some((m) => [1, 2].includes(m.drop) && m.to < 9));
  assert(!moves.some((m) => m.drop === 3 && m.to < 18));
  s.board[54] = 9;
  assert(legalMoves(s).some((m) => m.drop === 1 && m.to === 45));
  s = applyMove(s, { drop: 1, to: 45 });
  assert.equal(s.hands[1][1], 0);
  assert.equal(s.board[45], 1);
});
test("shogi rejects leaving the king in check", () => {
  const s = fixture();
  s.board[4] = 0;
  s.board[0] = -8;
  s.board[13] = -7;
  s.board[67] = 5;
  assert(!inCheck(s));
  assert(!legalMoves(s).some((m) => m.from === 67 && m.to === 66));
  assert.throws(() => applyMove(s, { from: 67, to: 66 }));
});
test("shogi pawn-drop mate prohibited, pawn-move mate allowed", () => {
  let s = fixture();
  s.board[3] = -2;
  s.board[5] = -2;
  s.board[21] = 5;
  s.board[23] = 5;
  s.hands[1][1] = 1;
  assert(!legalMoves(s).some((m) => m.drop === 1 && m.to === 13));
  assert.throws(() => applyMove(s, { drop: 1, to: 13 }));
  s.board[22] = 1;
  s = applyMove(s, { from: 22, to: 13 });
  assert.equal(s.winner, 1);
});
test("shogi fourfold repetition includes hands and side to move", () => {
  let s = fixture();
  s.board[4] = 0;
  s.board[76] = 0;
  s.board[0] = -8;
  s.board[80] = 8;
  s.positions = [shogiKey(s)];
  for (let cycle = 0; cycle < 3; cycle++)
    for (const m of [
      { from: 80, to: 79 },
      { from: 0, to: 1 },
      { from: 79, to: 80 },
      { from: 1, to: 0 },
    ])
      s = applyMove(s, m);
  assert.equal(s.winner, 0);
  assert.match(s.reason, /千日手/);
});

test("continuous-check repetition loses for the checking player", () => {
  let s = fixture();
  s.board.fill(0);
  s.board[0] = -8;
  s.board[80] = 8;
  s.board[18] = 7;
  s.turn = -1;
  s.positions = [shogiKey(s)];
  for (let cycle = 0; cycle < 3; cycle++)
    for (const m of [
      { from: 0, to: 1 },
      { from: 18, to: 19 },
      { from: 1, to: 0 },
      { from: 19, to: 18 },
    ])
      s = applyMove(s, m);
  assert.equal(s.winner, -1);
  assert.match(s.reason, /連續王手/);
});
