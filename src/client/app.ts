import { SHOGI_NAMES } from "../shared/shogi.js";
import { renderRiichi, type RiichiView, type RoomView } from "./riichi-ui.js";
import {
  GAMES,
  createGame,
  legalMoves,
  applyMove,
  scoringAction,
  areaScore,
  playerName,
  coordinate,
  owner,
  inCheck,
} from "../shared/engine.js";
import type {
  BoardState,
  GameId,
  GameMove,
  PlayerSide,
  RiichiWaitingState,
} from "../shared/game-types.js";
import { GAME_IDS, isGameId } from "../shared/protocol.js";
import type { Difficulty } from "./ai.js";

type Mode = "ai" | "local" | "online";
type SelectedCell = number | string | null;
type AppRiichiState = RiichiView & { game: "riichi"; rounds: number };
type AppState = BoardState | AppRiichiState;

interface ClientRoom extends RoomView {
  readonly code: string;
  readonly token: string;
  readonly side: number;
}

interface RoomResume {
  readonly code: string;
  readonly token: string;
}

interface DomElement extends HTMLElement {
  value: string;
  disabled: boolean;
  options: HTMLOptionsCollection;
  showModal(): void;
  close(): void;
}

interface SavedGame {
  readonly state: BoardState;
  readonly mode: Mode;
  readonly human: PlayerSide;
  readonly difficulty: Difficulty;
}

interface JoinedMessage {
  readonly type: "joined";
  readonly code: string;
  readonly token: string;
  readonly side: number;
}

interface RoomStateMessage {
  readonly type: "state";
  readonly code: string;
  readonly side: number;
  readonly state: BoardState | AppRiichiState | RiichiWaitingState;
  readonly players: RoomView["players"];
  readonly rematch: number[];
}

interface SocketErrorMessage {
  readonly type: "error";
  readonly message: string;
}

type SocketMessage = JoinedMessage | RoomStateMessage | SocketErrorMessage;

interface AiResponse {
  readonly id: number;
  readonly move?: GameMove | null;
  readonly error?: string;
}

const $ = (selector: string): DomElement => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`找不到畫面元素：${selector}`);
  return element as DomElement;
};
const $$ = (selector: string): DomElement[] =>
  Array.from(document.querySelectorAll(selector)) as unknown as DomElement[];
const find = (selector: string): DomElement | null =>
  document.querySelector<DomElement>(selector);

const isMode = (value: string | undefined): value is Mode =>
  value === "ai" || value === "local" || value === "online";

const isDifficulty = (value: string): value is Difficulty =>
  value === "easy" || value === "medium" || value === "hard";

const playerSide = (value: number): PlayerSide => (value === 1 ? 1 : -1);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "操作失敗，請稍後再試";

const isBoardState = (value: AppState | null): value is BoardState =>
  value !== null && value.game !== "riichi";

const asBoardState = (value: BoardState | { game: "riichi" }): BoardState => {
  if (value.game === "riichi") throw new Error("目前不是棋類狀態");
  return value;
};

const normalizeState = (
  value: BoardState | AppRiichiState | RiichiWaitingState,
  rounds: number,
): AppState => {
  if (value.game !== "riichi") return value;
  return {
    paused: false,
    wind: 0,
    round: 0,
    handNumber: 1,
    honba: 0,
    riichiSticks: 0,
    result: null,
    history: [],
    ...value,
    game: "riichi",
    rounds,
  };
};
const pieces: Record<string, string> = {
  wk: "♚",
  wq: "♛",
  wr: "♜",
  wb: "♝",
  wn: "♞",
  wp: "♟",
  bk: "♚",
  bq: "♛",
  br: "♜",
  bb: "♝",
  bn: "♞",
  bp: "♟",
};
let state: AppState | null = null,
  mode: Mode = "ai",
  human = 1,
  difficulty: Difficulty = "medium",
  selected: SelectedCell = null,
  snapshots: BoardState[] = [],
  worker: Worker | null = null,
  taskId = 0,
  thinking = false;
let setupGame: GameId = "gomoku",
  setupMode: Mode = "ai",
  socket: WebSocket | null = null,
  room: ClientRoom | null = null,
  connected = false,
  reconnectTimer: ReturnType<typeof setTimeout> | null = null,
  connectionPromise: Promise<void> | null = null;
let riichiWorker: Worker | null = null,
  riichiHandoff: number | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined,
  confirmCallback: (() => void) | null = null,
  networkBusy = false;
const store = {
  get(key: string): unknown {
    try {
      const value = localStorage.getItem(key);
      return value === null ? null : (JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 儲存空間不可用時維持目前對局即可。
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // 儲存空間不可用時維持目前對局即可。
    }
  },
};
const session = {
  get(): RoomResume | null {
    try {
      const value = sessionStorage.getItem("qiju-room");
      return value === null ? null : (JSON.parse(value) as RoomResume);
    } catch {
      return null;
    }
  },
  set(value: RoomResume | null): void {
    try {
      if (value) sessionStorage.setItem("qiju-room", JSON.stringify(value));
      else sessionStorage.removeItem("qiju-room");
    } catch {
      // 儲存空間不可用時維持目前房間連線即可。
    }
  },
};
function toast(message: string): void {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 4200);
}
function confirmAction(title: string, text: string, fn: () => void): void {
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  confirmCallback = fn;
  $("#confirm-dialog").showModal();
}
$("#confirm-no").onclick = () => {
  $("#confirm-dialog").close();
  confirmCallback = null;
};
$("#confirm-yes").onclick = () => {
  $("#confirm-dialog").close();
  const fn = confirmCallback;
  confirmCallback = null;
  fn?.();
};
$$(".close-dialog").forEach(
  (b) =>
    (b.onclick = () => {
      const dialog = b.closest("dialog") as DomElement | null;
      dialog?.close();
    }),
);
$$("dialog").forEach((d) => {
  d.addEventListener("click", (e) => {
    if (e.target === d && d.id !== "promotion-dialog") {
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        d.close();
    }
  });
});
function cardArt(game: GameId, index: number): string {
  if (game === "shogi")
    return `<div class="card-art shogi" aria-hidden="true"><span class="card-index">NEW / SHOGI</span><div class="shogi-art"><i>飛</i><i>王</i><i>角</i></div></div>`;
  if (game === "riichi")
    return `<div class="card-art riichi" aria-hidden="true"><span class="card-index">NEW / RIICHI</span><div class="riichi-art"><i>一<small>萬</small></i><i>發</i><i>中</i></div></div>`;
  const line = ["xiangqi", "gomoku", "go"].includes(game),
    n = line ? 5 : 6;
  let html = `<div class="card-art ${game}" aria-hidden="true"><span class="card-index">0${String(index + 1)} / QIJU</span><div class="mini-board ${line ? "lines" : ""}">`;
  const arrangement: Record<string, Record<number, string>> = {
    chess: { 7: "♜", 10: "♚", 14: "♟", 21: "♞", 26: "♙", 28: "♔" },
    xiangqi: { 6: "將", 8: "車", 12: "炮", 16: "馬", 18: "帥" },
    checkers: { 7: "b", 9: "b", 14: "w", 16: "b", 19: "w", 26: "w" },
    gomoku: { 6: "b", 7: "w", 12: "b", 13: "w", 18: "b", 21: "w" },
    go: { 5: "w", 6: "b", 7: "b", 11: "w", 12: "b", 13: "w", 17: "b", 18: "b" },
    reversi: {
      7: "b",
      8: "w",
      13: "b",
      14: "w",
      15: "b",
      20: "w",
      21: "b",
      26: "w",
    },
  };
  const values = arrangement[game] ?? {};
  for (let i = 0; i < n * n; i++) {
    const v = values[i];
    html += `<span class="mini-cell ${(Math.floor(i / n) + (i % n)) % 2 ? "dark" : ""} ${i > 20 ? "light-piece" : ""}">${!v ? "" : game === "chess" ? v : game === "xiangqi" ? `<i class="tiny-disc red">${v}</i>` : `<i class="tiny-disc ${v === "w" ? "white" : ""}"></i>`}</span>`;
  }
  return html + "</div></div>";
}
function renderCards(filter = "all"): void {
  const keys = [...GAME_IDS];
  $("#game-grid").innerHTML = keys
    .filter(
      (k) =>
        filter === "all" ||
        (filter === "easy"
          ? ["gomoku", "checkers", "reversi"].includes(k)
          : ["chess", "xiangqi", "go", "shogi", "riichi"].includes(k)),
    )
    .map((k) => {
      const g = GAMES[k];
      return `<article class="game-card">${cardArt(k, keys.indexOf(k))}<div class="card-info"><div class="card-title"><h3>${g.name}</h3><span>${g.en}</span></div><p>${g.desc}</p><div class="card-bottom">${g.tags.map((t) => `<span class="tag">${t}</span>`).join("")}<span class="card-arrow">↗</span></div></div><button class="card-hit" data-game="${k}" aria-label="開始${g.name}"></button></article>`;
    })
    .join("");
  $$("[data-game]").forEach(
    (b) =>
      (b.onclick = () => {
        if (isGameId(b.dataset.game)) openSetup(b.dataset.game);
      }),
  );
}
renderCards();
$$("[data-filter]").forEach(
  (b) =>
    (b.onclick = () => {
      $$("[data-filter]").forEach((x) => x.classList.toggle("active", x === b));
      renderCards(b.dataset.filter);
    }),
);
$("#decor-board").innerHTML = Array.from(
  { length: 64 },
  (_, i) =>
    `<span class="${(Math.floor(i / 8) + (i % 8)) % 2 ? "dark" : ""} ${i > 31 ? "white" : ""}">${{ 9: "♟", 12: "♚", 14: "♜", 19: "♟", 26: "♝", 37: "♙", 42: "♙", 45: "♕", 51: "♔" }[i] || ""}</span>`,
).join("");
function openSetup(game: GameId, chosenMode: Mode = "ai"): void {
  setupGame = game;
  setupMode = chosenMode;
  $("#setup-title").textContent = `來一局${GAMES[game].name}`;
  $("#setup-desc").textContent = GAMES[game].desc;
  $("#go-options").hidden = game !== "go";
  $("#riichi-options").hidden = game !== "riichi";
  const sideOptions = $("#side-choice").options;
  const firstOption = sideOptions[0];
  const secondOption = sideOptions[1];
  if (firstOption)
    firstOption.textContent =
      GAMES[game].first + (game === "shogi" ? "" : " · 先手");
  if (secondOption)
    secondOption.textContent =
      GAMES[game].second + (game === "shogi" ? "" : " · 後手");
  setSetupMode(chosenMode);
  $("#setup-dialog").showModal();
}
function setSetupMode(m: Mode): void {
  setupMode = m;
  $$("[data-mode]").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === m),
  );
  $("#ai-options").hidden = m !== "ai" || setupGame === "riichi";
  $('[data-mode="local"]').innerHTML =
    setupGame === "riichi"
      ? "<span>♟</span>同機四人<small>交接裝置</small>"
      : "<span>♟</span>同機雙人<small>面對面對弈</small>";
  $("#name-options").hidden = m !== "online";
  $("#setup-note").textContent =
    m === "ai"
      ? "內建休閒 AI，可選擇難度與先後手。"
      : m === "local"
        ? "輪流操作同一台裝置，一起享受棋盤上的時光。"
        : "建立房間後分享連結，朋友連線即可開始。";
  if (setupGame === "riichi")
    $("#setup-note").textContent =
      m === "ai"
        ? "你與三位日麻 AI 同桌，採用日式立直規則。"
        : m === "local"
          ? "四人輪流交接裝置，查看手牌前會顯示遮罩。日麻不提供本機存檔與悔棋。"
          : "四人房間；房主可用 AI 補齊空位後開始。";
  $("#start-button").innerHTML =
    (m === "online" ? "建立房間" : "開始對弈") + " <span>→</span>";
}
$$("[data-mode]").forEach(
  (b) =>
    (b.onclick = () => {
      if (isMode(b.dataset.mode)) setSetupMode(b.dataset.mode);
    }),
);
$("#quick-play").onclick = () => {
  openSetup("gomoku");
};
$("#invite-button").onclick = () => {
  openSetup("chess", "online");
};
function openJoin() {
  if (mode === "online" && room) {
    toast("你已在房間中，請先返回大廳離開房間。");
    return;
  }
  $("#join-dialog").showModal();
}
$("#header-join").onclick = openJoin;
$("#nav-friends").onclick = openJoin;
function rules(game?: GameId): void {
  const keys = game ? [game] : [...GAME_IDS];
  $("#rules-content").innerHTML = keys
    .map(
      (k) =>
        `<h3>${GAMES[k].icon} ${GAMES[k].name}</h3><p>${GAMES[k].rules}</p>`,
    )
    .join("");
  $("#rules-dialog").showModal();
}
$("#nav-rules").onclick = () => {
  rules();
};
$("#game-help").onclick = () => {
  rules(state?.game);
};
function cancelAI() {
  taskId++;
  worker?.terminate();
  worker = null;
  thinking = false;
}
function leaveRoom() {
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  room = null;
  session.set(null);
  if (socket?.readyState === 1) socket.send(JSON.stringify({ type: "leave" }));
  networkBusy = false;
}
function lobby() {
  cancelAI();
  riichiWorker?.terminate();
  riichiWorker = null;
  riichiHandoff = null;
  if (mode === "online") leaveRoom();
  $("#play-screen").hidden = true;
  $("#lobby").hidden = false;
  $("#crumb").textContent = "遊戲大廳";
  state = null;
  refreshResume();
  window.scrollTo(0, 0);
}
function returnLobby() {
  if (state?.winner === null && (mode === "online" || state.game === "riichi"))
    confirmAction(
      "離開對局？",
      mode === "online"
        ? "離開後對手會看到你已離線。此分頁將清除重連資訊。"
        : "本機日麻對局尚未結束，離開後無法恢復。",
      lobby,
    );
  else lobby();
}
$("#back-lobby").onclick = returnLobby;
$("#nav-lobby").onclick = returnLobby;
function showGame(): void {
  if (!state) return;
  $("#setup-dialog").close();
  $("#join-dialog").close();
  $("#lobby").hidden = true;
  $("#play-screen").hidden = false;
  $("#crumb").textContent = GAMES[state.game].name;
  render();
  window.scrollTo(0, 0);
}
function startLocalRiichi(rounds = Number($("#riichi-rounds").value)): void {
  cancelAI();
  riichiWorker?.terminate();
  networkBusy = false;
  human = 1;
  riichiHandoff = null;
  state = {
    game: "riichi",
    phase: "waiting",
    winner: null,
    paused: false,
    wind: 0,
    round: 0,
    handNumber: 1,
    honba: 0,
    riichiSticks: 0,
    result: null,
    rounds,
    history: [],
  };
  riichiWorker = new Worker("/riichi-worker.js", { type: "module" });
  riichiWorker.onmessage = ({
    data,
  }: MessageEvent<{
    type: string;
    message?: string;
    state: AppRiichiState;
    handoff: number | null;
  }>) => {
    networkBusy = false;
    if (data.type === "error") {
      toast(data.message ?? "日麻操作失敗");
      render();
      return;
    }
    state = data.state;
    riichiHandoff = data.handoff;
    render();
  };
  riichiWorker.onerror = () => {
    networkBusy = false;
    toast("日麻引擎載入失敗，請重新開局");
  };
  showGame();
  riichiWorker.postMessage({ type: "start", mode, rounds });
}

function save() {
  if (mode !== "online" && state && state.game !== "riichi")
    store.set("qiju-save", { state, mode, human, difficulty });
}
$("#setup-form").onsubmit = async (e) => {
  e.preventDefault();
  if (room) {
    toast("請先離開目前房間");
    return;
  }
  const selectedDifficulty = $("#difficulty").value;
  if (!isDifficulty(selectedDifficulty)) {
    toast("無效的 AI 難度");
    return;
  }
  difficulty = selectedDifficulty;
  human = Number($("#side-choice").value);
  cancelAI();
  snapshots = [];
  selected = null;
  if (setupMode === "online") {
    try {
      await ensureProductSession($("#player-name").value);
      await connect();
      const ws = socket;
      if (!ws) throw new Error("連線尚未建立");
      ws.send(
        JSON.stringify({
          type: "create",
          game: setupGame,
          size: Number($("#board-size").value),
          name: $("#player-name").value,
          rounds: Number($("#riichi-rounds").value),
        }),
      );
      $("#start-button").disabled = true;
    } catch (err) {
      toast(errorMessage(err));
    }
    return;
  }
  mode = setupMode;
  if (setupGame === "riichi") {
    startLocalRiichi();
    return;
  }
  state = asBoardState(createGame(setupGame, Number($("#board-size").value)));
  save();
  showGame();
  scheduleAI();
};
$("#join-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await ensureProductSession($("#join-name").value);
    await connect();
    const code = $("#join-code").value.trim().toUpperCase();
    const saved = session.get();
    const ws = socket;
    if (!ws) throw new Error("連線尚未建立");
    ws.send(
      JSON.stringify({
        type: "join",
        code,
        name: $("#join-name").value,
        token: saved?.code === code ? saved.token : undefined,
      }),
    );
  } catch (err) {
    toast(errorMessage(err));
  }
};
async function ensureProductSession(displayName: string): Promise<void> {
  const response = await fetch("/api/guest-session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: displayName.trim() || "訪客棋手" }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? "無法建立玩家 session");
  }
}
function connect(): Promise<void> {
  if (socket?.readyState === 1) return Promise.resolve();
  if (connectionPromise) return connectionPromise;
  connectionPromise = new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`,
    );
    socket = ws;
    const timer = setTimeout(() => {
      ws.close();
      reject(Error("連線逾時，請確認伺服器已啟動"));
    }, 7000);
    ws.onopen = () => {
      clearTimeout(timer);
      connected = true;
      resolve();
    };
    ws.onmessage = ({ data }: MessageEvent<unknown>) => {
      const msg = JSON.parse(String(data)) as SocketMessage;
      if (msg.type === "joined") {
        cancelAI();
        riichiWorker?.terminate();
        riichiWorker = null;
        riichiHandoff = null;
        room = { ...room, code: msg.code, token: msg.token, side: msg.side };
        session.set({ code: msg.code, token: msg.token });
        human = msg.side;
        mode = "online";
        snapshots = [];
        selected = null;
        $("#start-button").disabled = false;
      }
      if (msg.type === "state") {
        if (!room || room.code !== msg.code) return;
        const fresh = $("#play-screen").hidden;
        room = { ...room, players: msg.players ?? [], rematch: msg.rematch };
        state = normalizeState(
          msg.state,
          Number($("#riichi-rounds").value) || 1,
        );
        human = msg.side;
        networkBusy = false;
        selected = null;
        if (fresh) showGame();
        else render();
      }
      if (msg.type === "error") {
        networkBusy = false;
        $("#start-button").disabled = false;
        toast(msg.message);
        if (msg.message.includes("找不到房間") && room) {
          leaveRoom();
          mode = "ai";
          lobby();
        } else if (state) render();
      }
    };
    ws.onclose = (event) => {
      clearTimeout(timer);
      if (event.code === 4001) {
        room = null;
        session.set(null);
        mode = "local";
        toast("此座位已在另一個分頁登入");
        lobby();
      }
      connected = false;
      connectionPromise = null;
      networkBusy = false;
      reject(Error("無法連線，請確認伺服器已啟動"));
      if (mode === "online" && room) {
        render();
        if (ws.readyState === 3)
          reconnectTimer = setTimeout(() => {
            void (async (): Promise<void> => {
              try {
                await connect();
                const currentRoom = room;
                const currentSocket = socket;
                if (currentRoom && currentSocket)
                  currentSocket.send(
                    JSON.stringify({
                      type: "join",
                      code: currentRoom.code,
                      token: currentRoom.token,
                    }),
                  );
              } catch {
                // 下一輪重連會再次嘗試。
              }
            })();
          }, 2500);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(Error("無法連到遊戲伺服器"));
    };
  }).finally(() => {
    connectionPromise = null;
  });
  return connectionPromise;
}
function send(
  type:
    | "move"
    | "riichi-action"
    | "riichi-start"
    | "resign"
    | "rematch"
    | "dead"
    | "accept"
    | "resume",
  extra: Record<string, unknown> = {},
): void {
  if (socket?.readyState !== 1) {
    toast("連線中斷，正在嘗試重新連線");
    return;
  }
  socket.send(JSON.stringify({ type, ...extra }));
  networkBusy = true;
}
function canPlay(): boolean {
  if (!isBoardState(state)) return false;
  return (
    state.winner === null &&
    state.phase === "play" &&
    !thinking &&
    !networkBusy &&
    (mode === "local" || state.turn === playerSide(human)) &&
    (mode !== "online" ||
      Boolean(connected && room?.players?.every((p) => p?.online)))
  );
}
function render(): void {
  const current = state;
  if (!current) return;
  const mahjong = current.game === "riichi";
  $(".play-layout").hidden = mahjong;
  $("#riichi-table").hidden = !mahjong;
  $("#play-screen").classList.toggle("riichi-screen", mahjong);
  if (current.game === "riichi") {
    $("#mode-badge").textContent =
      mode === "ai"
        ? "✦ 日麻 AI 對戰"
        : mode === "local"
          ? "♟ 同機四人"
          : "♧ 四人好友房";
    renderRiichi($("#riichi-table"), current, {
      mode,
      room,
      human,
      connected,
      busy: networkBusy,
      handoff: riichiHandoff,
      onAction: (id) => {
        if (networkBusy) return;
        if (mode === "online") send("riichi-action", { actionId: id });
        else {
          networkBusy = true;
          riichiWorker?.postMessage({ type: "action", id });
        }
        render();
      },
      onReady: () => riichiWorker?.postMessage({ type: "ready" }),
      onStart: () => {
        send("riichi-start");
        render();
      },
      onCopy: () => {
        $("#copy-room").click();
      },
      onRules: () => {
        rules("riichi");
      },
      onRestart: () => {
        if (mode === "online") send("rematch");
        else
          confirmAction("再開一場日麻？", "目前的對局將結束。", () => {
            startLocalRiichi(current.rounds);
          });
      },
    });
    return;
  }
  const s = current;
  $(".board-panel").style.setProperty("--board-ratio", String(s.cols / s.rows));
  $("#game-title").textContent = GAMES[s.game].name;
  $("#game-en").textContent = GAMES[s.game].en;
  $("#mode-badge").textContent =
    mode === "ai"
      ? `✦ AI 對戰 · ${{ easy: "入門", medium: "標準", hard: "進階" }[difficulty]}`
      : mode === "local"
        ? "♟ 同機雙人"
        : "♧ 線上好友";
  const done = s.winner !== null,
    scoring = s.phase === "scoring",
    waiting =
      mode === "online" &&
      (!connected || !room?.players?.every((p) => p?.online));
  $("#turn-title").textContent = done
    ? s.winner === 0
      ? "握手言和"
      : s.winner === null
        ? ""
        : `${playerName(s, s.winner)}獲勝`
    : waiting
      ? !connected
        ? "重新連線中…"
        : "等待好友加入"
      : scoring
        ? "一起確認地盤"
        : thinking
          ? "AI 正在思考…"
          : `${playerName(s, s.turn)}的回合`;
  $("#turn-title").classList.toggle("thinking", thinking);
  $("#turn-detail").textContent = done
    ? s.reason
    : waiting
      ? "將房間連結分享給朋友，即可開始對局。"
      : scoring
        ? "點選死棋群，再確認計分；有爭議可繼續下。"
        : s.forced !== null
          ? "此棋子必須繼續跳吃。"
          : ["chess", "xiangqi", "shogi"].includes(s.game) && inCheck(s)
            ? "將軍！請保護你的主帥。"
            : mode === "ai"
              ? s.turn === human
                ? "輪到你了，走出你的下一步。"
                : "好棋，值得多想一下。"
              : mode === "online"
                ? s.turn === human
                  ? "輪到你落子。"
                  : "等待對手落子。"
                : "輪流操作棋盤，享受這一局。";
  $("#room-info").hidden = mode !== "online";
  if (room) $("#room-code").textContent = room.code;
  $("#pass-button").hidden = s.game !== "go" || scoring || done;
  $("#pass-button").disabled = !canPlay();
  $("#accept-score").hidden = !scoring;
  $("#resume-button").hidden = !scoring;
  $("#accept-score").disabled =
    mode === "online" &&
    (waiting || networkBusy || s.accepted.includes(playerSide(human)));
  $("#resume-button").disabled = mode === "online" && (waiting || networkBusy);
  $("#accept-score").textContent =
    mode === "local"
      ? `${playerName(s, s.accepted.includes(1) ? -1 : 1)}確認`
      : "確認數子";
  $("#undo-button").hidden = mode === "online";
  $("#undo-button").disabled = !snapshots.length || scoring;
  $("#restart-button").textContent =
    mode === "online"
      ? room?.rematch?.includes(human)
        ? "等待對手同意"
        : "再來一局"
      : "重新開局";
  $("#restart-button").disabled = Boolean(
    mode === "online" && (!done || waiting || room?.rematch?.includes(human)),
  );
  $("#resign-button").hidden = done;
  $("#resign-button").disabled = mode === "online" && (waiting || networkBusy);
  $("#score-info").textContent =
    s.game === "go"
      ? scoring || done
        ? `面積計分：黑 ${String(areaScore(s)[1])} · 白 ${String(areaScore(s)[-1])}（含 6.5 貼目）${scoring && s.accepted.length ? " · 一方已確認" : ""}`
        : `提子：黑 ${String(s.captures[1])} · 白 ${String(s.captures[-1])}\u3000白貼 6.5 目`
      : s.game === "reversi"
        ? `黑 ${String(s.board.filter((p) => p === 1).length)} 子 · 白 ${String(s.board.filter((p) => p === -1).length)} 子`
        : "";
  renderPlayer("#opponent-row", playerSide(mode === "local" ? -1 : -human));
  renderPlayer("#self-row", playerSide(mode === "local" ? 1 : human));
  renderBoard();
  $("#board-tip").textContent = scoring
    ? "點選整群棋子標記／取消死棋，半透明棋子將移除計分。"
    : done
      ? "這一盤已結束，準備好再來一局了嗎？"
      : ["chess", "xiangqi", "checkers", "shogi"].includes(s.game)
        ? "點選己方棋子，再點選標示的合法位置。"
        : "點選交叉點或空格落子；最後一手會以金色標記。";
  $("#move-count").textContent = `${String(s.ply)} 手`;
  $("#history").innerHTML = s.history.length
    ? s.history
        .map(
          (h, i) =>
            `<div class="history-entry"><span>${String(i + 1)}</span><span>${playerName(s, h.side)}</span><strong>${h.label}</strong></div>`,
        )
        .join("")
    : '<div class="history-empty">棋盤已就緒<br>你的第一步，會從哪裡開始？</div>';
  $("#history").scrollTop = $("#history").scrollHeight;
}
function renderPlayer(selector: string, side: PlayerSide): void {
  const s = state;
  if (!isBoardState(s)) return;
  const el = $(selector);
  el.replaceChildren();
  const avatar = document.createElement("div");
  avatar.className = "player-avatar";
  avatar.textContent =
    mode === "ai" && side !== human ? "✦" : side === 1 ? "●" : "○";
  const meta = document.createElement("div");
  meta.className = "player-meta";
  const name =
    mode === "online"
      ? room?.players?.[side === 1 ? 0 : 1]?.name || "等待棋手"
      : mode === "ai"
        ? side === human
          ? "你"
          : "棋聚 AI"
        : playerName(s, side);
  meta.append(document.createTextNode(name));
  const small = document.createElement("small");
  small.textContent =
    playerName(s, side) + (mode === "online" && side === human ? " · 你" : "");
  meta.append(small);
  const status = document.createElement("div");
  status.className = "player-status";
  const online =
    mode !== "online" || room?.players?.[side === 1 ? 0 : 1]?.online;
  status.textContent = !online
    ? "未連線"
    : s.winner !== null
      ? "對局結束"
      : s.turn === side
        ? "● 思考中"
        : "等待中";
  el.append(avatar, meta, status);
}
function renderBoard(): void {
  const s = state;
  if (!isBoardState(s)) return;
  const board = $("#board"),
    lines = ["go", "gomoku", "xiangqi"].includes(s.game);
  board.style.setProperty("--cols", String(s.cols));
  board.style.setProperty("--rows", String(s.rows));
  board.className =
    (lines ? "intersection " : "") +
    (s.game === "reversi"
      ? "reversi-board"
      : s.game === "shogi"
        ? "shogi-board"
        : "");
  board.setAttribute("aria-label", GAMES[s.game].name + "棋盤");
  const targets =
    selected === null
      ? s.game === "reversi" && canPlay()
        ? legalMoves(s)
        : []
      : legalMoves(s).filter((m) =>
          typeof selected === "string"
            ? m.drop === Number(selected.split(":")[1])
            : m.from === selected,
        );
  let html = "";
  for (let i = 0; i < s.board.length; i++) {
    const p = s.board[i],
      r = Math.floor(i / s.cols),
      c = i % s.cols;
    const numericPiece = typeof p === "number" ? p : 0;
    const chessPiece = typeof p === "string" ? p : "";
    let piece = "";
    if (p) {
      if (s.game === "chess" && chessPiece)
        piece = `<span class="piece chess-piece ${owner(chessPiece) === 1 ? "white" : ""}">${pieces[chessPiece] ?? ""}</span>`;
      else if (s.game === "shogi")
        piece = `<span class="piece shogi-piece ${numericPiece < 0 ? "opposing" : ""} ${Math.abs(numericPiece) > 8 ? "promoted" : ""}">${SHOGI_NAMES[Math.abs(numericPiece)] ?? ""}</span>`;
      else if (s.game === "xiangqi")
        piece = `<span class="piece xiangqi-piece ${numericPiece > 0 ? "red" : ""}">${(numericPiece > 0 ? ["", "兵", "炮", "車", "馬", "相", "仕", "帥"] : ["", "卒", "砲", "車", "馬", "象", "士", "將"])[Math.abs(numericPiece)] ?? ""}</span>`;
      else
        piece = `<span class="piece stone ${numericPiece < 0 ? "white" : ""} ${s.game === "checkers" ? "checker" : ""} ${s.dead.includes(i) ? "dead" : ""}">${s.game === "checkers" && Math.abs(numericPiece) === 2 ? "♔" : ""}</span>`;
    }
    const last = s.last?.to === i || s.last?.from === i;
    const classes = [
      "cell",
      (r + c) % 2 ? "dark" : "",
      r === 0 ? "top" : "",
      r === s.rows - 1 ? "bottom" : "",
      c === 0 ? "left" : "",
      c === s.cols - 1 ? "right" : "",
      selected === i ? "selected" : "",
      last ? "last" : "",
      targets.some((m) => m.to === i) ? "legal" : "",
    ].join(" ");
    const star =
      (s.game === "go" &&
        [
          s.rows === 9 ? 2 : 3,
          (s.rows - 1) / 2,
          s.rows === 9 ? 6 : s.rows - 4,
        ].includes(r) &&
        [
          s.rows === 9 ? 2 : 3,
          (s.rows - 1) / 2,
          s.rows === 9 ? 6 : s.rows - 4,
        ].includes(c)) ||
      (s.game === "gomoku" && [3, 7, 11].includes(r) && [3, 7, 11].includes(c));
    const pieceName =
      s.game === "shogi"
        ? SHOGI_NAMES[Math.abs(numericPiece)] || ""
        : s.game === "chess"
          ? { k: "王", q: "后", r: "車", b: "象", n: "馬", p: "兵" }[
              chessPiece[1] ?? ""
            ] || ""
          : s.game === "xiangqi"
            ? (numericPiece > 0
                ? ["", "兵", "炮", "車", "馬", "相", "仕", "帥"]
                : ["", "卒", "砲", "車", "馬", "象", "士", "將"])[
                Math.abs(numericPiece)
              ] || ""
            : s.game === "checkers" && Math.abs(numericPiece) === 2
              ? "王"
              : "棋子";
    const pieceOwner = p ? owner(p) : 0;
    const pieceLabel =
      pieceOwner === 0 ? "" : ` ${playerName(s, pieceOwner)}${pieceName}`;
    html += `<button class="${classes}" data-cell="${String(i)}" aria-label="${coordinate(s, i)}${p ? pieceLabel : " 空位"}" ${selected === i ? 'aria-pressed="true"' : ""}>${star ? '<span class="star-point"></span>' : ""}${piece}</button>`;
  }
  if (s.game === "xiangqi")
    html +=
      '<div class="palace-lines" style="top:5%"></div><div class="palace-lines" style="top:75%"></div><div class="river-label"><span>楚河</span><span>漢界</span></div>';
  board.innerHTML = html;
  const hands: Array<readonly [string, PlayerSide]> = [
    ["#opponent-hand", playerSide(mode === "local" ? -1 : -human)],
    ["#self-hand", playerSide(mode === "local" ? 1 : human)],
  ];
  for (const [selector, side] of hands) {
    const el = $(selector);
    el.hidden = s.game !== "shogi";
    if (s.game !== "shogi") continue;
    el.innerHTML =
      `<span>${playerName(s, side)}持駒</span>` +
      s.hands[side]
        .map((n, t) =>
          n
            ? `<button data-drop="${String(t)}" ${!canPlay() || side !== s.turn ? "disabled" : ""} class="${selected === `drop:${String(t)}` ? "selected" : ""}">${SHOGI_NAMES[t] ?? ""} <small>×${String(n)}</small></button>`
            : "",
        )
        .join("");
    if (!s.hands[side].some(Boolean)) el.innerHTML += "<small>尚無持駒</small>";
    el.querySelectorAll<DomElement>("[data-drop]").forEach(
      (b) =>
        (b.onclick = () => {
          const drop = b.dataset.drop ?? "";
          selected = selected === `drop:${drop}` ? null : `drop:${drop}`;
          renderBoard();
        }),
    );
  }
}
$("#board").onclick = async (e: MouseEvent) => {
  const b = (e.target as Element | null)?.closest(
    "[data-cell]",
  ) as DomElement | null;
  const current = state;
  if (!b || !isBoardState(current)) return;
  const i = Number(b.dataset.cell);
  if (current.phase === "scoring") {
    if (
      mode === "online" &&
      (!connected || !room?.players?.every((p) => p?.online))
    )
      return;
    if (current.board[i]) scoreAction("dead", { to: i });
    return;
  }
  if (!canPlay()) return;
  if (["chess", "xiangqi", "checkers", "shogi"].includes(current.game)) {
    const moves = legalMoves(current);
    if (selected !== null) {
      const options = moves.filter(
        (m) =>
          (typeof selected === "string"
            ? m.drop === Number(selected.split(":")[1])
            : m.from === selected) && m.to === i,
      );
      if (options.length) {
        const firstMove = options[0];
        if (!firstMove) return;
        let move: GameMove = firstMove;
        if (options.length > 1) {
          const promotion = await choosePromotion(current.game === "shogi");
          if (!promotion) return;
          const promotedMove = options.find((m) =>
            current.game === "shogi"
              ? !!m.promote === (promotion === "yes")
              : m.promotion === promotion,
          );
          if (!promotedMove) return;
          move = promotedMove;
        }
        commit(move);
        return;
      }
    }
    if (owner(current.board[i] ?? 0) === current.turn) {
      if (current.forced !== null && i !== current.forced) {
        toast("請用剛才的棋子繼續連跳");
        return;
      }
      selected = selected === i ? null : i;
      renderBoard();
    } else {
      selected = null;
      renderBoard();
    }
  } else commit({ to: i });
};
function choosePromotion(shogi = false): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const d = $("#promotion-dialog");
    $("#promotion-dialog h2").textContent = shogi
      ? "是否升變？"
      : "選擇升變棋子";
    $("#promotion-dialog p").textContent = shogi
      ? "移動已進出敵陣，可以選擇成或不成。"
      : "兵已抵達底線，選擇你的新棋子。";
    const promotionNames: Record<string, string> = {
      q: "后",
      r: "車",
      b: "象",
      n: "馬",
    };
    const promotions = shogi ? ["yes", "no"] : ["q", "r", "b", "n"];
    $("#promotion-options").innerHTML = promotions
      .map((p) =>
        shogi
          ? `<button data-promotion="${p}">${p === "yes" ? "成" : "不成"}</button>`
          : `<button data-promotion="${p}" aria-label="升變為${promotionNames[p] ?? ""}">${pieces["w" + p] ?? ""}</button>`,
      )
      .join("");
    $$("[data-promotion]").forEach(
      (b) =>
        (b.onclick = () => {
          d.close();
          resolve(b.dataset.promotion ?? null);
        }),
    );
    d.oncancel = () => {
      resolve(null);
    };
    d.showModal();
  });
}
function commit(m: GameMove): void {
  const current = state;
  if (!isBoardState(current)) return;
  if (mode === "online") {
    send("move", { move: m, ply: current.ply });
    return;
  }
  try {
    const next = asBoardState(applyMove(current, m));
    snapshots.push(current);
    state = next;
    selected = next.forced;
    save();
    render();
    scheduleAI();
  } catch (err) {
    toast(errorMessage(err));
  }
}
function scheduleAI(): void {
  const current = state;
  if (!isBoardState(current)) return;
  if (
    mode !== "ai" ||
    current.winner !== null ||
    current.phase !== "play" ||
    current.turn === playerSide(human)
  )
    return;
  cancelAI();
  thinking = true;
  render();
  const id = taskId;
  worker = new Worker("/ai-worker.js", { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<AiResponse>) => {
    if (data.id !== taskId) return;
    thinking = false;
    worker?.terminate();
    worker = null;
    if (data.error) {
      toast("AI 思考失敗：" + data.error);
      render();
      return;
    }
    if (data.move) commit(data.move);
  };
  worker.onerror = () => {
    thinking = false;
    toast("AI 載入失敗，請重新整理後再試");
    render();
  };
  worker.postMessage({ id, state: current, difficulty });
}
$("#pass-button").onclick = () => {
  if (canPlay()) commit({ pass: true });
};
function scoreAction(
  type: "dead" | "accept" | "resume",
  extra: { readonly to?: number } = {},
): void {
  const current = state;
  if (!isBoardState(current)) return;
  if (mode === "online") {
    send(type, extra);
    return;
  }
  try {
    const scored = asBoardState(
      scoringAction(
        current,
        { type, ...extra },
        mode === "local"
          ? current.accepted.includes(1)
            ? -1
            : 1
          : playerSide(human),
      ),
    );
    state = scored;
    if (type === "accept" && mode === "ai" && scored.phase === "scoring")
      state = asBoardState(
        scoringAction(scored, { type: "accept" }, playerSide(-human)),
      );
    save();
    render();
    scheduleAI();
  } catch (err) {
    toast(errorMessage(err));
  }
}
$("#accept-score").onclick = () => {
  scoreAction("accept");
};
$("#resume-button").onclick = () => {
  scoreAction("resume");
};
$("#undo-button").onclick = () => {
  if (!snapshots.length) return;
  cancelAI();
  const previous = snapshots.pop();
  if (!previous) return;
  let restored = previous;
  if (mode === "ai") {
    while (restored.turn !== playerSide(human) && snapshots.length) {
      const next = snapshots.pop();
      if (next) restored = next;
    }
  }
  state = restored;
  selected = restored.forced;
  save();
  render();
  scheduleAI();
};
$("#restart-button").onclick = () => {
  if (mode === "online") {
    send("rematch");
    return;
  }
  const current = state;
  if (!isBoardState(current)) return;
  confirmAction(
    "重新開始這一局？",
    "目前的對局紀錄會清除，重新回到起始局面。",
    () => {
      cancelAI();
      state = asBoardState(createGame(current.game, current.rows));
      snapshots = [];
      selected = null;
      save();
      render();
      scheduleAI();
    },
  );
};
$("#resign-button").onclick = () => {
  if (!isBoardState(state)) return;
  confirmAction(
    "確定要認輸？",
    "認輸後將結束這一局，你隨時可以再來挑戰。",
    () => {
      if (mode === "online") {
        send("resign");
        return;
      }
      cancelAI();
      const current = state;
      if (!isBoardState(current)) return;
      state = {
        ...current,
        winner: playerSide(-(mode === "ai" ? human : current.turn)),
        reason: "對手認輸",
      };
      save();
      render();
    },
  );
};
$("#copy-room").onclick = async () => {
  const currentRoom = room;
  if (!currentRoom) return;
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", currentRoom.code);
  try {
    await navigator.clipboard.writeText(url.href);
    toast(
      location.hostname === "localhost" || location.hostname === "127.0.0.1"
        ? "連結已複製；其他裝置請將 localhost 換成此電腦的區網 IP。"
        : "邀請連結已複製",
    );
  } catch {
    toast(`房間代碼：${currentRoom.code}，請手動分享網址與代碼。`);
  }
};
function refreshResume(): void {
  let button = find("#resume-save");
  const saved = store.get("qiju-save") as SavedGame | null;
  if (!saved || saved.state.winner !== null) {
    button?.remove();
    return;
  }
  if (!button) {
    button = document.createElement("button") as unknown as DomElement;
    button.id = "resume-save";
    button.className = "button outline";
    button.style.cssText =
      "margin:16px 0 0;width:100%;justify-content:space-between";
    $(".hero").after(button);
  }
  button.textContent = `繼續上次的${GAMES[saved.state.game].name || "棋局"} · 第 ${String(saved.state.ply + 1)} 手 →`;
  button.onclick = () => {
    try {
      cancelAI();
      state = saved.state;
      mode = saved.mode;
      human = saved.human;
      difficulty = saved.difficulty;
      snapshots = [];
      selected = null;
      showGame();
      scheduleAI();
    } catch {
      store.remove("qiju-save");
      toast("儲存的棋局無法讀取");
      lobby();
    }
  };
}
refreshResume();
const invite = new URL(location.href).searchParams.get("room"),
  savedRoom = session.get();
if (invite) {
  $("#join-code").value = invite.toUpperCase();
  openJoin();
} else if (savedRoom) {
  room = { ...savedRoom, side: 1 };
  mode = "online";
  connect()
    .then(() => {
      const ws = socket;
      if (!ws) throw new Error("連線尚未建立");
      ws.send(JSON.stringify({ type: "join", ...savedRoom }));
    })
    .catch((err: unknown) => {
      toast(errorMessage(err));
    });
}
