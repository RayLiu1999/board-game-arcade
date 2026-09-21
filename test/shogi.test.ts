import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  legalMoves,
  inCheck,
  applyMove,
} from "../src/shared/engine.js";
import { shogiKey } from "../src/shared/shogi.js";
import { chooseMove } from "../src/client/ai.js";
import type {
  GameMove,
  GameState,
  ShogiState,
} from "../src/shared/game-types.js";

const register = (name: string, callback: () => void): void => {
  void test(name, callback);
};

const shogiGame = (): ShogiState => {
  const state: GameState = createGame("shogi");
  if (state.game !== "shogi") throw new Error("測試收到非將棋狀態");
  return state;
};

const next = (state: ShogiState, move: GameMove): ShogiState => {
  const nextState = applyMove(state, move);
  if (nextState.game !== "shogi") throw new Error("測試收到非將棋狀態");
  return nextState;
};

const fixture = (): ShogiState => {
  const s = shogiGame();
  s.board.fill(0);
  s.board[4] = -8;
  s.board[76] = 8;
  return s;
};
register("shogi starts with 30 legal moves and an AI legal reply", () => {
  let s = shogiGame();
  assert.equal(legalMoves(s).length, 30);
  s = next(s, { from: 56, to: 47 });
  const before = structuredClone(s);
  const m = chooseMove(s, "medium");
  assert.ok(m);
  assert.equal(next(s, m).turn, 1);
  assert.deepEqual(s, before);
});
register("shogi captured promoted pieces become unpromoted hand pieces", () => {
  let s = fixture();
  s.board[40] = 7;
  s.board[31] = -9;
  s = next(s, { from: 40, to: 31 });
  assert.equal(s.hands[1][1], 1);
  assert.equal(s.board[31], 7);
  assert.equal(s.turn, -1);
});
register("shogi optional and mandatory promotion", () => {
  let s = fixture();
  s.board[30] = 6;
  let moves = legalMoves(s).filter((m) => m.from === 30 && m.to === 20);
  assert.equal(moves.length, 2);
  assert(moves.some((m) => m.promote));
  assert.equal(next(s, { from: 30, to: 20, promote: true }).board[20], 14);
  s = fixture();
  s.board[9] = 1;
  moves = legalMoves(s).filter((m) => m.from === 9 && m.to === 0);
  assert.equal(moves.length, 1);
  const mandatory = moves[0];
  assert.ok(mandatory);
  assert(mandatory.promote);
  assert.throws(() => next(s, { from: 9, to: 0 }));
});
register("shogi drops prohibit nifu and stranded pawn/lance/knight", () => {
  let s = fixture();
  s.hands[1][1] = 1;
  s.hands[1][2] = 1;
  s.hands[1][3] = 1;
  s.board[54] = 1;
  const moves = legalMoves(s);
  assert(
    !moves.some((m) => m.drop === 1 && m.to !== undefined && m.to % 9 === 0),
  );
  assert(
    !moves.some(
      (m) => [1, 2].includes(m.drop ?? 0) && m.to !== undefined && m.to < 9,
    ),
  );
  assert(!moves.some((m) => m.drop === 3 && m.to !== undefined && m.to < 18));
  s.board[54] = 9;
  assert(legalMoves(s).some((m) => m.drop === 1 && m.to === 45));
  s = next(s, { drop: 1, to: 45 });
  assert.equal(s.hands[1][1], 0);
  assert.equal(s.board[45], 1);
});
register("shogi rejects leaving the king in check", () => {
  const s = fixture();
  s.board[4] = 0;
  s.board[0] = -8;
  s.board[13] = -7;
  s.board[67] = 5;
  assert(!inCheck(s));
  assert(!legalMoves(s).some((m) => m.from === 67 && m.to === 66));
  assert.throws(() => next(s, { from: 67, to: 66 }));
});
register("shogi pawn-drop mate prohibited, pawn-move mate allowed", () => {
  let s = fixture();
  s.board[3] = -2;
  s.board[5] = -2;
  s.board[21] = 5;
  s.board[23] = 5;
  s.hands[1][1] = 1;
  assert(!legalMoves(s).some((m) => m.drop === 1 && m.to === 13));
  assert.throws(() => next(s, { drop: 1, to: 13 }));
  s.board[22] = 1;
  s = next(s, { from: 22, to: 13 });
  assert.equal(s.winner, 1);
});
register("shogi fourfold repetition includes hands and side to move", () => {
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
      s = next(s, m);
  assert.equal(s.winner, 0);
  assert.match(s.reason, /千日手/);
});

register("continuous-check repetition loses for the checking player", () => {
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
      s = next(s, m);
  assert.equal(s.winner, -1);
  assert.match(s.reason, /連續王手/);
});
