import { legalMoves, applyMove, owner, group, flips } from "./engine.js";
const values = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
function evaluate(s, side) {
  if (s.winner !== null)
    return s.winner === 0 ? 0 : s.winner === side ? 1000000 : -1000000;
  let score = 0;
  for (let i = 0; i < s.board.length; i++) {
    const p = s.board[i];
    if (!p) continue;
    const who = owner(p),
      r = Math.floor(i / s.cols),
      c = i % s.cols,
      center = (s.cols - 1) / 2;
    let v = 0;
    if (s.game === "chess")
      v =
        values[p[1]] +
        (p[1] === "p" ? (who === 1 ? 6 - r : r - 1) * 9 : 0) +
        (p[1] !== "k"
          ? (3.5 - Math.abs(3.5 - c) + 3.5 - Math.abs(3.5 - r)) * 5
          : 0);
    if (s.game === "shogi")
      v =
        [
          0, 100, 280, 300, 420, 520, 700, 850, 20000, 550, 550, 550, 550, 0,
          950, 1100,
        ][Math.abs(p)] + (Math.abs(p) !== 8 ? (4 - Math.abs(4 - c)) * 4 : 0);
    if (s.game === "xiangqi")
      v =
        [0, 100, 450, 900, 400, 200, 200, 20000][Math.abs(p)] +
        (Math.abs(p) === 1 ? (who === 1 ? 9 - r : r) * 15 : 0) +
        (4 - Math.abs(4 - c)) * 3;
    if (s.game === "checkers")
      v = Math.abs(p) === 2 ? 300 : 100 + (who === 1 ? 7 - r : r) * 8;
    if (s.game === "reversi") {
      const edge = r === 0 || r === 7 || c === 0 || c === 7;
      const corner = (r === 0 || r === 7) && (c === 0 || c === 7);
      const risky = (r === 1 || r === 6) && (c === 1 || c === 6);
      v = corner ? 150 : risky ? -45 : edge ? 15 : 3;
    }
    if (s.game === "go") v = 10;
    score += who === side ? v : -v;
  }
  if (s.game === "shogi")
    for (const who of [1, -1])
      for (let t = 1; t <= 7; t++)
        score +=
          (who === side ? 1 : -1) *
          s.hands[who][t] *
          [0, 115, 300, 320, 440, 540, 750, 900][t];
  return score;
}
function linePotential(s, to, side) {
  const r = Math.floor(to / s.cols),
    c = to % s.cols;
  let score = 0;
  for (const [dr, dc] of [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ]) {
    let count = 1,
      open = 0;
    for (const d of [-1, 1]) {
      let rr = r + dr * d,
        cc = c + dc * d;
      while (
        rr >= 0 &&
        rr < s.rows &&
        cc >= 0 &&
        cc < s.cols &&
        s.board[rr * s.cols + cc] === side
      ) {
        count++;
        rr += dr * d;
        cc += dc * d;
      }
      if (
        rr >= 0 &&
        rr < s.rows &&
        cc >= 0 &&
        cc < s.cols &&
        !s.board[rr * s.cols + cc]
      )
        open++;
    }
    if (count >= 5) score += 10000000;
    else if (open)
      score += [0, 2, 25, 500, 25000][count] * (open === 2 ? 5 : 1);
  }
  return score;
}
function nearby(s, to) {
  const r = Math.floor(to / s.cols),
    c = to % s.cols;
  for (let dr = -2; dr <= 2; dr++)
    for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr,
        cc = c + dc;
      if (
        rr >= 0 &&
        rr < s.rows &&
        cc >= 0 &&
        cc < s.cols &&
        s.board[rr * s.cols + cc]
      )
        return true;
    }
  return false;
}
function goRank(s, m) {
  if (m.pass) return -5;
  const n = applyMove(s, m),
    g = group(n, m.to);
  const r = Math.floor(m.to / s.cols),
    c = m.to % s.cols;
  let friends = 0,
    enemies = 0,
    save = 0;
  for (const [dr, dc] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const rr = r + dr,
      cc = c + dc;
    if (rr < 0 || rr >= s.rows || cc < 0 || cc >= s.cols) {
      friends++;
      continue;
    }
    const i = rr * s.cols + cc;
    if (s.board[i] === s.turn) {
      friends++;
      if (group(s, i).liberties.size === 1) save += 40;
    }
    if (s.board[i] === -s.turn) {
      enemies++;
      if (group(n, i).liberties.size === 1) save += 18;
    }
  }
  const capture = (n.captures[s.turn] - s.captures[s.turn]) * 100;
  return (
    capture +
    save +
    (g.liberties.size === 1 ? -100 : Math.min(g.liberties.size, 5) * 2) +
    (friends === 4 ? -120 : 0) +
    (enemies ? 5 : 0) +
    (friends === 0 ? 4 : 0) -
    Math.abs(r - (s.rows - 1) / 2) * 0.3 -
    Math.abs(c - (s.cols - 1) / 2) * 0.3
  );
}
export function chooseMove(s, difficulty = "medium") {
  const moves = legalMoves(s);
  if (!moves.length) return null;
  const noise = difficulty === "easy" ? 30 : difficulty === "medium" ? 3 : 0;
  if (s.game === "gomoku") {
    if (!s.board.some(Boolean))
      return { to: Math.floor(s.rows / 2) * s.cols + Math.floor(s.cols / 2) };
    return moves
      .filter((m) => nearby(s, m.to))
      .map((m) => ({
        m,
        v:
          linePotential(s, m.to, s.turn) * 1.15 +
          linePotential(s, m.to, -s.turn) +
          Math.random() * noise,
      }))
      .sort((a, b) => b.v - a.v)[0].m;
  }
  if (s.game === "go") {
    const ranked = moves
      .map((m) => ({
        m,
        v: goRank(s, m) + Math.random() * (difficulty === "easy" ? 10 : 2),
      }))
      .sort((a, b) => b.v - a.v);
    if (s.passes === 1 && s.ply > s.rows * s.cols * 0.7) return { pass: true };
    return ranked[0].m;
  }
  const side = s.turn,
    depth = difficulty === "easy" ? 1 : difficulty === "hard" ? 3 : 2;
  let budget = difficulty === "hard" ? 2200 : 900;
  const quick = (state, m) => {
    const n = applyMove(state, m);
    return { m, n, v: evaluate(n, side) };
  };
  function search(state, d, alpha, beta) {
    if (d <= 0 || state.winner !== null || --budget <= 0)
      return evaluate(state, side);
    const maximizing = state.turn === side;
    const options = legalMoves(state)
      .map((m) => quick(state, m))
      .sort((a, b) => (maximizing ? b.v - a.v : a.v - b.v))
      .slice(0, depth === 3 ? 10 : 18);
    if (!options.length) return evaluate(state, side);
    let best = maximizing ? -Infinity : Infinity;
    for (const o of options) {
      const v = search(o.n, d - 1, alpha, beta);
      best = maximizing ? Math.max(best, v) : Math.min(best, v);
      if (maximizing) alpha = Math.max(alpha, best);
      else beta = Math.min(beta, best);
      if (beta <= alpha || budget <= 0) break;
    }
    return best;
  }
  const options = moves.map((m) => quick(s, m)).sort((a, b) => b.v - a.v);
  let best = -Infinity,
    choice = options[0].m;
  for (const o of options) {
    const score =
      search(o.n, depth - 1, -Infinity, Infinity) + Math.random() * noise;
    if (score > best) {
      best = score;
      choice = o.m;
    }
  }
  return choice;
}
