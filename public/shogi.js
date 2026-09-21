// Piece codes: pawn, lance, knight, silver, gold, bishop, rook, king.
// Promoted pieces use their original code + 8; signs encode ownership.
export const SHOGI_NAMES = [
  "",
  "步",
  "香",
  "桂",
  "銀",
  "金",
  "角",
  "飛",
  "玉",
  "と",
  "杏",
  "圭",
  "全",
  "",
  "馬",
  "龍",
];
const inside = (r, c) => r >= 0 && r < 9 && c >= 0 && c < 9;
const base = (p) => (Math.abs(p) > 8 ? Math.abs(p) - 8 : Math.abs(p));
const zone = (r, side) => (side === 1 ? r <= 2 : r >= 6);
const stranded = (type, r, side) =>
  [1, 2].includes(type)
    ? r === (side === 1 ? 0 : 8)
    : type === 3 && (side === 1 ? r <= 1 : r >= 7);
export function shogiKey(s) {
  return s.board.join(",") + "|" + JSON.stringify(s.hands) + "|" + s.turn;
}
export function createShogi() {
  const s = {
    game: "shogi",
    rows: 9,
    cols: 9,
    board: Array(81).fill(0),
    hands: { 1: Array(8).fill(0), "-1": Array(8).fill(0) },
    turn: 1,
    winner: null,
    reason: "",
    ply: 0,
    history: [],
    last: null,
    forced: null,
    phase: "play",
    dead: [],
    accepted: [],
    positions: [],
    checks: [],
  };
  const back = [2, 3, 4, 5, 8, 5, 4, 3, 2];
  for (let c = 0; c < 9; c++) {
    s.board[c] = -back[c];
    s.board[72 + c] = back[c];
    s.board[18 + c] = -1;
    s.board[54 + c] = 1;
  }
  s.board[10] = -7;
  s.board[16] = -6;
  s.board[64] = 6;
  s.board[70] = 7;
  s.positions = [shogiKey(s)];
  return s;
}
function attacks(s, from) {
  const p = s.board[from],
    side = Math.sign(p),
    t = Math.abs(p),
    r = Math.floor(from / 9),
    c = from % 9,
    out = [];
  const add = (dr, dc, slide = false) => {
    let rr = r + dr,
      cc = c + dc;
    while (inside(rr, cc)) {
      const to = rr * 9 + cc;
      if (Math.sign(s.board[to]) !== side) out.push(to);
      if (s.board[to] || !slide) break;
      rr += dr;
      cc += dc;
    }
  };
  if (t === 1) add(-side, 0);
  if (t === 2) add(-side, 0, true);
  if (t === 3) {
    add(-2 * side, -1);
    add(-2 * side, 1);
  }
  if (t === 4)
    for (const [dr, dc] of [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [1, -1],
      [1, 1],
    ])
      add(dr * side, dc);
  if ([5, 9, 10, 11, 12].includes(t))
    for (const [dr, dc] of [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, 0],
    ])
      add(dr * side, dc);
  if ([6, 14].includes(t))
    for (const [dr, dc] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      add(dr, dc, true);
  if ([7, 15].includes(t))
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      add(dr, dc, true);
  if (t === 8 || t === 14)
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      add(dr, dc);
  if (t === 8 || t === 15)
    for (const [dr, dc] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      add(dr, dc);
  return out;
}
export function shogiCheck(s, side = s.turn) {
  const king = s.board.indexOf(side * 8);
  return (
    king < 0 ||
    s.board.some(
      (p, i) => Math.sign(p) === -side && attacks(s, i).includes(king),
    )
  );
}
function moved(s, m) {
  const n = {
    ...s,
    board: [...s.board],
    hands: { 1: [...s.hands[1]], "-1": [...s.hands[-1]] },
  };
  if (m.drop) {
    n.hands[s.turn][m.drop]--;
    n.board[m.to] = s.turn * m.drop;
  } else {
    const captured = s.board[m.to];
    if (captured && base(captured) !== 8) n.hands[s.turn][base(captured)]++;
    n.board[m.to] = s.board[m.from] + (m.promote ? s.turn * 8 : 0);
    n.board[m.from] = 0;
  }
  n.turn = -s.turn;
  return n;
}
export function shogiMoves(s, checkPawnMate = true) {
  if (s.winner !== null) return [];
  const moves = [],
    side = s.turn;
  s.board.forEach((p, from) => {
    if (Math.sign(p) !== side) return;
    const t = Math.abs(p),
      r = Math.floor(from / 9);
    for (const to of attacks(s, from)) {
      if (Math.abs(s.board[to]) === 8) continue;
      const rr = Math.floor(to / 9);
      if (!stranded(t, rr, side))
        moves.push({ from, to, ...(s.board[to] ? { capture: to } : {}) });
      if ([1, 2, 3, 4, 6, 7].includes(t) && (zone(r, side) || zone(rr, side)))
        moves.push({
          from,
          to,
          promote: true,
          ...(s.board[to] ? { capture: to } : {}),
        });
    }
  });
  for (let t = 1; t <= 7; t++)
    if (s.hands[side][t])
      for (let to = 0; to < 81; to++) {
        if (s.board[to] || stranded(t, Math.floor(to / 9), side)) continue;
        if (t === 1 && s.board.some((p, i) => i % 9 === to % 9 && p === side))
          continue;
        moves.push({ drop: t, to });
      }
  return moves.filter((m) => {
    const n = moved(s, m);
    if (shogiCheck(n, side)) return false;
    if (
      checkPawnMate &&
      m.drop === 1 &&
      m.to - side * 9 === n.board.indexOf(-side * 8) &&
      shogiCheck(n, -side) &&
      !shogiMoves(n, false).length
    )
      return false;
    return true;
  });
}
export function applyShogi(s, request) {
  const m = shogiMoves(s).find(
    (x) =>
      x.from === request.from &&
      x.to === request.to &&
      (x.drop || 0) === (request.drop || 0) &&
      !!x.promote === !!request.promote,
  );
  if (!m) throw Error("這一步不符合將棋規則");
  const n = structuredClone(moved(s, m));
  n.ply++;
  n.last = m;
  n.history.push({
    side: s.turn,
    label: `${9 - (m.to % 9)}${"一二三四五六七八九"[Math.floor(m.to / 9)]}${SHOGI_NAMES[m.drop || Math.abs(s.board[m.from])]}${m.drop ? "打" : m.promote ? "成" : ""}`,
  });
  const checked = shogiCheck(n);
  n.checks.push({ side: s.turn, check: checked });
  n.positions.push(shogiKey(n));
  if (!shogiMoves(n).length) {
    n.winner = s.turn;
    n.reason = "詰み（無合法走法）";
  } else {
    const repeats = n.positions.flatMap((p, i) =>
      p === shogiKey(n) ? [i] : [],
    );
    if (repeats.length >= 4) {
      const cycle = n.checks.slice(repeats.at(-4));
      const perpetual = [1, -1].find(
        (side) =>
          cycle.some((x) => x.side === side) &&
          cycle.filter((x) => x.side === side).every((x) => x.check),
      );
      n.winner = perpetual ? -perpetual : 0;
      n.reason = perpetual
        ? "連續王手千日手：王手方負"
        : "千日手（四次重複局面）";
    }
  }
  return n;
}
