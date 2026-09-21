import {
  applyMove,
  flips,
  group,
  legalMoves,
  owner,
} from "../shared/engine.js";
import type {
  BoardState,
  GameMove,
  NumericBoardState,
  PlayerSide,
} from "../shared/game-types.js";

export type Difficulty = "easy" | "medium" | "hard";
type PlacedMove = GameMove & { to: number };

const values: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

const asPlacedMoves = (moves: readonly GameMove[]): PlacedMove[] =>
  moves.filter((move): move is PlacedMove => move.to !== undefined);

function evaluate(state: BoardState, side: PlayerSide): number {
  if (state.winner !== null)
    return state.winner === 0 ? 0 : state.winner === side ? 1000000 : -1000000;
  let score = 0;
  for (let index = 0; index < state.board.length; index++) {
    const piece = state.board[index];
    if (!piece) continue;
    const who = owner(piece);
    const numericPiece = typeof piece === "number" ? piece : 0;
    const row = Math.floor(index / state.cols);
    const col = index % state.cols;
    let value = 0;
    if (state.game === "chess" && typeof piece === "string") {
      const type = piece[1] ?? "";
      value =
        (values[type] ?? 0) +
        (type === "p" ? (who === 1 ? 6 - row : row - 1) * 9 : 0) +
        (type !== "k"
          ? (3.5 - Math.abs(3.5 - col) + 3.5 - Math.abs(3.5 - row)) * 5
          : 0);
    }
    if (state.game === "shogi")
      value =
        [
          0, 100, 280, 300, 420, 520, 700, 850, 20000, 550, 550, 550, 550, 0,
          950, 1100,
        ][Math.abs(numericPiece)] ?? 0;
    if (state.game === "xiangqi")
      value =
        ([0, 100, 450, 900, 400, 200, 200, 20000][Math.abs(numericPiece)] ??
          0) +
        (Math.abs(numericPiece) === 1 ? (who === 1 ? 9 - row : row) * 15 : 0) +
        (4 - Math.abs(4 - col)) * 3;
    if (state.game === "checkers")
      value =
        Math.abs(numericPiece) === 2
          ? 300
          : 100 + (who === 1 ? 7 - row : row) * 8;
    if (state.game === "reversi") {
      const edge = row === 0 || row === 7 || col === 0 || col === 7;
      const corner = (row === 0 || row === 7) && (col === 0 || col === 7);
      const risky = (row === 1 || row === 6) && (col === 1 || col === 6);
      value = corner ? 150 : risky ? -45 : edge ? 15 : 3;
    }
    if (state.game === "go") value = 10;
    score += who === side ? value : -value;
  }
  if (state.game === "shogi")
    for (const who of [1, -1] as const)
      for (let type = 1; type <= 7; type++)
        score +=
          (who === side ? 1 : -1) *
          (state.hands[who][type] ?? 0) *
          ([0, 115, 300, 320, 440, 540, 750, 900][type] ?? 0);
  return score;
}

function linePotential(
  state: NumericBoardState,
  to: number,
  side: PlayerSide,
): number {
  const row = Math.floor(to / state.cols);
  const col = to % state.cols;
  let score = 0;
  for (const [dr, dc] of [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const) {
    let count = 1;
    let open = 0;
    for (const direction of [-1, 1]) {
      let nextRow = row + dr * direction;
      let nextCol = col + dc * direction;
      while (
        nextRow >= 0 &&
        nextRow < state.rows &&
        nextCol >= 0 &&
        nextCol < state.cols &&
        state.board[nextRow * state.cols + nextCol] === side
      ) {
        count++;
        nextRow += dr * direction;
        nextCol += dc * direction;
      }
      if (
        nextRow >= 0 &&
        nextRow < state.rows &&
        nextCol >= 0 &&
        nextCol < state.cols &&
        !state.board[nextRow * state.cols + nextCol]
      )
        open++;
    }
    if (count >= 5) score += 10000000;
    else if (open)
      score += ([0, 2, 25, 500, 25000][count] ?? 0) * (open === 2 ? 5 : 1);
  }
  return score;
}

function nearby(state: NumericBoardState, to: number): boolean {
  const row = Math.floor(to / state.cols);
  const col = to % state.cols;
  for (let dr = -2; dr <= 2; dr++)
    for (let dc = -2; dc <= 2; dc++) {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (
        nextRow >= 0 &&
        nextRow < state.rows &&
        nextCol >= 0 &&
        nextCol < state.cols &&
        state.board[nextRow * state.cols + nextCol]
      )
        return true;
    }
  return false;
}

function goRank(state: NumericBoardState, move: PlacedMove): number {
  const next = applyMove(state, move);
  if (next.game !== "go") throw new Error("圍棋 AI 收到非圍棋狀態");
  const target = group(next, move.to);
  const row = Math.floor(move.to / state.cols);
  const col = move.to % state.cols;
  let friends = 0;
  let enemies = 0;
  let save = 0;
  for (const [dr, dc] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nextRow = row + dr;
    const nextCol = col + dc;
    if (
      nextRow < 0 ||
      nextRow >= state.rows ||
      nextCol < 0 ||
      nextCol >= state.cols
    ) {
      friends++;
      continue;
    }
    const index = nextRow * state.cols + nextCol;
    if (state.board[index] === state.turn) {
      friends++;
      if (group(state, index).liberties.size === 1) save += 40;
    }
    if (state.board[index] === -state.turn) {
      enemies++;
      if (group(next, index).liberties.size === 1) save += 18;
    }
  }
  const capture =
    (next.captures[state.turn] - state.captures[state.turn]) * 100;
  return (
    capture +
    save +
    (target.liberties.size === 1
      ? -100
      : Math.min(target.liberties.size, 5) * 2) +
    (friends === 4 ? -120 : 0) +
    (enemies ? 5 : 0) +
    (friends === 0 ? 4 : 0) -
    Math.abs(row - (state.rows - 1) / 2) * 0.3 -
    Math.abs(col - (state.cols - 1) / 2) * 0.3
  );
}

const advance = (state: BoardState, move: GameMove): BoardState => {
  const next = applyMove(state, move);
  if (next.game === "riichi") throw new Error("AI 不支援日麻狀態");
  return next;
};

export function chooseMove(
  state: BoardState,
  difficulty: Difficulty = "medium",
): GameMove | null {
  const moves = legalMoves(state);
  if (!moves.length) return null;
  const noise = difficulty === "easy" ? 30 : difficulty === "medium" ? 3 : 0;
  if (state.game === "gomoku") {
    const placed = asPlacedMoves(moves);
    if (!state.board.some(Boolean))
      return {
        to:
          Math.floor(state.rows / 2) * state.cols + Math.floor(state.cols / 2),
      };
    const ranked = placed
      .filter((move) => nearby(state, move.to))
      .map((move) => ({
        move,
        value:
          linePotential(state, move.to, state.turn) * 1.15 +
          linePotential(state, move.to, state.turn === 1 ? -1 : 1) +
          Math.random() * noise,
      }))
      .sort((left, right) => right.value - left.value);
    return ranked[0]?.move ?? placed[0] ?? null;
  }
  if (state.game === "go") {
    const ranked = moves
      .filter(
        (move): move is PlacedMove =>
          move.pass === true || move.to !== undefined,
      )
      .map((move) => ({
        move,
        value:
          move.pass === true
            ? -5
            : goRank(state, move) +
              Math.random() * (difficulty === "easy" ? 10 : 2),
      }))
      .sort((left, right) => right.value - left.value);
    if (state.passes === 1 && state.ply > state.rows * state.cols * 0.7)
      return { pass: true };
    return ranked[0]?.move ?? null;
  }

  const side = state.turn;
  const depth = difficulty === "easy" ? 1 : difficulty === "hard" ? 3 : 2;
  let budget = difficulty === "hard" ? 2200 : 900;
  const quick = (current: BoardState, move: GameMove) => {
    const next = advance(current, move);
    return { move, next, value: evaluate(next, side) };
  };
  function search(
    current: BoardState,
    remaining: number,
    alpha: number,
    beta: number,
  ): number {
    if (remaining <= 0 || current.winner !== null || --budget <= 0)
      return evaluate(current, side);
    const maximizing = current.turn === side;
    const options = legalMoves(current)
      .map((move) => quick(current, move))
      .sort((left, right) =>
        maximizing ? right.value - left.value : left.value - right.value,
      )
      .slice(0, depth === 3 ? 10 : 18);
    if (!options.length) return evaluate(current, side);
    let best = maximizing ? -Infinity : Infinity;
    for (const option of options) {
      const value = search(option.next, remaining - 1, alpha, beta);
      best = maximizing ? Math.max(best, value) : Math.min(best, value);
      if (maximizing) alpha = Math.max(alpha, best);
      else beta = Math.min(beta, best);
      if (beta <= alpha || budget <= 0) break;
    }
    return best;
  }
  const options = moves
    .map((move) => quick(state, move))
    .sort((left, right) => right.value - left.value);
  const first = options[0];
  if (!first) return null;
  let best = -Infinity;
  let choice = first.move;
  for (const option of options) {
    const score =
      search(option.next, depth - 1, -Infinity, Infinity) +
      Math.random() * noise;
    if (score > best) {
      best = score;
      choice = option.move;
    }
  }
  return choice;
}

export { flips, group };
