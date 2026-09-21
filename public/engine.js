import { createShogi, shogiMoves, applyShogi, shogiCheck } from "./shogi.js";
import { Chess } from "./vendor/chess.js";

export const GAMES = {
  shogi: {
    name: "將棋",
    en: "SHOGI",
    icon: "王",
    desc: "持駒再起，一手逆轉",
    tags: ["持駒打入", "9 × 9"],
    first: "先手",
    second: "後手",
    rules:
      "先手先行。吃下的棋子回復未成狀態，成為可打入空格的持駒。進出敵陣三段可選擇成；無法再移動的步、香、桂必須成。禁止二步、無行處打入、打步詰與自陷王手。四次相同局面為千日手，連續王手的一方判負。此版不實作入玉宣言或持將棋點數裁定。",
  },
  riichi: {
    name: "日式麻將",
    en: "RIICHI MAHJONG",
    icon: "發",
    desc: "一巡一念，立直勝負",
    tags: ["四人立直", "赤寶牌"],
    first: "東家",
    second: "南家",
    rules:
      "四人日式立直麻將，25000 點起始，含赤寶牌、吃碰明暗加槓、立直、一發、振聽、榮和、自摸、役種及符番計分。可選單局、東風或半莊；雙響、三家和流局、途中流局、聽牌連莊及負分飛人由規則引擎處理。AI 模式為你與三位 AI；同機模式需交接裝置；好友房可由房主以 AI 補滿空位。",
  },
  chess: {
    name: "西洋棋",
    en: "CHESS",
    icon: "♞",
    desc: "運籌帷幄，直指王城",
    tags: ["經典策略", "8 × 8"],
    first: "白方",
    second: "黑方",
    rules:
      "白方先行。點選棋子，再點選亮起的位置移動。包含王車易位、吃過路兵、升變、將軍與將死；三次重複局面及五十步規則自動判和。",
  },
  xiangqi: {
    name: "象棋",
    en: "XIANGQI",
    icon: "帥",
    desc: "楚河漢界，方寸爭鋒",
    tags: ["東方經典", "9 × 10"],
    first: "紅方",
    second: "黑方",
    rules:
      "紅方先行。馬走日、象走田，炮隔子吃棋。包含蹩馬腿、塞象眼、九宮與將帥照面限制；將死或無合法走法即負。休閒規則：相同局面出現三次判和，不裁定競賽長將長捉。",
  },
  checkers: {
    name: "西洋跳棋",
    en: "CHECKERS",
    icon: "◉",
    desc: "步步躍進，逆轉戰局",
    tags: ["連跳吃子", "8 × 8"],
    first: "深色方",
    second: "淺色方",
    rules:
      "採英美式西洋跳棋，深色先行。普通棋只能向前斜走或斜跳，抵達底線升王。有吃必吃，同一棋子能繼續吃時必須連跳；升王立即結束該回合。無子或無合法走法即負，80 個半回合無吃子或升王判和。",
  },
  gomoku: {
    name: "五子棋",
    en: "GOMOKU",
    icon: "⁙",
    desc: "一線之間，勝負已定",
    tags: ["輕鬆上手", "15 × 15"],
    first: "黑方",
    second: "白方",
    rules:
      "黑方先行，雙方輪流在交叉點落子。橫、直或斜線連成五顆以上即獲勝。採自由規則，不設三三、四四與長連禁手。",
  },
  go: {
    name: "圍棋",
    en: "GO",
    icon: "●",
    desc: "黑白交錯，圍出天地",
    tags: ["領地博弈", "9 / 13 / 19 路"],
    first: "黑方",
    second: "白方",
    rules:
      "黑方先行，白方貼 6.5 目。無氣棋子被提走，禁止自殺與重複全盤局面（位置超劫）。連續兩次停一手進入數子：點選死棋群，再由雙方確認；有爭議可繼續下。使用面積計分（活子＋單方圍住空點）。AI 對局由玩家標記死棋後確認，AI 不另行裁定死活。",
  },
  reversi: {
    name: "黑白棋",
    en: "REVERSI",
    icon: "◐",
    desc: "翻轉黑白，掌握全局",
    tags: ["逆轉攻防", "8 × 8"],
    first: "黑方",
    second: "白方",
    rules:
      "黑方先行。落子必須在至少一個方向夾住對手棋子，夾住的棋子全部翻為己方。無合法走法時自動跳過；雙方皆無法落子時，以棋子多者獲勝。",
  },
};
export const clone = (s) => structuredClone(s);
const inside = (s, r, c) => r >= 0 && r < s.rows && c >= 0 && c < s.cols;
const dirs = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const eight = [...dirs, [1, 1], [1, -1], [-1, 1], [-1, -1]];
const sign = Math.sign;
const pos = (s, i) => [Math.floor(i / s.cols), i % s.cols];
const key = (s) => s.board.join(",");
export function createGame(game, size = 9) {
  if (!GAMES[game]) throw new Error("未知棋種");
  if (game === "shogi") return createShogi();
  if (game === "riichi")
    return { game, phase: "waiting", winner: null, ply: 0, history: [] };
  const rows =
    game === "xiangqi"
      ? 10
      : game === "gomoku"
        ? 15
        : game === "go"
          ? [9, 13, 19].includes(size)
            ? size
            : 9
          : 8;
  const cols = game === "xiangqi" ? 9 : rows;
  const s = {
    game,
    rows,
    cols,
    board: Array(rows * cols).fill(0),
    turn: 1,
    winner: null,
    reason: "",
    ply: 0,
    history: [],
    last: null,
    forced: null,
    quiet: 0,
    positions: [],
    passes: 0,
    captures: { 1: 0, "-1": 0 },
    phase: "play",
    dead: [],
    accepted: [],
  };
  if (game === "chess") {
    s.fen = new Chess().fen();
    syncChess(s);
  }
  if (game === "xiangqi") {
    const back = [3, 4, 5, 6, 7, 6, 5, 4, 3];
    for (let c = 0; c < 9; c++) {
      s.board[c] = -back[c];
      s.board[81 + c] = back[c];
    }
    for (const i of [19, 25]) s.board[i] = -2;
    for (const i of [64, 70]) s.board[i] = 2;
    for (let c = 0; c < 9; c += 2) {
      s.board[27 + c] = -1;
      s.board[54 + c] = 1;
    }
  }
  if (game === "checkers")
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if ((r + c) % 2 && (r < 3 || r > 4))
          s.board[r * 8 + c] = r < 3 ? -1 : 1;
  if (game === "reversi") {
    s.board[27] = -1;
    s.board[36] = -1;
    s.board[28] = 1;
    s.board[35] = 1;
  }
  s.positions = [
    game === "chess"
      ? s.fen.split(" ").slice(0, 4).join(" ")
      : key(s) + (game === "go" ? "" : ":1"),
  ];
  return s;
}
function syncChess(s) {
  const c = new Chess(s.fen);
  s.board = c
    .board()
    .flat()
    .map((p) => (p ? `${p.color}${p.type}` : 0));
  s.turn = c.turn() === "w" ? 1 : -1;
}
export const owner = (p) =>
  typeof p === "string" ? (p[0] === "w" ? 1 : -1) : sign(p);
const square = (i) => "abcdefgh"[i % 8] + (8 - Math.floor(i / 8));
const squareIndex = (x) => (8 - Number(x[1])) * 8 + "abcdefgh".indexOf(x[0]);
function xPseudo(s, from, attack = false) {
  const p = s.board[from],
    side = sign(p),
    type = Math.abs(p),
    [r, c] = pos(s, from),
    out = [];
  const add = (rr, cc) => {
    if (inside(s, rr, cc) && sign(s.board[rr * 9 + cc]) !== side)
      out.push({ from, to: rr * 9 + cc });
  };
  const palace = (rr, cc) =>
    cc >= 3 &&
    cc <= 5 &&
    (side === 1 ? rr >= 7 && rr <= 9 : rr >= 0 && rr <= 2);
  if (type === 1) {
    add(r - side, c);
    if (side === 1 ? r <= 4 : r >= 5) {
      add(r, c - 1);
      add(r, c + 1);
    }
  }
  if (type === 3 || type === 2)
    for (const [dr, dc] of dirs) {
      let screen = false;
      for (
        let rr = r + dr, cc = c + dc;
        inside(s, rr, cc);
        rr += dr, cc += dc
      ) {
        const v = s.board[rr * 9 + cc];
        if (!screen) {
          if (!v) add(rr, cc);
          else if (type === 3) {
            add(rr, cc);
            break;
          } else screen = true;
        } else if (v) {
          add(rr, cc);
          break;
        }
      }
    }
  if (type === 4)
    for (const [dr, dc] of [
      [2, 1],
      [2, -1],
      [-2, 1],
      [-2, -1],
      [1, 2],
      [-1, 2],
      [1, -2],
      [-1, -2],
    ]) {
      const leg =
        (r + (Math.abs(dr) === 2 ? sign(dr) : 0)) * 9 +
        c +
        (Math.abs(dc) === 2 ? sign(dc) : 0);
      if (!s.board[leg]) add(r + dr, c + dc);
    }
  if (type === 5)
    for (const dr of [-2, 2])
      for (const dc of [-2, 2])
        if (
          (side === 1 ? r + dr >= 5 : r + dr <= 4) &&
          !s.board[(r + dr / 2) * 9 + c + dc / 2]
        )
          add(r + dr, c + dc);
  if (type === 6)
    for (const dr of [-1, 1])
      for (const dc of [-1, 1]) if (palace(r + dr, c + dc)) add(r + dr, c + dc);
  if (type === 7) {
    for (const [dr, dc] of dirs)
      if (palace(r + dr, c + dc)) add(r + dr, c + dc);
    for (const dr of [-1, 1])
      for (let rr = r + dr; rr >= 0 && rr < 10; rr += dr) {
        const v = s.board[rr * 9 + c];
        if (v) {
          if (v === -side * 7) add(rr, c);
          break;
        }
      }
  }
  return out;
}
export function inCheck(s, side = s.turn) {
  if (s.game === "shogi") return shogiCheck(s, side);
  if (s.game === "chess") return new Chess(s.fen).isCheck();
  const k = s.board.indexOf(side * 7);
  return (
    k < 0 ||
    s.board.some(
      (p, i) =>
        sign(p) === -side && xPseudo(s, i, true).some((m) => m.to === k),
    )
  );
}
function checkersMoves(s, from, captureOnly = false) {
  const p = s.board[from],
    [r, c] = pos(s, from),
    out = [];
  for (const dr of Math.abs(p) === 2 ? [-1, 1] : [-sign(p)])
    for (const dc of [-1, 1]) {
      const rr = r + dr,
        cc = c + dc;
      if (!inside(s, rr, cc)) continue;
      const mid = rr * 8 + cc;
      if (!s.board[mid] && !captureOnly) out.push({ from, to: mid });
      if (
        sign(s.board[mid]) === -sign(p) &&
        inside(s, r + 2 * dr, c + 2 * dc) &&
        !s.board[(r + 2 * dr) * 8 + c + 2 * dc]
      )
        out.push({ from, to: (r + 2 * dr) * 8 + c + 2 * dc, capture: mid });
    }
  return out;
}
export function flips(s, to, side = s.turn) {
  if (s.board[to]) return [];
  const [r, c] = pos(s, to),
    all = [];
  for (const [dr, dc] of eight) {
    const chain = [];
    let rr = r + dr,
      cc = c + dc;
    while (inside(s, rr, cc) && s.board[rr * s.cols + cc] === -side) {
      chain.push(rr * s.cols + cc);
      rr += dr;
      cc += dc;
    }
    if (chain.length && inside(s, rr, cc) && s.board[rr * s.cols + cc] === side)
      all.push(...chain);
  }
  return all;
}
export function group(s, index) {
  const color = s.board[index],
    stones = [],
    liberties = new Set(),
    seen = new Set([index]),
    queue = [index];
  while (queue.length) {
    const i = queue.pop();
    stones.push(i);
    const [r, c] = pos(s, i);
    for (const [dr, dc] of dirs)
      if (inside(s, r + dr, c + dc)) {
        const n = (r + dr) * s.cols + c + dc;
        if (!s.board[n]) liberties.add(n);
        else if (s.board[n] === color && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
  }
  return { stones, liberties };
}
function goPlacement(s, to) {
  if (!Number.isInteger(to) || to < 0 || to >= s.board.length || s.board[to])
    return null;
  const n = { ...s, board: [...s.board] };
  n.board[to] = s.turn;
  const [r, c] = pos(s, to);
  let captured = 0;
  for (const [dr, dc] of dirs)
    if (inside(s, r + dr, c + dc)) {
      const i = (r + dr) * s.cols + c + dc;
      if (n.board[i] === -s.turn) {
        const g = group(n, i);
        if (!g.liberties.size) {
          captured += g.stones.length;
          g.stones.forEach((j) => (n.board[j] = 0));
        }
      }
    }
  if (!group(n, to).liberties.size || s.positions.includes(key(n))) return null;
  return { board: n.board, captured };
}
export function legalMoves(s) {
  if (s.game === "shogi") return shogiMoves(s);
  if (s.game === "riichi") return [];
  if (s.winner !== null || s.phase !== "play") return [];
  if (s.game === "chess")
    return new Chess(s.fen).moves({ verbose: true }).map((m) => ({
      from: squareIndex(m.from),
      to: squareIndex(m.to),
      ...(m.promotion ? { promotion: m.promotion } : {}),
      ...(m.captured ? { capture: squareIndex(m.to) } : {}),
    }));
  if (s.game === "xiangqi") {
    const out = [];
    s.board.forEach((p, i) => {
      if (sign(p) === s.turn)
        for (const m of xPseudo(s, i)) {
          const b = [...s.board];
          b[m.to] = b[m.from];
          b[m.from] = 0;
          if (!inCheck({ ...s, board: b }, s.turn))
            out.push({ ...m, ...(s.board[m.to] ? { capture: m.to } : {}) });
        }
    });
    return out;
  }
  if (s.game === "checkers") {
    if (s.forced !== null) return checkersMoves(s, s.forced, true);
    let all = [];
    s.board.forEach((p, i) => {
      if (sign(p) === s.turn) all.push(...checkersMoves(s, i));
    });
    return all.some((m) => m.capture !== undefined)
      ? all.filter((m) => m.capture !== undefined)
      : all;
  }
  if (s.game === "reversi")
    return s.board.flatMap((p, to) =>
      !p && flips(s, to).length ? [{ to }] : [],
    );
  if (s.game === "go")
    return [
      ...s.board.flatMap((p, to) => (!p && goPlacement(s, to) ? [{ to }] : [])),
      { pass: true },
    ];
  return s.board.flatMap((p, to) => (!p ? [{ to }] : []));
}
export function areaScore(s) {
  const b = [...s.board];
  for (const i of s.dead) b[i] = 0;
  const n = { ...s, board: b },
    score = { 1: 0, "-1": 6.5 },
    seen = new Set();
  b.forEach((p, i) => {
    if (p) score[p]++;
    else if (!seen.has(i)) {
      const q = [i],
        region = [],
        borders = new Set();
      seen.add(i);
      while (q.length) {
        const j = q.pop();
        region.push(j);
        const [r, c] = pos(n, j);
        for (const [dr, dc] of dirs)
          if (inside(n, r + dr, c + dc)) {
            const k = (r + dr) * s.cols + c + dc;
            if (b[k]) borders.add(b[k]);
            else if (!seen.has(k)) {
              seen.add(k);
              q.push(k);
            }
          }
      }
      if (borders.size === 1) score[[...borders][0]] += region.length;
    }
  });
  return score;
}
export function applyMove(state, request) {
  if (state.game === "shogi") return applyShogi(state, request);
  if (state.game === "riichi") throw Error("請使用日麻對局操作");
  if (state.winner !== null) throw new Error("本局已結束");
  if (state.phase !== "play") throw new Error("請先完成數子或繼續對局");
  let m;
  if (state.game === "go") {
    if (request.pass) m = { pass: true };
    else if (goPlacement(state, request.to)) m = { to: request.to };
  } else
    m = legalMoves(state).find((x) =>
      request.pass
        ? x.pass
        : !x.pass &&
          x.to === request.to &&
          x.from === request.from &&
          (x.promotion || "") === (request.promotion || ""),
    );
  if (!m) throw new Error("這一步不符合規則");
  const s = clone(state),
    side = s.turn;
  s.last = m;
  s.ply++;
  s.passes = m.pass ? s.passes + 1 : 0;
  let label = m.pass
    ? "停一手"
    : `${m.from !== undefined ? coordinate(s, m.from) + " → " : ""}${coordinate(s, m.to)}`;
  if (s.game === "chess") {
    const c = new Chess(s.fen);
    const played = c.move({
      from: square(m.from),
      to: square(m.to),
      promotion: m.promotion,
    });
    label = played.san;
    s.fen = c.fen();
    syncChess(s);
    if (c.isCheckmate()) {
      s.winner = side;
      s.reason = "將死";
    } else if (c.isDraw()) {
      s.winner = 0;
      s.reason = "和局";
    }
  } else if (s.game === "xiangqi") {
    s.board[m.to] = s.board[m.from];
    s.board[m.from] = 0;
    s.turn = -side;
    if (!legalMoves(s).length) {
      s.winner = side;
      s.reason = inCheck(s) ? "將死" : "無合法走法";
    }
  } else if (s.game === "checkers") {
    let p = s.board[m.from];
    s.board[m.from] = 0;
    s.board[m.to] = p;
    if (m.capture !== undefined) s.board[m.capture] = 0;
    const crowned = Math.abs(p) === 1 && (m.to < 8 || m.to >= 56);
    if (crowned) s.board[m.to] = side * 2;
    s.quiet = m.capture !== undefined || crowned ? 0 : s.quiet + 1;
    s.forced = null;
    if (
      m.capture !== undefined &&
      !crowned &&
      checkersMoves(s, m.to, true).length
    )
      s.forced = m.to;
    else s.turn = -side;
    if (!legalMoves(s).length) {
      s.winner = side;
      s.reason = "對手無合法走法";
    } else if (s.quiet >= 80) {
      s.winner = 0;
      s.reason = "80 半回合無進展";
    }
  } else if (s.game === "gomoku") {
    s.board[m.to] = side;
    const [r, c] = pos(s, m.to);
    for (const [dr, dc] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ]) {
      let count = 1;
      for (const dir of [-1, 1]) {
        let rr = r + dr * dir,
          cc = c + dc * dir;
        while (inside(s, rr, cc) && s.board[rr * s.cols + cc] === side) {
          count++;
          rr += dr * dir;
          cc += dc * dir;
        }
      }
      if (count >= 5) {
        s.winner = side;
        s.reason = "五子連線";
      }
    }
    if (s.winner === null && s.board.every(Boolean)) {
      s.winner = 0;
      s.reason = "棋盤已滿";
    }
    s.turn = -side;
  } else if (s.game === "reversi") {
    for (const i of flips(s, m.to)) s.board[i] = side;
    s.board[m.to] = side;
    s.turn = -side;
    if (!legalMoves(s).length) {
      s.turn = side;
      if (!legalMoves(s).length) {
        const diff = s.board.reduce((a, b) => a + b, 0);
        s.winner = sign(diff);
        s.reason = `黑 ${s.board.filter((x) => x === 1).length} · 白 ${s.board.filter((x) => x === -1).length}`;
      } else label += "（對手無棋可下）";
    }
  } else if (s.game === "go") {
    if (!m.pass) {
      const result = goPlacement(state, m.to);
      s.board = result.board;
      s.captures[side] += result.captured;
      s.positions.push(key(s));
    }
    s.turn = -side;
    if (s.passes === 2) {
      s.phase = "scoring";
      s.dead = [];
      s.accepted = [];
    }
  }
  if (["chess", "xiangqi", "checkers"].includes(s.game)) {
    const k =
      s.game === "chess"
        ? s.fen.split(" ").slice(0, 4).join(" ")
        : key(s) + ":" + s.turn;
    s.positions.push(k);
    if (s.winner === null && s.positions.filter((x) => x === k).length >= 3) {
      s.winner = 0;
      s.reason = "三次重複局面";
    }
  }
  s.history.push({ side, label });
  return s;
}
export function scoringAction(state, action, side) {
  if (state.game !== "go" || state.phase !== "scoring" || state.winner !== null)
    throw new Error("目前不在數子階段");
  const s = clone(state);
  if (action.type === "dead") {
    if (!Number.isInteger(action.to) || !s.board[action.to])
      throw new Error("請選擇棋子");
    const stones = group(s, action.to).stones;
    const remove = s.dead.includes(action.to);
    s.dead = remove
      ? s.dead.filter((i) => !stones.includes(i))
      : [...new Set([...s.dead, ...stones])];
    s.accepted = [];
  } else if (action.type === "resume") {
    s.phase = "play";
    s.passes = 0;
    s.dead = [];
    s.accepted = [];
  } else if (action.type === "accept") {
    if (side !== 1 && side !== -1) throw new Error("無效玩家");
    s.accepted = [...new Set([...s.accepted, side])];
    if (s.accepted.length === 2) {
      const score = areaScore(s);
      s.winner = sign(score[1] - score[-1]);
      s.reason = `黑 ${score[1]} · 白 ${score[-1]}（含貼目）`;
      s.phase = "finished";
    }
  } else throw new Error("未知數子操作");
  return s;
}
export function coordinate(s, i) {
  if (s.game === "shogi")
    return `${9 - (i % 9)}${"一二三四五六七八九"[Math.floor(i / 9)]}`;
  return `${"ABCDEFGHJKLMNOPQRST"[i % s.cols]}${s.rows - Math.floor(i / s.cols)}`;
}
export function playerName(s, side) {
  return side === 1 ? GAMES[s.game].first : GAMES[s.game].second;
}
