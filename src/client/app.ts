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
import {
  CHAT_HISTORY_LIMIT,
  CHAT_MAX_LENGTH,
  GAME_IDS,
  isGameId,
  type ChatMessage,
  type MatchmakingMode,
  type MatchmakingTimeControl,
  type RoomMode,
} from "../shared/protocol.js";
import type { Difficulty } from "./ai.js";

type Mode = "ai" | "local" | "online";
type SetupMode = Mode | "matchmaking" | "rated";
type SelectedCell = number | string | null;
type AppRiichiState = RiichiView & { game: "riichi"; rounds: number };
type AppState = BoardState | AppRiichiState;

interface ClientRoom extends RoomView {
  readonly code: string;
  readonly mode: RoomMode;
  readonly token: string;
  readonly side: number;
  readonly chat: readonly ChatMessage[];
}

interface RoomResume {
  readonly code: string;
  readonly token: string;
}

interface DomElement extends HTMLElement {
  value: string;
  maxLength: number;
  disabled: boolean;
  options: HTMLOptionsCollection;
  select(): void;
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
  readonly mode: RoomMode;
}

interface RoomStateMessage {
  readonly type: "state";
  readonly code: string;
  readonly side: number;
  readonly mode: RoomMode;
  readonly state: BoardState | AppRiichiState | RiichiWaitingState;
  readonly players: RoomView["players"];
  readonly rematch: number[];
  readonly chat: readonly ChatMessage[];
}

interface ChatSocketMessage {
  readonly type: "chat";
  readonly message: ChatMessage;
}

interface MatchmakingSocketMessage {
  readonly type: "matchmaking";
  readonly status: "waiting" | "matched" | "cancelled" | "expired";
  readonly ticket: string;
  readonly game: Exclude<GameId, "riichi">;
  readonly mode: MatchmakingMode;
  readonly timeControl: MatchmakingTimeControl;
  readonly expiresAt?: number;
}

interface SocketErrorMessage {
  readonly type: "error";
  readonly message: string;
}

type SocketMessage =
  | JoinedMessage
  | RoomStateMessage
  | ChatSocketMessage
  | MatchmakingSocketMessage
  | SocketErrorMessage;

interface AiResponse {
  readonly id: number;
  readonly move?: GameMove | null;
  readonly error?: string;
}

interface SocialPerson {
  readonly userId: string;
  readonly displayName: string;
}

interface FriendEntry extends SocialPerson {
  readonly since: number;
  readonly online: boolean | null;
}

interface FriendRequestEntry extends SocialPerson {
  readonly id: string;
  readonly createdAt: number;
}

interface BlockedPerson extends SocialPerson {
  readonly blockedAt: number;
}

interface FriendOverview {
  readonly friendCode: string;
  readonly friends: readonly FriendEntry[];
  readonly incomingRequests: readonly FriendRequestEntry[];
  readonly outgoingRequests: readonly FriendRequestEntry[];
  readonly blockedUsers: readonly BlockedPerson[];
}

interface RoomInvitePreview {
  readonly id: string;
  readonly roomCode: string;
  readonly game: GameId;
  readonly inviterId: string;
  readonly inviterName: string;
  readonly status: "pending" | "accepted";
  readonly createdAt: number;
  readonly expiresAt: number;
}

interface AcceptedRoomInvite extends RoomInvitePreview {
  readonly entryToken: string;
}

interface ProfileUser {
  readonly id: string;
  readonly publicCode: string;
  readonly loginName: string | null;
  readonly hasAccount: boolean;
  readonly displayName: string;
  readonly status: string;
}

interface ProfilePreferences {
  readonly friendInvites: boolean;
  readonly showOnlineStatus: boolean;
  readonly showInLeaderboard: boolean;
}

interface ProfileStats {
  readonly completed: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly byGame: readonly {
    readonly game: GameId;
    readonly completed: number;
    readonly wins: number;
    readonly losses: number;
    readonly draws: number;
  }[];
}

interface ProfileRating {
  readonly game: GameId;
  readonly rating: number;
  readonly gamesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly provisional: boolean;
}

interface ProfileData {
  readonly user: ProfileUser;
  readonly preferences: ProfilePreferences;
  readonly stats: ProfileStats;
  readonly ratings: readonly ProfileRating[];
}

interface LeaderboardEntry {
  readonly rank: number;
  readonly publicCode: string;
  readonly displayName: string;
  readonly rating: number;
  readonly gamesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly provisional: boolean;
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

const isSetupMode = (value: string | undefined): value is SetupMode =>
  isMode(value) || value === "rated" || value === "matchmaking";

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
  setupMode: SetupMode = "ai",
  socket: WebSocket | null = null,
  room: ClientRoom | null = null,
  connected = false,
  matchmakingTicket: string | null = null,
  reconnectTimer: ReturnType<typeof setTimeout> | null = null,
  connectionPromise: Promise<void> | null = null;
let riichiWorker: Worker | null = null,
  riichiHandoff: number | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined,
  confirmCallback: (() => void) | null = null,
  networkBusy = false;
let friendsRefreshTimer: ReturnType<typeof setInterval> | null = null,
  roomInvitePollTimer: ReturnType<typeof setInterval> | null = null,
  identityReconnectRequested = false,
  pendingRoomInviteJoin = false,
  roomInvitePollInFlight = false;
const knownRoomInviteIds = new Set<string>();
let pendingRoomInvite: {
  readonly id: string;
  readonly entryToken: string;
  readonly roomCode: string;
} | null = null;
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
      if (dialog?.id === "setup-dialog" && matchmakingTicket !== null)
        cancelQueuedMatchmaking();
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
function openSetup(game: GameId, chosenMode: SetupMode = "ai"): void {
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
function setSetupMode(m: SetupMode): void {
  setupMode = m;
  $$("[data-mode]").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === m),
  );
  $("#ai-options").hidden = m !== "ai" || setupGame === "riichi";
  $('[data-mode="local"]').innerHTML =
    setupGame === "riichi"
      ? "<span>♟</span>同機四人<small>交接裝置</small>"
      : "<span>♟</span>同機雙人<small>面對面對弈</small>";
  const ratedButton = find('[data-mode="rated"]');
  if (ratedButton) ratedButton.hidden = setupGame === "riichi";
  const matchmakingButton = find('[data-mode="matchmaking"]');
  if (matchmakingButton) matchmakingButton.hidden = setupGame === "riichi";
  $("#matchmaking-options").hidden = m !== "matchmaking";
  $("#name-options").hidden =
    m !== "online" && m !== "rated" && m !== "matchmaking";
  $("#setup-note").textContent =
    m === "ai"
      ? "內建休閒 AI，可選擇難度與先後手。"
      : m === "local"
        ? "輪流操作同一台裝置，一起享受棋盤上的時光。"
        : m === "rated"
          ? "競技房會在合法終局後更新雙方 ELO；需要玩家身份。"
          : m === "matchmaking"
            ? "伺服器會依棋種、配對類型與 ELO 範圍尋找對手；等待期間可以取消。"
            : "建立房間後分享連結，朋友連線即可開始。";
  if (setupGame === "riichi")
    $("#setup-note").textContent =
      m === "ai"
        ? "你與三位日麻 AI 同桌，採用日式立直規則。"
        : m === "local"
          ? "四人輪流交接裝置，查看手牌前會顯示遮罩。日麻不提供本機存檔與悔棋。"
          : "四人房間；房主可用 AI 補齊空位後開始。";
  $("#start-button").innerHTML =
    (m === "online" || m === "rated"
      ? "建立房間"
      : m === "matchmaking"
        ? "開始配對"
        : "開始對弈") + " <span>→</span>";
}
$$("[data-mode]").forEach(
  (b) =>
    (b.onclick = () => {
      if (isSetupMode(b.dataset.mode)) setSetupMode(b.dataset.mode);
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

function showSocialEmpty(selector: string, message: string): void {
  const row = document.createElement("li");
  row.className = "friend-empty";
  row.textContent = message;
  $(selector).replaceChildren(row);
}

function addSocialRow(
  selector: string,
  displayName: string,
  actions: readonly { readonly label: string; readonly run: () => void }[],
  statusText?: string,
  online = false,
): void {
  const row = document.createElement("li");
  row.className = "friend-row";
  const person = document.createElement("span");
  person.className = "friend-row-person";
  const name = document.createElement("span");
  name.className = "friend-row-name";
  name.textContent = displayName;
  person.append(name);
  if (statusText) {
    const status = document.createElement("span");
    status.className = `friend-status${online ? " online" : ""}`;
    status.textContent = statusText;
    person.append(status);
  }
  row.append(person);
  const buttons = document.createElement("div");
  buttons.className = "friend-row-actions";
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button small outline";
    button.textContent = action.label;
    button.onclick = action.run;
    buttons.append(button);
  }
  row.append(buttons);
  $(selector).append(row);
}

async function loadFriends(): Promise<void> {
  await ensureProductSession("");
  const [friendsResponse, invitesResponse] = await Promise.all([
    fetch("/api/me/friends", { credentials: "same-origin" }),
    fetch("/api/me/room-invites", { credentials: "same-origin" }),
  ]);
  const friendsPayload = (await friendsResponse.json().catch(() => null)) as
    | FriendOverview
    | { readonly error?: string }
    | null;
  if (!friendsResponse.ok)
    throw new Error(
      friendsPayload && "error" in friendsPayload
        ? (friendsPayload.error ?? "無法載入好友")
        : "無法載入好友",
    );
  const invitesPayload = (await invitesResponse.json().catch(() => null)) as
    | readonly RoomInvitePreview[]
    | { readonly error?: string }
    | null;
  if (!invitesResponse.ok)
    throw new Error(
      invitesPayload &&
      !Array.isArray(invitesPayload) &&
      "error" in invitesPayload
        ? (invitesPayload.error ?? "無法載入房間邀請")
        : "無法載入房間邀請",
    );
  if (!friendsPayload || !("friendCode" in friendsPayload))
    throw new Error("好友資料格式錯誤");
  if (!Array.isArray(invitesPayload)) throw new Error("房間邀請資料格式錯誤");
  renderFriends(friendsPayload, invitesPayload);
}

async function mutateFriends(
  path: string,
  method: "POST" | "DELETE",
  successMessage: string,
): Promise<void> {
  const response = await fetch(`/api/me/friends${path}`, {
    method,
    credentials: "same-origin",
  });
  const payload = (await response.json().catch(() => null)) as
    | { readonly error?: string }
    | FriendOverview
    | null;
  if (!response.ok)
    throw new Error(
      payload && "error" in payload
        ? (payload.error ?? "操作失敗")
        : "操作失敗",
    );
  await loadFriends();
  toast(successMessage);
}

function runFriendAction(
  path: string,
  method: "POST" | "DELETE",
  successMessage: string,
): () => void {
  return () => {
    void mutateFriends(path, method, successMessage).catch((error: unknown) => {
      toast(errorMessage(error));
    });
  };
}

async function createRoomInvitation(friendUserId: string): Promise<void> {
  const currentRoom = room;
  if (!currentRoom || currentRoom.mode !== "friend")
    throw new Error("請先建立好友私人房間");
  const response = await fetch("/api/me/room-invites", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomCode: currentRoom.code,
      friendUserId,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | RoomInvitePreview
    | { readonly error?: string }
    | null;
  if (!response.ok)
    throw new Error(
      payload && "error" in payload
        ? (payload.error ?? "無法送出房間邀請")
        : "無法送出房間邀請",
    );
  await loadFriends();
  toast("已送出房間邀請");
}

async function acceptRoomInvitation(invitationId: string): Promise<void> {
  if (mode === "online" && room)
    throw new Error("請先離開目前房間，再接受新的房間邀請");
  await ensureProductSession("");
  const response = await fetch(
    `/api/me/room-invites/${encodeURIComponent(invitationId)}/accept`,
    { method: "POST", credentials: "same-origin" },
  );
  const payload = (await response.json().catch(() => null)) as
    | AcceptedRoomInvite
    | { readonly error?: string }
    | null;
  if (!response.ok || !payload || !("entryToken" in payload))
    throw new Error(
      payload && "error" in payload
        ? (payload.error ?? "無法接受房間邀請")
        : "房間邀請資料格式錯誤",
    );
  await connect();
  const ws = socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("連線尚未建立");
  pendingRoomInvite = {
    id: payload.id,
    entryToken: payload.entryToken,
    roomCode: payload.roomCode,
  };
  pendingRoomInviteJoin = true;
  room = {
    code: payload.roomCode,
    mode: "friend",
    token: "",
    side: 1,
    chat: [],
  };
  mode = "online";
  $("#friends-dialog").close();
  ws.send(
    JSON.stringify({
      type: "join",
      code: payload.roomCode,
      name: $("#profile-display-name").value.trim() || "訪客棋手",
      invitationId: payload.id,
      invitationToken: payload.entryToken,
    }),
  );
}

async function rejectRoomInvitation(invitationId: string): Promise<void> {
  const response = await fetch(
    `/api/me/room-invites/${encodeURIComponent(invitationId)}/reject`,
    { method: "POST", credentials: "same-origin" },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      readonly error?: string;
    } | null;
    throw new Error(payload?.error ?? "無法拒絕房間邀請");
  }
  await loadFriends();
  toast("已拒絕房間邀請");
}

function renderFriends(
  data: FriendOverview,
  roomInvites: readonly RoomInvitePreview[],
): void {
  $("#friend-player-code").value = data.friendCode;
  if (data.friends.length === 0)
    showSocialEmpty(
      "#friends-list",
      "還沒有好友，輸入朋友的玩家代碼開始邀請。",
    );
  else {
    $("#friends-list").replaceChildren();
    for (const friend of data.friends) {
      const actions: { readonly label: string; readonly run: () => void }[] = [
        ...(mode === "online" && room?.mode === "friend"
          ? [
              {
                label: "邀請入房",
                run: () => {
                  void createRoomInvitation(friend.userId).catch(
                    (error: unknown) => {
                      toast(errorMessage(error));
                    },
                  );
                },
              },
            ]
          : []),
        {
          label: "移除",
          run: runFriendAction(
            `/${encodeURIComponent(friend.userId)}`,
            "DELETE",
            "已移除好友",
          ),
        },
        {
          label: "封鎖",
          run: runFriendAction(
            `/blocks/${encodeURIComponent(friend.userId)}`,
            "POST",
            "已封鎖玩家",
          ),
        },
      ];
      const presenceLabel =
        friend.online === null
          ? "上線狀態隱藏"
          : friend.online
            ? "線上"
            : "離線";
      addSocialRow(
        "#friends-list",
        friend.displayName,
        actions,
        presenceLabel,
        friend.online === true,
      );
    }
  }

  if (roomInvites.length === 0)
    showSocialEmpty("#room-invites-list", "目前沒有待處理的房間邀請。");
  else {
    $("#room-invites-list").replaceChildren();
    for (const invite of roomInvites)
      addSocialRow(
        "#room-invites-list",
        `${invite.inviterName} 邀請你加入${GAMES[invite.game].name}房間`,
        [
          {
            label: invite.status === "accepted" ? "重新加入" : "加入房間",
            run: () => {
              if (mode === "online" && room) {
                toast("請先離開目前房間，再接受新的房間邀請。");
                return;
              }
              void acceptRoomInvitation(invite.id).catch((error: unknown) => {
                toast(errorMessage(error));
              });
            },
          },
          {
            label: "拒絕",
            run: () => {
              void rejectRoomInvitation(invite.id).catch((error: unknown) => {
                toast(errorMessage(error));
              });
            },
          },
        ],
        `房間代碼 ${invite.roomCode}`,
      );
  }

  if (data.incomingRequests.length === 0)
    showSocialEmpty("#friend-requests-incoming", "目前沒有收到好友邀請。");
  else {
    $("#friend-requests-incoming").replaceChildren();
    for (const request of data.incomingRequests)
      addSocialRow("#friend-requests-incoming", request.displayName, [
        {
          label: "接受",
          run: runFriendAction(
            `/requests/${encodeURIComponent(request.id)}/accept`,
            "POST",
            "已接受好友邀請",
          ),
        },
        {
          label: "拒絕",
          run: runFriendAction(
            `/requests/${encodeURIComponent(request.id)}/reject`,
            "POST",
            "已拒絕好友邀請",
          ),
        },
        {
          label: "封鎖",
          run: runFriendAction(
            `/blocks/${encodeURIComponent(request.userId)}`,
            "POST",
            "已封鎖玩家",
          ),
        },
      ]);
  }

  if (data.outgoingRequests.length === 0)
    showSocialEmpty("#friend-requests-outgoing", "目前沒有送出的好友邀請。");
  else {
    $("#friend-requests-outgoing").replaceChildren();
    for (const request of data.outgoingRequests)
      addSocialRow("#friend-requests-outgoing", request.displayName, [
        {
          label: "取消",
          run: runFriendAction(
            `/requests/${encodeURIComponent(request.id)}`,
            "DELETE",
            "已取消好友邀請",
          ),
        },
        {
          label: "封鎖",
          run: runFriendAction(
            `/blocks/${encodeURIComponent(request.userId)}`,
            "POST",
            "已封鎖玩家",
          ),
        },
      ]);
  }

  if (data.blockedUsers.length === 0)
    showSocialEmpty("#blocked-friends-list", "目前沒有封鎖玩家。");
  else {
    $("#blocked-friends-list").replaceChildren();
    for (const blocked of data.blockedUsers)
      addSocialRow("#blocked-friends-list", blocked.displayName, [
        {
          label: "解除封鎖",
          run: runFriendAction(
            `/blocks/${encodeURIComponent(blocked.userId)}`,
            "DELETE",
            "已解除封鎖",
          ),
        },
      ]);
  }
}

function openFriends(): void {
  $("#friends-dialog").showModal();
  if (friendsRefreshTimer !== null) clearInterval(friendsRefreshTimer);
  void loadFriends().catch((error: unknown) => {
    toast(errorMessage(error));
  });
  friendsRefreshTimer = setInterval(() => {
    void loadFriends().catch(() => {});
  }, 15_000);
}

$("#friends-dialog").addEventListener("close", () => {
  if (friendsRefreshTimer !== null) clearInterval(friendsRefreshTimer);
  friendsRefreshTimer = null;
});

async function pollRoomInvitations(): Promise<void> {
  if (roomInvitePollInFlight) return;
  roomInvitePollInFlight = true;
  try {
    const response = await fetch("/api/me/room-invites", {
      credentials: "same-origin",
    });
    const payload = (await response.json().catch(() => null)) as
      | readonly RoomInvitePreview[]
      | null;
    if (!response.ok || !Array.isArray(payload)) return;
    const invites = payload as readonly RoomInvitePreview[];
    const incoming = new Set(invites.map((invite) => invite.id));
    for (const invite of invites) {
      if (knownRoomInviteIds.has(invite.id)) continue;
      knownRoomInviteIds.add(invite.id);
      toast(`${invite.inviterName} 邀請你加入${GAMES[invite.game].name}房間`);
    }
    const dot = $("#nav-friends").querySelector(".small-dot");
    if (dot) {
      dot.textContent = incoming.size > 0 ? String(incoming.size) : "";
      dot.classList.toggle("has-invites", incoming.size > 0);
    }
    if ($("#friends-dialog").hasAttribute("open"))
      void loadFriends().catch(() => {});
  } catch {
    // Presence refresh is best-effort; a later poll will retry.
  } finally {
    roomInvitePollInFlight = false;
  }
}

async function startRoomInvitePolling(): Promise<void> {
  try {
    await ensureProductSession("");
    await pollRoomInvitations();
    if (roomInvitePollTimer !== null) clearInterval(roomInvitePollTimer);
    roomInvitePollTimer = setInterval(() => {
      void pollRoomInvitations();
    }, 15_000);
  } catch {
    // 玩家開始使用社交功能時仍會再建立 session 並載入邀請。
  }
}

void startRoomInvitePolling();

$("#nav-friends").onclick = openFriends;
$("#copy-friend-code").onclick = () => {
  const code = $("#friend-player-code").value;
  if (!code) return;
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (!clipboard) {
    $("#friend-player-code").select();
    toast("已選取玩家代碼，請複製分享給朋友。");
    return;
  }
  void clipboard
    .writeText(code)
    .then(() => {
      toast("已複製玩家代碼");
    })
    .catch(() => {
      $("#friend-player-code").select();
      toast("已選取玩家代碼，請複製分享給朋友。");
    });
};

$("#friend-request-form").onsubmit = async (event) => {
  event.preventDefault();
  const friendCode = $("#friend-code-input").value.trim();
  try {
    const response = await fetch("/api/me/friends/requests", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendCode }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { readonly error?: string }
      | FriendOverview
      | null;
    if (!response.ok)
      throw new Error(
        payload && "error" in payload
          ? (payload.error ?? "無法送出好友邀請")
          : "無法送出好友邀請",
      );
    $("#friend-code-input").value = "";
    await loadFriends();
    toast("已送出好友邀請");
  } catch (error: unknown) {
    toast(errorMessage(error));
  }
};

function renderProfile(profile: ProfileData): void {
  const user = profile.user;
  $("#profile-player-code").value = user.publicCode;
  $("#profile-display-name").value = user.displayName;
  $("#profile-identity").textContent = user.hasAccount
    ? `已綁定帳號 @${user.loginName ?? ""} · 玩家身份 ${user.publicCode}`
    : `訪客身份 · 綁定帳號後可跨裝置找回資料 · ${user.publicCode}`;
  $("#account-state-copy").textContent = user.hasAccount
    ? `此身份已綁定 @${user.loginName ?? ""}，好友與對局資料會留在同一玩家身份。請妥善保管密碼，目前尚無忘記密碼重設功能。`
    : "綁定後可在其他裝置登入；這會保留目前好友、戰績與評分。登入既有帳號會切換到該帳號資料，不會合併目前訪客資料。請妥善保管密碼，目前尚無忘記密碼重設功能。";
  $("#account-upgrade-form").hidden = user.hasAccount;
  $("#show-login-form").hidden = user.hasAccount;
  $("#account-login-form").hidden = true;
  $("#show-upgrade-form").hidden = true;
  $("#account-logout").hidden = !user.hasAccount;
  (
    document.querySelector("#setting-friend-invites") as HTMLInputElement
  ).checked = profile.preferences.friendInvites;
  (
    document.querySelector("#setting-online-status") as HTMLInputElement
  ).checked = profile.preferences.showOnlineStatus;
  (document.querySelector("#setting-leaderboard") as HTMLInputElement).checked =
    profile.preferences.showInLeaderboard;

  const stats = $("#profile-stats");
  stats.replaceChildren();
  for (const [label, value] of [
    ["完成對局", profile.stats.completed],
    ["勝場", profile.stats.wins],
    ["敗場", profile.stats.losses],
    ["和局", profile.stats.draws],
  ] as const) {
    const card = document.createElement("div");
    card.className = "profile-stat";
    const number = document.createElement("strong");
    number.textContent = String(value);
    const caption = document.createElement("span");
    caption.textContent = label;
    card.append(number, caption);
    stats.append(card);
  }

  if (profile.stats.byGame.length === 0)
    showSocialEmpty(
      "#profile-ratings",
      "完成 rated 對局後會在這裡顯示分棋種戰績。",
    );
  else {
    $("#profile-ratings").replaceChildren();
    for (const gameStats of profile.stats.byGame)
      addSocialRow(
        "#profile-ratings",
        `${GAMES[gameStats.game].name} · ${String(gameStats.completed)} 局`,
        [],
        `勝 ${String(gameStats.wins)} · 敗 ${String(gameStats.losses)} · 和 ${String(gameStats.draws)}`,
      );
  }
  for (const rating of profile.ratings)
    addSocialRow(
      "#profile-ratings",
      `${GAMES[rating.game].name} ELO ${String(rating.rating)}`,
      [],
      `${String(rating.gamesPlayed)} 局 · ${rating.provisional ? "暫定評分" : "正式評分"}`,
    );

  const gameSelect =
    document.querySelector<HTMLSelectElement>("#leaderboard-game");
  if (!gameSelect) throw new Error("找不到排行榜棋種選單");
  if (gameSelect.options.length === 0) {
    for (const game of GAME_IDS) {
      const option = document.createElement("option");
      option.value = game;
      option.textContent = GAMES[game].name;
      gameSelect.append(option);
    }
    gameSelect.addEventListener("change", () => {
      void loadLeaderboard(gameSelect.value);
    });
  }
  if (!GAME_IDS.includes(gameSelect.value as GameId))
    gameSelect.value = "shogi";
  void loadLeaderboard(gameSelect.value);

  const profileCard = $("#nav-profile-card");
  const avatar = profileCard.querySelector(".avatar");
  const summary = profileCard.querySelector(".profile-name");
  const accountStatus = $("#profile-account-status");
  if (avatar) avatar.textContent = Array.from(user.displayName)[0] ?? "棋";
  if (summary) summary.textContent = user.displayName;
  accountStatus.textContent = user.hasAccount
    ? `已綁定 @${user.loginName ?? ""}`
    : "訪客棋手 · 尚未綁定";
}

async function loadProfile(): Promise<void> {
  await ensureProductSession("");
  const response = await fetch("/api/me/profile", {
    credentials: "same-origin",
  });
  const payload = (await response.json().catch(() => null)) as
    | ProfileData
    | { readonly error?: string }
    | null;
  if (!response.ok || !payload || !("user" in payload))
    throw new Error(
      payload && "error" in payload
        ? (payload.error ?? "無法載入個人資料")
        : "個人資料格式錯誤",
    );
  renderProfile(payload);
}

async function loadLeaderboard(game: string): Promise<void> {
  if (!GAME_IDS.includes(game as GameId)) return;
  const response = await fetch(
    `/api/leaderboard?game=${encodeURIComponent(game)}&limit=50`,
    { credentials: "same-origin" },
  );
  const payload = (await response.json().catch(() => null)) as
    | { readonly entries: readonly LeaderboardEntry[] }
    | { readonly error?: string }
    | null;
  const list = $("#leaderboard-list");
  if (!response.ok || !payload || !("entries" in payload)) {
    const message =
      payload && "error" in payload
        ? (payload.error ?? "無法載入排行榜")
        : "排行榜資料格式錯誤";
    showSocialEmpty("#leaderboard-list", message);
    return;
  }
  if (payload.entries.length === 0) {
    showSocialEmpty(
      "#leaderboard-list",
      "目前沒有公開評分；玩家可在隱私設定中同意顯示排行榜資料。",
    );
    return;
  }
  list.replaceChildren();
  for (const entry of payload.entries) {
    const row = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `${entry.displayName} · ${entry.publicCode}`;
    const rating = document.createElement("span");
    rating.className = "leaderboard-rating";
    rating.textContent = `${String(entry.rating)}${entry.provisional ? " · 暫定" : ""}`;
    row.value = entry.rank;
    row.append(name, rating);
    list.append(row);
  }
}

function openProfile(): void {
  $("#profile-dialog").showModal();
  void loadProfile().catch((error: unknown) => {
    toast(errorMessage(error));
  });
}

$("#nav-profile").onclick = openProfile;
$("#profile-form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const response = await fetch("/api/me", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: $("#profile-display-name").value }),
    });
    const payload = (await response.json().catch(() => null)) as {
      readonly error?: string;
    } | null;
    if (!response.ok) throw new Error(payload?.error ?? "無法儲存顯示名稱");
    await loadProfile();
    toast("已更新顯示名稱");
  } catch (error: unknown) {
    toast(errorMessage(error));
  }
};

$("#account-upgrade-form").onsubmit = async (event) => {
  event.preventDefault();
  const password = $("#account-upgrade-password").value;
  try {
    const response = await fetch("/api/account/upgrade", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loginName: $("#account-upgrade-name").value,
        password,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      readonly error?: string;
    } | null;
    if (!response.ok) throw new Error(payload?.error ?? "無法綁定帳號");
    $("#account-upgrade-password").value = "";
    await loadProfile();
    toast("已綁定帳號；原有好友與戰績已保留");
  } catch (error: unknown) {
    toast(errorMessage(error));
  }
};

$("#show-login-form").onclick = () => {
  $("#account-upgrade-form").hidden = true;
  $("#show-login-form").hidden = true;
  $("#account-login-form").hidden = false;
  $("#show-upgrade-form").hidden = false;
};
$("#show-upgrade-form").onclick = () => {
  $("#account-login-form").hidden = true;
  $("#show-upgrade-form").hidden = true;
  $("#account-upgrade-form").hidden = false;
  $("#show-login-form").hidden = false;
};

$("#account-login-form").onsubmit = async (event) => {
  event.preventDefault();
  if (mode === "online" && room) {
    toast("請先離開目前房間，再切換登入帳號。");
    return;
  }
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loginName: $("#account-login-name").value,
        password: $("#account-login-password").value,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      readonly error?: string;
    } | null;
    if (!response.ok) throw new Error(payload?.error ?? "登入失敗");
    $("#account-login-password").value = "";
    await loadProfile();
    refreshSocketIdentity();
    toast("已登入；已恢復此帳號的好友與戰績");
  } catch (error: unknown) {
    toast(errorMessage(error));
  }
};

$("#account-logout").onclick = async () => {
  if (mode === "online" && room) {
    toast("請先離開目前房間，再登出此裝置。");
    return;
  }
  try {
    const response = await fetch("/api/session", {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("無法登出");
    await ensureProductSession("");
    refreshSocketIdentity();
    await loadProfile();
    toast("已登出此裝置");
  } catch (error: unknown) {
    toast(errorMessage(error));
  }
};

$("#privacy-settings-form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const response = await fetch("/api/me", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        friendInvites: (
          document.querySelector("#setting-friend-invites") as HTMLInputElement
        ).checked,
        showOnlineStatus: (
          document.querySelector("#setting-online-status") as HTMLInputElement
        ).checked,
        showInLeaderboard: (
          document.querySelector("#setting-leaderboard") as HTMLInputElement
        ).checked,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      readonly error?: string;
    } | null;
    if (!response.ok) throw new Error(payload?.error ?? "無法儲存隱私設定");
    await loadProfile();
    await loadFriends();
    toast("已儲存隱私設定");
  } catch (error: unknown) {
    toast(errorMessage(error));
  }
};

$("#copy-profile-code").onclick = () => {
  const code = $("#profile-player-code").value;
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (!code) return;
  if (!clipboard) {
    $("#profile-player-code").select();
    return;
  }
  void clipboard.writeText(code).then(
    () => {
      toast("已複製玩家代碼");
    },
    () => {
      $("#profile-player-code").select();
      toast("已選取玩家代碼，請手動複製。");
    },
  );
};

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
function cancelQueuedMatchmaking(): void {
  const ticket = matchmakingTicket;
  matchmakingTicket = null;
  if (ticket && socket?.readyState === 1)
    socket.send(JSON.stringify({ type: "matchmake-cancel", ticket }));
}
function leaveRoom() {
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  cancelQueuedMatchmaking();
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
  if (mode === "online" || matchmakingTicket !== null) leaveRoom();
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
  if (
    setupMode === "online" ||
    setupMode === "rated" ||
    setupMode === "matchmaking"
  ) {
    try {
      await ensureProductSession($("#player-name").value);
      await connect();
      const ws = socket;
      if (!ws) throw new Error("連線尚未建立");
      if (setupMode === "matchmaking" && matchmakingTicket) {
        ws.send(
          JSON.stringify({
            type: "matchmake-cancel",
            ticket: matchmakingTicket,
          }),
        );
        return;
      }
      if (setupMode === "matchmaking") {
        const matchmakingMode = $("#matchmaking-mode").value;
        if (matchmakingMode !== "rated" && matchmakingMode !== "casual") {
          toast("無效的公開配對類型");
          return;
        }
        ws.send(
          JSON.stringify({
            type: "matchmake",
            game: setupGame,
            mode: matchmakingMode,
            timeControl: "unlimited",
          }),
        );
        $("#start-button").disabled = true;
        return;
      }
      ws.send(
        JSON.stringify({
          type: "create",
          game: setupGame,
          ...(setupMode === "rated" ? { mode: "rated" as const } : {}),
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
    body: JSON.stringify(
      displayName.trim() ? { displayName: displayName.trim() } : {},
    ),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? "無法建立玩家 session");
  }
}

function sendCurrentRoomJoin(ws: WebSocket, currentRoom: ClientRoom): void {
  const invitation = pendingRoomInvite;
  if (invitation && invitation.roomCode === currentRoom.code) {
    pendingRoomInviteJoin = true;
    ws.send(
      JSON.stringify({
        type: "join",
        code: invitation.roomCode,
        invitationId: invitation.id,
        invitationToken: invitation.entryToken,
      }),
    );
    return;
  }
  ws.send(
    JSON.stringify({
      type: "join",
      code: currentRoom.code,
      token: currentRoom.token,
    }),
  );
}

async function reconnectCurrentRoom(): Promise<void> {
  const currentRoom = room;
  if (!currentRoom) return;
  try {
    await connect();
    const ws = socket;
    if (ws) sendCurrentRoomJoin(ws, currentRoom);
  } catch {
    toast("重新連線失敗，請稍後再試。");
  }
}

function refreshSocketIdentity(): void {
  identityReconnectRequested = true;
  if (
    socket?.readyState === WebSocket.OPEN ||
    socket?.readyState === WebSocket.CONNECTING
  ) {
    socket.close(4002, "Identity changed");
    return;
  }
  if (room) void reconnectCurrentRoom();
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
        pendingRoomInviteJoin = false;
        pendingRoomInvite = null;
        cancelAI();
        riichiWorker?.terminate();
        riichiWorker = null;
        riichiHandoff = null;
        room = {
          ...room,
          code: msg.code,
          mode: msg.mode,
          token: msg.token,
          side: msg.side,
          chat: room?.chat ?? [],
        };
        session.set({ code: msg.code, token: msg.token });
        human = msg.side;
        mode = "online";
        snapshots = [];
        selected = null;
        $("#start-button").disabled = false;
      }
      if (msg.type === "matchmaking") {
        if (msg.status === "waiting") {
          matchmakingTicket = msg.ticket;
          $("#start-button").disabled = false;
          $("#start-button").innerHTML = "取消配對 <span>×</span>";
          $("#setup-note").textContent =
            "正在等待合適的對手；你可以按下按鈕取消配對。";
        } else {
          if (matchmakingTicket === msg.ticket) matchmakingTicket = null;
          $("#start-button").disabled = false;
          if (msg.status === "cancelled") {
            setSetupMode("matchmaking");
            toast("已取消公開配對");
          } else if (msg.status === "expired") {
            setSetupMode("matchmaking");
            toast("配對等待已逾時，請重新嘗試");
          } else {
            toast("已找到對手，準備開始對局");
          }
        }
      }
      if (msg.type === "state") {
        if (!room || room.code !== msg.code) return;
        const fresh = $("#play-screen").hidden;
        room = {
          ...room,
          players: msg.players ?? [],
          mode: msg.mode,
          rematch: msg.rematch,
          chat: msg.chat,
        };
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
      if (msg.type === "chat") {
        if (!room) return;
        if (room.chat.some((entry) => entry.id === msg.message.id)) return;
        room = {
          ...room,
          chat: [...room.chat, msg.message].slice(-CHAT_HISTORY_LIMIT),
        };
        renderChat();
      }
      if (msg.type === "error") {
        networkBusy = false;
        $("#start-button").disabled = false;
        toast(msg.message);
        if (pendingRoomInviteJoin) {
          pendingRoomInviteJoin = false;
          pendingRoomInvite = null;
          room = null;
          mode = "ai";
          lobby();
        } else if (msg.message.includes("找不到房間") && room) {
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
      if (event.code === 4002) {
        if (identityReconnectRequested) {
          identityReconnectRequested = false;
          reject(Error("登入狀態已更新"));
          if (room && mode === "online") void reconnectCurrentRoom();
        } else {
          reject(Error("登入狀態已逾期"));
          toast("登入狀態已過期，請登入後重新連線；目前房間資料已保留。");
        }
        return;
      }
      if (matchmakingTicket) {
        matchmakingTicket = null;
        $("#start-button").disabled = false;
        toast("公開配對連線中斷，請重新嘗試");
      }
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
                  sendCurrentRoomJoin(currentSocket, currentRoom);
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
    | "chat"
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
  if (type !== "chat") networkBusy = true;
}
function renderChat(): void {
  const panel = $("#chat-panel");
  const messages = $("#chat-messages");
  const input = $("#chat-input");
  const visible = mode === "online" && room !== null;
  panel.hidden = !visible;
  if (!visible || !room) {
    messages.replaceChildren();
    input.value = "";
    return;
  }
  const currentRoom = room;
  messages.replaceChildren(
    ...currentRoom.chat.map((message) => {
      const item = document.createElement("article");
      item.className = `chat-message${
        message.side === currentRoom.side ? " mine" : ""
      }`;
      const meta = document.createElement("div");
      meta.className = "chat-meta";
      const time = new Date(message.createdAt).toLocaleTimeString("zh-TW", {
        hour: "2-digit",
        minute: "2-digit",
      });
      meta.textContent = `${message.name} · ${time}`;
      const body = document.createElement("p");
      body.textContent = message.text;
      item.append(meta, body);
      return item;
    }),
  );
  messages.scrollTop = messages.scrollHeight;
  input.disabled = !connected;
}
$("#chat-form").onsubmit = (event) => {
  event.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text || mode !== "online") return;
  send("chat", { text });
  input.value = "";
  renderChat();
};
$("#chat-input").maxLength = CHAT_MAX_LENGTH;
$$("#chat-emoji button").forEach(
  (button) =>
    (button.onclick = () => {
      const input = $("#chat-input");
      if (input.disabled) return;
      input.value = `${input.value}${button.textContent}`.slice(
        0,
        CHAT_MAX_LENGTH,
      );
      input.focus();
    }),
);
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
  renderChat();
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
        : room?.mode === "rated"
          ? "♜ 競技對局"
          : room?.mode === "public"
            ? "⚔ 公開配對"
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
  room = { ...savedRoom, mode: "friend", side: 1, chat: [] };
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
