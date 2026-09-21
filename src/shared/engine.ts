import { Chess } from "chess.js";

import { applyShogi, createShogi, shogiCheck, shogiMoves } from "./shogi.js";
import type {
  BoardState,
  ChessState,
  Direction,
  GameId,
  GameMeta,
  GameMove,
  GameState,
  NumericBoardState,
  PlayerSide,
  RiichiWaitingState,
  ScoringAction,
  SideCounts,
} from "./game-types.js";

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
} satisfies Record<GameId, GameMeta>;

const at = <T>(values: readonly T[], index: number): T => {
  const value = values[index];
  if (value === undefined) throw new Error(`索引超出範圍：${String(index)}`);
  return value;
};

export const clone = <T>(state: T): T => structuredClone(state);

const inside = (
  state: { rows: number; cols: number },
  row: number,
  col: number,
): boolean => row >= 0 && row < state.rows && col >= 0 && col < state.cols;

const dirs: readonly Direction[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const eight: readonly Direction[] = [
  ...dirs,
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const sign = (value: number): PlayerSide | 0 =>
  Math.sign(value) as PlayerSide | 0;

const pos = (state: { cols: number }, index: number): [number, number] => [
  Math.floor(index / state.cols),
  index % state.cols,
];

const key = (state: { board: readonly (number | string)[] }): string =>
  state.board.join(",");

const boardAt = <T>(board: readonly T[], index: number): T => at(board, index);

const createBoardFields = (
  rows: number,
  cols: number,
): Omit<NumericBoardState, "game" | "board"> => ({
  rows,
  cols,
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
});

export function createGame(game: GameId, size = 9): GameState {
  if (game === "shogi") return createShogi();
  if (game === "riichi") {
    const waiting: RiichiWaitingState = {
      game,
      phase: "waiting",
      winner: null,
      ply: 0,
      history: [],
    };
    return waiting;
  }

  if (game === "chess") {
    const chess: ChessState = {
      game,
      rows: 8,
      cols: 8,
      board: Array<string | 0>(64).fill(0),
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
      fen: new Chess().fen(),
    };
    syncChess(chess);
    chess.positions = [chess.fen.split(" ").slice(0, 4).join(" ")];
    return chess;
  }

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
  const state: NumericBoardState = {
    game,
    board: Array<number>(rows * cols).fill(0),
    ...createBoardFields(rows, cols),
  };

  if (game === "xiangqi") {
    const back = [3, 4, 5, 6, 7, 6, 5, 4, 3];
    for (let col = 0; col < 9; col++) {
      state.board[col] = -boardAt(back, col);
      state.board[81 + col] = boardAt(back, col);
    }
    for (const index of [19, 25]) state.board[index] = -2;
    for (const index of [64, 70]) state.board[index] = 2;
    for (let col = 0; col < 9; col += 2) {
      state.board[27 + col] = -1;
      state.board[54 + col] = 1;
    }
  }
  if (game === "checkers") {
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 8; col++)
        if ((row + col) % 2 && (row < 3 || row > 4))
          state.board[row * 8 + col] = row < 3 ? -1 : 1;
  }
  if (game === "reversi") {
    state.board[27] = -1;
    state.board[36] = -1;
    state.board[28] = 1;
    state.board[35] = 1;
  }
  state.positions = [key(state) + (game === "go" ? "" : ":1")];
  return state;
}

function syncChess(state: ChessState): void {
  const chess = new Chess(state.fen);
  const board: Array<string | 0> = chess
    .board()
    .flat()
    .map((piece): string | 0 => (piece ? `${piece.color}${piece.type}` : 0));
  state.board = board;
  state.turn = chess.turn() === "w" ? 1 : -1;
}

export const owner = (piece: number | string): PlayerSide | 0 =>
  typeof piece === "string" ? (piece.startsWith("w") ? 1 : -1) : sign(piece);

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const square = (index: number): string =>
  `${at(FILES, index % 8)}${String(8 - Math.floor(index / 8))}`;

const squareIndex = (value: string): number => {
  const file = FILES.indexOf(value[0] ?? "");
  const rank = Number(value[1]);
  if (file < 0 || !Number.isInteger(rank) || rank < 1 || rank > 8)
    throw new Error(`無效西洋棋格位：${value}`);
  return (8 - rank) * 8 + file;
};

function xPseudo(state: NumericBoardState, from: number): GameMove[] {
  const piece = boardAt(state.board, from);
  const side = sign(piece);
  if (side === 0) return [];
  const type = Math.abs(piece);
  const [row, col] = pos(state, from);
  const out: GameMove[] = [];
  const add = (nextRow: number, nextCol: number): void => {
    if (
      inside(state, nextRow, nextCol) &&
      sign(boardAt(state.board, nextRow * 9 + nextCol)) !== side
    )
      out.push({ from, to: nextRow * 9 + nextCol });
  };
  const palace = (nextRow: number, nextCol: number): boolean =>
    nextCol >= 3 &&
    nextCol <= 5 &&
    (side === 1 ? nextRow >= 7 && nextRow <= 9 : nextRow >= 0 && nextRow <= 2);

  if (type === 1) {
    add(row - side, col);
    if (side === 1 ? row <= 4 : row >= 5) {
      add(row, col - 1);
      add(row, col + 1);
    }
  }
  if (type === 3 || type === 2) {
    for (const [dr, dc] of dirs) {
      let screen = false;
      for (
        let nextRow = row + dr, nextCol = col + dc;
        inside(state, nextRow, nextCol);
        nextRow += dr, nextCol += dc
      ) {
        const value = boardAt(state.board, nextRow * 9 + nextCol);
        if (!screen) {
          if (!value) add(nextRow, nextCol);
          else if (type === 3) {
            add(nextRow, nextCol);
            break;
          } else screen = true;
        } else if (value) {
          add(nextRow, nextCol);
          break;
        }
      }
    }
  }
  if (type === 4) {
    for (const [dr, dc] of [
      [2, 1],
      [2, -1],
      [-2, 1],
      [-2, -1],
      [1, 2],
      [-1, 2],
      [1, -2],
      [-1, -2],
    ] as const) {
      const leg =
        (row + (Math.abs(dr) === 2 ? sign(dr) : 0)) * 9 +
        col +
        (Math.abs(dc) === 2 ? sign(dc) : 0);
      if ((state.board[leg] ?? 0) === 0) add(row + dr, col + dc);
    }
  }
  if (type === 5) {
    for (const dr of [-2, 2])
      for (const dc of [-2, 2])
        if (
          (side === 1 ? row + dr >= 5 : row + dr <= 4) &&
          (state.board[(row + dr / 2) * 9 + col + dc / 2] ?? 0) === 0
        )
          add(row + dr, col + dc);
  }
  if (type === 6)
    for (const dr of [-1, 1])
      for (const dc of [-1, 1])
        if (palace(row + dr, col + dc)) add(row + dr, col + dc);
  if (type === 7) {
    for (const [dr, dc] of dirs)
      if (palace(row + dr, col + dc)) add(row + dr, col + dc);
    for (const dr of [-1, 1])
      for (
        let nextRow = row + dr;
        nextRow >= 0 && nextRow < 10;
        nextRow += dr
      ) {
        const value = boardAt(state.board, nextRow * 9 + col);
        if (value) {
          if (value === -side * 7) add(nextRow, col);
          break;
        }
      }
  }
  return out;
}

export function inCheck(state: BoardState, side = state.turn): boolean {
  if (state.game === "shogi") return shogiCheck(state, side);
  if (state.game === "chess") return new Chess(state.fen).isCheck();
  const king = state.board.indexOf(side * 7);
  return (
    king < 0 ||
    state.board.some(
      (piece, index) =>
        sign(piece) === -side &&
        xPseudo(state, index).some((m) => m.to === king),
    )
  );
}

function checkersMoves(
  state: NumericBoardState,
  from: number,
  captureOnly = false,
): GameMove[] {
  const piece = boardAt(state.board, from);
  const [row, col] = pos(state, from);
  const out: GameMove[] = [];
  const rowDirections = Math.abs(piece) === 2 ? [-1, 1] : [-sign(piece)];
  for (const dr of rowDirections)
    for (const dc of [-1, 1]) {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (!inside(state, nextRow, nextCol)) continue;
      const middle = nextRow * 8 + nextCol;
      if (!boardAt(state.board, middle) && !captureOnly)
        out.push({ from, to: middle });
      if (
        sign(boardAt(state.board, middle)) === -sign(piece) &&
        inside(state, row + 2 * dr, col + 2 * dc) &&
        boardAt(state.board, (row + 2 * dr) * 8 + col + 2 * dc) === 0
      )
        out.push({
          from,
          to: (row + 2 * dr) * 8 + col + 2 * dc,
          capture: middle,
        });
    }
  return out;
}

export function flips(
  state: NumericBoardState,
  to: number,
  side = state.turn,
): number[] {
  if (boardAt(state.board, to)) return [];
  const [row, col] = pos(state, to);
  const all: number[] = [];
  for (const [dr, dc] of eight) {
    const chain: number[] = [];
    let nextRow = row + dr;
    let nextCol = col + dc;
    while (
      inside(state, nextRow, nextCol) &&
      boardAt(state.board, nextRow * state.cols + nextCol) === -side
    ) {
      chain.push(nextRow * state.cols + nextCol);
      nextRow += dr;
      nextCol += dc;
    }
    if (
      chain.length &&
      inside(state, nextRow, nextCol) &&
      boardAt(state.board, nextRow * state.cols + nextCol) === side
    )
      all.push(...chain);
  }
  return all;
}

export function group(
  state: NumericBoardState,
  index: number,
): { stones: number[]; liberties: Set<number> } {
  const color = boardAt(state.board, index);
  const stones: number[] = [];
  const liberties = new Set<number>();
  const seen = new Set<number>([index]);
  const queue = [index];
  while (queue.length) {
    const current = queue.pop();
    if (current === undefined) break;
    stones.push(current);
    const [row, col] = pos(state, current);
    for (const [dr, dc] of dirs)
      if (inside(state, row + dr, col + dc)) {
        const next = (row + dr) * state.cols + col + dc;
        const value = boardAt(state.board, next);
        if (!value) liberties.add(next);
        else if (value === color && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
  }
  return { stones, liberties };
}

function goPlacement(
  state: NumericBoardState,
  to: number,
): { board: number[]; captured: number } | null {
  if (
    !Number.isInteger(to) ||
    to < 0 ||
    to >= state.board.length ||
    boardAt(state.board, to)
  )
    return null;
  const next = { ...state, board: [...state.board] };
  next.board[to] = state.turn;
  const [row, col] = pos(state, to);
  let captured = 0;
  for (const [dr, dc] of dirs)
    if (inside(state, row + dr, col + dc)) {
      const index = (row + dr) * state.cols + col + dc;
      if (boardAt(next.board, index) === -state.turn) {
        const target = group(next, index);
        if (!target.liberties.size) {
          captured += target.stones.length;
          target.stones.forEach((stone) => (next.board[stone] = 0));
        }
      }
    }
  if (!group(next, to).liberties.size || state.positions.includes(key(next)))
    return null;
  return { board: next.board, captured };
}

export function legalMoves(state: GameState): GameMove[] {
  if (state.game === "shogi") return shogiMoves(state);
  if (state.game === "riichi") return [];
  if (state.winner !== null || state.phase !== "play") return [];
  if (state.game === "chess")
    return new Chess(state.fen).moves({ verbose: true }).map((move) => ({
      from: squareIndex(move.from),
      to: squareIndex(move.to),
      ...(move.promotion ? { promotion: move.promotion } : {}),
      ...(move.captured ? { capture: squareIndex(move.to) } : {}),
    }));
  if (state.game === "xiangqi") {
    const out: GameMove[] = [];
    state.board.forEach((piece, index) => {
      if (sign(piece) === state.turn)
        for (const move of xPseudo(state, index)) {
          if (move.to === undefined) continue;
          const board = [...state.board];
          board[move.to] = boardAt(board, index);
          board[index] = 0;
          if (!inCheck({ ...state, board }, state.turn))
            out.push({
              ...move,
              ...(boardAt(state.board, move.to) ? { capture: move.to } : {}),
            });
        }
    });
    return out;
  }
  if (state.game === "checkers") {
    if (state.forced !== null) return checkersMoves(state, state.forced, true);
    let all: GameMove[] = [];
    state.board.forEach((piece, index) => {
      if (sign(piece) === state.turn)
        all = [...all, ...checkersMoves(state, index)];
    });
    return all.some((move) => move.capture !== undefined)
      ? all.filter((move) => move.capture !== undefined)
      : all;
  }
  if (state.game === "reversi")
    return state.board.flatMap((piece, to) =>
      !piece && flips(state, to).length ? [{ to }] : [],
    );
  if (state.game === "go")
    return [
      ...state.board.flatMap((piece, to) =>
        !piece && goPlacement(state, to) ? [{ to }] : [],
      ),
      { pass: true },
    ];
  return state.board.flatMap((piece, to) => (!piece ? [{ to }] : []));
}

export function areaScore(state: NumericBoardState): SideCounts {
  const board = [...state.board];
  for (const index of state.dead) board[index] = 0;
  const next = { ...state, board };
  const score: SideCounts = { 1: 0, "-1": 6.5 };
  const seen = new Set<number>();
  board.forEach((piece, index) => {
    if (piece) {
      const side = piece === 1 ? 1 : -1;
      score[side]++;
    } else if (!seen.has(index)) {
      const queue = [index];
      const region: number[] = [];
      const borders = new Set<PlayerSide>();
      seen.add(index);
      while (queue.length) {
        const current = queue.pop();
        if (current === undefined) break;
        region.push(current);
        const [row, col] = pos(next, current);
        for (const [dr, dc] of dirs)
          if (inside(next, row + dr, col + dc)) {
            const neighbor = (row + dr) * state.cols + col + dc;
            const value = boardAt(board, neighbor);
            if (value) borders.add(value === 1 ? 1 : -1);
            else if (!seen.has(neighbor)) {
              seen.add(neighbor);
              queue.push(neighbor);
            }
          }
      }
      const border = [...borders][0];
      if (borders.size === 1 && border !== undefined)
        score[border] += region.length;
    }
  });
  return score;
}

const sameMove = (left: GameMove, right: GameMove): boolean =>
  left.from === right.from &&
  left.to === right.to &&
  (left.promotion ?? "") === (right.promotion ?? "");

export function applyMove(state: GameState, request: GameMove): GameState {
  if (state.game === "shogi") return applyShogi(state, request);
  if (state.game === "riichi") throw new Error("請使用日麻對局操作");
  if (state.winner !== null) throw new Error("本局已結束");
  if (state.phase !== "play") throw new Error("請先完成數子或繼續對局");

  let move: GameMove | undefined;
  if (state.game === "go") {
    if (request.pass) move = { pass: true };
    else if (request.to !== undefined && goPlacement(state, request.to))
      move = { to: request.to };
  } else {
    move = legalMoves(state).find((candidate) =>
      request.pass
        ? candidate.pass
        : !candidate.pass && sameMove(candidate, request),
    );
  }
  if (!move || (!move.pass && move.to === undefined))
    throw new Error("這一步不符合規則");

  const next = clone(state);
  const side = next.turn;
  next.last = move;
  next.ply++;
  next.passes = move.pass ? next.passes + 1 : 0;
  let label = move.pass
    ? "停一手"
    : `${move.from !== undefined ? `${coordinate(next, move.from)} → ` : ""}${coordinate(next, move.to as number)}`;

  if (next.game === "chess") {
    if (move.from === undefined || move.to === undefined)
      throw new Error("西洋棋移動缺少格位");
    const chess = new Chess(next.fen);
    const played = chess.move({
      from: square(move.from),
      to: square(move.to),
      ...(move.promotion ? { promotion: move.promotion } : {}),
    });
    label = played.san;
    next.fen = chess.fen();
    syncChess(next);
    if (chess.isCheckmate()) {
      next.winner = side;
      next.reason = "將死";
    } else if (chess.isDraw()) {
      next.winner = 0;
      next.reason = "和局";
    }
  } else if (next.game === "xiangqi") {
    if (move.from === undefined || move.to === undefined)
      throw new Error("象棋移動缺少格位");
    next.board[move.to] = boardAt(next.board, move.from);
    next.board[move.from] = 0;
    next.turn = side === 1 ? -1 : 1;
    if (!legalMoves(next).length) {
      next.winner = side;
      next.reason = inCheck(next) ? "將死" : "無合法走法";
    }
  } else if (next.game === "checkers") {
    if (move.from === undefined || move.to === undefined)
      throw new Error("跳棋移動缺少格位");
    let piece = boardAt(next.board, move.from);
    next.board[move.from] = 0;
    next.board[move.to] = piece;
    if (move.capture !== undefined) next.board[move.capture] = 0;
    const crowned = Math.abs(piece) === 1 && (move.to < 8 || move.to >= 56);
    if (crowned) {
      piece = side * 2;
      next.board[move.to] = piece;
    }
    next.quiet = move.capture !== undefined || crowned ? 0 : next.quiet + 1;
    next.forced = null;
    if (
      move.capture !== undefined &&
      !crowned &&
      checkersMoves(next, move.to, true).length
    )
      next.forced = move.to;
    else next.turn = side === 1 ? -1 : 1;
    if (!legalMoves(next).length) {
      next.winner = side;
      next.reason = "對手無合法走法";
    } else if (next.quiet >= 80) {
      next.winner = 0;
      next.reason = "80 半回合無進展";
    }
  } else if (next.game === "gomoku") {
    if (move.to === undefined) throw new Error("五子棋落子缺少位置");
    next.board[move.to] = side;
    const [row, col] = pos(next, move.to);
    for (const [dr, dc] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ] as const) {
      let count = 1;
      for (const direction of [-1, 1]) {
        let nextRow = row + dr * direction;
        let nextCol = col + dc * direction;
        while (
          inside(next, nextRow, nextCol) &&
          boardAt(next.board, nextRow * next.cols + nextCol) === side
        ) {
          count++;
          nextRow += dr * direction;
          nextCol += dc * direction;
        }
      }
      if (count >= 5) {
        next.winner = side;
        next.reason = "五子連線";
      }
    }
    if (next.winner === null && next.board.every(Boolean)) {
      next.winner = 0;
      next.reason = "棋盤已滿";
    }
    next.turn = side === 1 ? -1 : 1;
  } else if (next.game === "reversi") {
    if (move.to === undefined) throw new Error("黑白棋落子缺少位置");
    for (const index of flips(next, move.to)) next.board[index] = side;
    next.board[move.to] = side;
    next.turn = side === 1 ? -1 : 1;
    if (!legalMoves(next).length) {
      next.turn = side;
      if (!legalMoves(next).length) {
        const difference = next.board.reduce(
          (total, value) => total + value,
          0,
        );
        next.winner = sign(difference);
        next.reason = `黑 ${String(next.board.filter((value) => value === 1).length)} · 白 ${String(next.board.filter((value) => value === -1).length)}`;
      } else label += "（對手無棋可下）";
    }
  } else {
    if (!move.pass) {
      if (move.to === undefined) throw new Error("圍棋落子缺少位置");
      const result = goPlacement(next, move.to);
      if (!result) throw new Error("這一步不符合規則");
      next.board = result.board;
      next.captures[side] += result.captured;
      next.positions.push(key(next));
    }
    next.turn = side === 1 ? -1 : 1;
    if (next.passes === 2) {
      next.phase = "scoring";
      next.dead = [];
      next.accepted = [];
    }
  }

  if (
    next.game === "chess" ||
    next.game === "xiangqi" ||
    next.game === "checkers"
  ) {
    const position =
      next.game === "chess"
        ? next.fen.split(" ").slice(0, 4).join(" ")
        : `${key(next)}:${String(next.turn)}`;
    next.positions.push(position);
    if (
      next.winner === null &&
      next.positions.filter((value) => value === position).length >= 3
    ) {
      next.winner = 0;
      next.reason = "三次重複局面";
    }
  }
  next.history.push({ side, label });
  return next;
}

export function scoringAction(
  state: GameState,
  action: ScoringAction,
  side: PlayerSide,
): GameState {
  if (state.game !== "go" || state.phase !== "scoring" || state.winner !== null)
    throw new Error("目前不在數子階段");
  const next = clone(state);
  if (action.type === "dead") {
    if (
      action.to === undefined ||
      !Number.isInteger(action.to) ||
      !next.board[action.to]
    )
      throw new Error("請選擇棋子");
    const stones = group(next, action.to).stones;
    const remove = next.dead.includes(action.to);
    next.dead = remove
      ? next.dead.filter((index) => !stones.includes(index))
      : [...new Set([...next.dead, ...stones])];
    next.accepted = [];
  } else if (action.type === "resume") {
    next.phase = "play";
    next.passes = 0;
    next.dead = [];
    next.accepted = [];
  } else {
    next.accepted = [...new Set([...next.accepted, side])];
    if (next.accepted.length === 2) {
      const score = areaScore(next);
      next.winner = sign(score[1] - score[-1]);
      next.reason = `黑 ${String(score[1])} · 白 ${String(score[-1])}（含貼目）`;
      next.phase = "finished";
    }
  }
  return next;
}

export function coordinate(state: BoardState, index: number): string {
  if (state.game === "shogi")
    return `${String(9 - (index % 9))}${at(SHOGI_RANKS, Math.floor(index / 9))}`;
  return `${at(BOARD_FILES, index % state.cols)}${String(state.rows - Math.floor(index / state.cols))}`;
}

const SHOGI_RANKS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const BOARD_FILES = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
];

export function playerName(state: GameState, side: PlayerSide): string {
  return side === 1 ? GAMES[state.game].first : GAMES[state.game].second;
}
