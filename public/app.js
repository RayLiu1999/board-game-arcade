import { SHOGI_NAMES } from "./shogi.js";
import { renderRiichi } from "./riichi-ui.js";
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
} from "./engine.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const pieces = {
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
let state = null,
  mode = "ai",
  human = 1,
  difficulty = "medium",
  selected = null,
  snapshots = [],
  worker = null,
  taskId = 0,
  thinking = false;
let setupGame = "gomoku",
  setupMode = "ai",
  socket = null,
  room = null,
  connected = false,
  reconnectTimer = null,
  connectionPromise = null;
let riichiWorker = null,
  riichiHandoff = null;
let toastTimer,
  confirmCallback = null,
  networkBusy = false;
const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
  remove(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};
const session = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem("qiju-room"));
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      if (v) sessionStorage.setItem("qiju-room", JSON.stringify(v));
      else sessionStorage.removeItem("qiju-room");
    } catch {}
  },
};
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 4200);
}
function confirmAction(title, text, fn) {
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
  (b) => (b.onclick = () => b.closest("dialog").close()),
);
$$("dialog").forEach((d) =>
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
  }),
);
function cardArt(game, index) {
  if (game === "shogi")
    return `<div class="card-art shogi" aria-hidden="true"><span class="card-index">NEW / SHOGI</span><div class="shogi-art"><i>飛</i><i>王</i><i>角</i></div></div>`;
  if (game === "riichi")
    return `<div class="card-art riichi" aria-hidden="true"><span class="card-index">NEW / RIICHI</span><div class="riichi-art"><i>一<small>萬</small></i><i>發</i><i>中</i></div></div>`;
  const line = ["xiangqi", "gomoku", "go"].includes(game),
    n = line ? 5 : 6;
  let html = `<div class="card-art ${game}" aria-hidden="true"><span class="card-index">0${index + 1} / QIJU</span><div class="mini-board ${line ? "lines" : ""}">`;
  const arrangement = {
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
  }[game];
  for (let i = 0; i < n * n; i++) {
    const v = arrangement[i];
    html += `<span class="mini-cell ${(Math.floor(i / n) + (i % n)) % 2 ? "dark" : ""} ${i > 20 ? "light-piece" : ""}">${!v ? "" : game === "chess" ? v : game === "xiangqi" ? `<i class="tiny-disc red">${v}</i>` : `<i class="tiny-disc ${v === "w" ? "white" : ""}"></i>`}</span>`;
  }
  return html + "</div></div>";
}
function renderCards(filter = "all") {
  const keys = Object.keys(GAMES);
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
    (b) => (b.onclick = () => openSetup(b.dataset.game)),
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
function openSetup(game, chosenMode = "ai") {
  setupGame = game;
  setupMode = chosenMode;
  $("#setup-title").textContent = `來一局${GAMES[game].name}`;
  $("#setup-desc").textContent = GAMES[game].desc;
  $("#go-options").hidden = game !== "go";
  $("#riichi-options").hidden = game !== "riichi";
  $("#side-choice").options[0].textContent =
    GAMES[game].first + (game === "shogi" ? "" : " · 先手");
  $("#side-choice").options[1].textContent =
    GAMES[game].second + (game === "shogi" ? "" : " · 後手");
  setSetupMode(chosenMode);
  $("#setup-dialog").showModal();
}
function setSetupMode(m) {
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
  (b) => (b.onclick = () => setSetupMode(b.dataset.mode)),
);
$("#quick-play").onclick = () => openSetup("gomoku");
$("#invite-button").onclick = () => openSetup("chess", "online");
function openJoin() {
  if (mode === "online" && room) {
    toast("你已在房間中，請先返回大廳離開房間。");
    return;
  }
  $("#join-dialog").showModal();
}
$("#header-join").onclick = openJoin;
$("#nav-friends").onclick = openJoin;
function rules(game) {
  $("#rules-content").innerHTML = (game ? [game] : Object.keys(GAMES))
    .map(
      (k) =>
        `<h3>${GAMES[k].icon} ${GAMES[k].name}</h3><p>${GAMES[k].rules}</p>`,
    )
    .join("");
  $("#rules-dialog").showModal();
}
$("#nav-rules").onclick = () => rules();
$("#game-help").onclick = () => rules(state?.game);
function cancelAI() {
  taskId++;
  worker?.terminate();
  worker = null;
  thinking = false;
}
function leaveRoom() {
  clearTimeout(reconnectTimer);
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
  if (state?.winner === null && (mode === "online" || state?.game === "riichi"))
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
function showGame() {
  $("#setup-dialog").close();
  $("#join-dialog").close();
  $("#lobby").hidden = true;
  $("#play-screen").hidden = false;
  $("#crumb").textContent = GAMES[state.game].name;
  render();
  window.scrollTo(0, 0);
}
function startLocalRiichi(rounds = Number($("#riichi-rounds").value)) {
  cancelAI();
  riichiWorker?.terminate();
  networkBusy = false;
  human = 1;
  riichiHandoff = null;
  state = {
    game: "riichi",
    phase: "waiting",
    winner: null,
    rounds,
    history: [],
  };
  riichiWorker = new Worker("/riichi-worker.js", { type: "module" });
  riichiWorker.onmessage = ({ data }) => {
    networkBusy = false;
    if (data.type === "error") {
      toast(data.message);
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
  difficulty = $("#difficulty").value;
  human = Number($("#side-choice").value);
  cancelAI();
  snapshots = [];
  selected = null;
  if (setupMode === "online") {
    try {
      await connect();
      socket.send(
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
      toast(err.message);
    }
    return;
  }
  mode = setupMode;
  if (setupGame === "riichi") {
    startLocalRiichi();
    return;
  }
  state = createGame(setupGame, Number($("#board-size").value));
  save();
  showGame();
  scheduleAI();
};
$("#join-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await connect();
    const code = $("#join-code").value.trim().toUpperCase();
    const saved = session.get();
    socket.send(
      JSON.stringify({
        type: "join",
        code,
        name: $("#join-name").value,
        token: saved?.code === code ? saved.token : undefined,
      }),
    );
  } catch (err) {
    toast(err.message);
  }
};
function connect() {
  if (socket?.readyState === 1) return Promise.resolve();
  if (connectionPromise) return connectionPromise;
  connectionPromise = new Promise((resolve, reject) => {
    socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`,
    );
    const ws = socket;
    const timer = setTimeout(() => {
      ws.close();
      reject(Error("連線逾時，請確認伺服器已啟動"));
    }, 7000);
    ws.onopen = () => {
      clearTimeout(timer);
      connected = true;
      resolve();
    };
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
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
        room = { ...room, players: msg.players, rematch: msg.rematch };
        state = msg.state;
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
          reconnectTimer = setTimeout(async () => {
            try {
              await connect();
              if (room)
                socket.send(
                  JSON.stringify({
                    type: "join",
                    code: room.code,
                    token: room.token,
                  }),
                );
            } catch {}
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
function send(type, extra = {}) {
  if (socket?.readyState !== 1) {
    toast("連線中斷，正在嘗試重新連線");
    return;
  }
  socket.send(JSON.stringify({ type, ...extra }));
  networkBusy = true;
}
function canPlay() {
  return (
    state &&
    state.winner === null &&
    state.phase === "play" &&
    !thinking &&
    !networkBusy &&
    (mode === "local" || state.turn === human) &&
    (mode !== "online" || (connected && room?.players?.every((p) => p?.online)))
  );
}
function render() {
  if (!state) return;
  const mahjong = state.game === "riichi";
  $(".play-layout").hidden = mahjong;
  $("#riichi-table").hidden = !mahjong;
  $("#play-screen").classList.toggle("riichi-screen", mahjong);
  if (mahjong) {
    $("#mode-badge").textContent =
      mode === "ai"
        ? "✦ 日麻 AI 對戰"
        : mode === "local"
          ? "♟ 同機四人"
          : "♧ 四人好友房";
    renderRiichi($("#riichi-table"), state, {
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
          riichiWorker.postMessage({ type: "action", id });
        }
        render();
      },
      onReady: () => riichiWorker?.postMessage({ type: "ready" }),
      onStart: () => {
        send("riichi-start");
        render();
      },
      onCopy: () => $("#copy-room").click(),
      onRules: () => rules("riichi"),
      onRestart: () => {
        if (mode === "online") send("rematch");
        else
          confirmAction("再開一場日麻？", "目前的對局將結束。", () =>
            startLocalRiichi(state.rounds),
          );
      },
    });
    return;
  }
  const s = state;
  $(".board-panel").style.setProperty("--board-ratio", s.cols / s.rows);
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
    mode === "online" && (waiting || networkBusy || s.accepted.includes(human));
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
  $("#restart-button").disabled =
    mode === "online" && (!done || waiting || room?.rematch?.includes(human));
  $("#resign-button").hidden = done;
  $("#resign-button").disabled = mode === "online" && (waiting || networkBusy);
  $("#score-info").textContent =
    s.game === "go"
      ? scoring || done
        ? `面積計分：黑 ${areaScore(s)[1]} · 白 ${areaScore(s)[-1]}（含 6.5 貼目）${scoring && s.accepted.length ? " · 一方已確認" : ""}`
        : `提子：黑 ${s.captures[1]} · 白 ${s.captures[-1]}　白貼 6.5 目`
      : s.game === "reversi"
        ? `黑 ${s.board.filter((p) => p === 1).length} 子 · 白 ${s.board.filter((p) => p === -1).length} 子`
        : "";
  renderPlayer("#opponent-row", mode === "local" ? -1 : -human);
  renderPlayer("#self-row", mode === "local" ? 1 : human);
  renderBoard();
  $("#board-tip").textContent = scoring
    ? "點選整群棋子標記／取消死棋，半透明棋子將移除計分。"
    : done
      ? "這一盤已結束，準備好再來一局了嗎？"
      : ["chess", "xiangqi", "checkers", "shogi"].includes(s.game)
        ? "點選己方棋子，再點選標示的合法位置。"
        : "點選交叉點或空格落子；最後一手會以金色標記。";
  $("#move-count").textContent = `${s.ply} 手`;
  $("#history").innerHTML = s.history.length
    ? s.history
        .map(
          (h, i) =>
            `<div class="history-entry"><span>${i + 1}</span><span>${playerName(s, h.side)}</span><strong>${h.label}</strong></div>`,
        )
        .join("")
    : '<div class="history-empty">棋盤已就緒<br>你的第一步，會從哪裡開始？</div>';
  $("#history").scrollTop = $("#history").scrollHeight;
}
function renderPlayer(selector, side) {
  const s = state;
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
function renderBoard() {
  const s = state,
    board = $("#board"),
    lines = ["go", "gomoku", "xiangqi"].includes(s.game);
  board.style.setProperty("--cols", s.cols);
  board.style.setProperty("--rows", s.rows);
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
    let piece = "";
    if (p) {
      if (s.game === "chess")
        piece = `<span class="piece chess-piece ${owner(p) === 1 ? "white" : ""}">${pieces[p]}</span>`;
      else if (s.game === "shogi")
        piece = `<span class="piece shogi-piece ${p < 0 ? "opposing" : ""} ${Math.abs(p) > 8 ? "promoted" : ""}">${SHOGI_NAMES[Math.abs(p)]}</span>`;
      else if (s.game === "xiangqi")
        piece = `<span class="piece xiangqi-piece ${p > 0 ? "red" : ""}">${(p > 0 ? ["", "兵", "炮", "車", "馬", "相", "仕", "帥"] : ["", "卒", "砲", "車", "馬", "象", "士", "將"])[Math.abs(p)]}</span>`;
      else
        piece = `<span class="piece stone ${p < 0 ? "white" : ""} ${s.game === "checkers" ? "checker" : ""} ${s.dead.includes(i) ? "dead" : ""}">${s.game === "checkers" && Math.abs(p) === 2 ? "♔" : ""}</span>`;
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
        ? SHOGI_NAMES[Math.abs(p)] || ""
        : s.game === "chess"
          ? { k: "王", q: "后", r: "車", b: "象", n: "馬", p: "兵" }[p?.[1]] ||
            ""
          : s.game === "xiangqi"
            ? (p > 0
                ? ["", "兵", "炮", "車", "馬", "相", "仕", "帥"]
                : ["", "卒", "砲", "車", "馬", "象", "士", "將"])[
                Math.abs(p)
              ] || ""
            : s.game === "checkers" && Math.abs(p) === 2
              ? "王"
              : "棋子";
    html += `<button class="${classes}" data-cell="${i}" aria-label="${coordinate(s, i)}${p ? " " + playerName(s, owner(p)) + pieceName : " 空位"}" ${selected === i ? 'aria-pressed="true"' : ""}>${star ? '<span class="star-point"></span>' : ""}${piece}</button>`;
  }
  if (s.game === "xiangqi")
    html +=
      '<div class="palace-lines" style="top:5%"></div><div class="palace-lines" style="top:75%"></div><div class="river-label"><span>楚河</span><span>漢界</span></div>';
  board.innerHTML = html;
  for (const [selector, side] of [
    ["#opponent-hand", mode === "local" ? -1 : -human],
    ["#self-hand", mode === "local" ? 1 : human],
  ]) {
    const el = $(selector);
    el.hidden = s.game !== "shogi";
    if (s.game !== "shogi") continue;
    el.innerHTML =
      `<span>${playerName(s, side)}持駒</span>` +
      s.hands[side]
        .map((n, t) =>
          n
            ? `<button data-drop="${t}" ${!canPlay() || side !== s.turn ? "disabled" : ""} class="${selected === `drop:${t}` ? "selected" : ""}">${SHOGI_NAMES[t]} <small>×${n}</small></button>`
            : "",
        )
        .join("");
    if (!s.hands[side].some(Boolean)) el.innerHTML += "<small>尚無持駒</small>";
    el.querySelectorAll("[data-drop]").forEach(
      (b) =>
        (b.onclick = () => {
          selected =
            selected === `drop:${b.dataset.drop}`
              ? null
              : `drop:${b.dataset.drop}`;
          renderBoard();
        }),
    );
  }
}
$("#board").onclick = async (e) => {
  const b = e.target.closest("[data-cell]");
  if (!b || !state) return;
  const i = Number(b.dataset.cell);
  if (state.phase === "scoring") {
    if (
      mode === "online" &&
      (!connected || !room?.players?.every((p) => p?.online))
    )
      return;
    if (state.board[i]) scoreAction("dead", { to: i });
    return;
  }
  if (!canPlay()) return;
  if (["chess", "xiangqi", "checkers", "shogi"].includes(state.game)) {
    const moves = legalMoves(state);
    if (selected !== null) {
      const options = moves.filter(
        (m) =>
          (typeof selected === "string"
            ? m.drop === Number(selected.split(":")[1])
            : m.from === selected) && m.to === i,
      );
      if (options.length) {
        let move = options[0];
        if (options.length > 1) {
          const promotion = await choosePromotion(state.game === "shogi");
          if (!promotion) return;
          move = options.find((m) =>
            state.game === "shogi"
              ? !!m.promote === (promotion === "yes")
              : m.promotion === promotion,
          );
        }
        commit(move);
        return;
      }
    }
    if (owner(state.board[i]) === state.turn) {
      if (state.forced !== null && i !== state.forced) {
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
function choosePromotion(shogi = false) {
  return new Promise((resolve) => {
    const d = $("#promotion-dialog");
    $("#promotion-dialog h2").textContent = shogi
      ? "是否升變？"
      : "選擇升變棋子";
    $("#promotion-dialog p").textContent = shogi
      ? "移動已進出敵陣，可以選擇成或不成。"
      : "兵已抵達底線，選擇你的新棋子。";
    $("#promotion-options").innerHTML = (
      shogi ? ["yes", "no"] : ["q", "r", "b", "n"]
    )
      .map((p) =>
        shogi
          ? `<button data-promotion="${p}">${p === "yes" ? "成" : "不成"}</button>`
          : `<button data-promotion="${p}" aria-label="升變為${{ q: "后", r: "車", b: "象", n: "馬" }[p]}">${pieces["w" + p]}</button>`,
      )
      .join("");
    $$("[data-promotion]").forEach(
      (b) =>
        (b.onclick = () => {
          d.close();
          resolve(b.dataset.promotion);
        }),
    );
    d.oncancel = () => resolve(null);
    d.showModal();
  });
}
function commit(m) {
  if (mode === "online") {
    send("move", { move: m, ply: state.ply });
    return;
  }
  try {
    const next = applyMove(state, m);
    snapshots.push(state);
    state = next;
    selected = state.forced;
    save();
    render();
    scheduleAI();
  } catch (err) {
    toast(err.message);
  }
}
function scheduleAI() {
  if (state?.game === "riichi") return;
  if (
    mode !== "ai" ||
    !state ||
    state.winner !== null ||
    state.phase !== "play" ||
    state.turn === human
  )
    return;
  cancelAI();
  thinking = true;
  render();
  const id = taskId;
  worker = new Worker("/ai-worker.js", { type: "module" });
  worker.onmessage = ({ data }) => {
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
  worker.postMessage({ id, state, difficulty });
}
$("#pass-button").onclick = () => {
  if (canPlay()) commit({ pass: true });
};
function scoreAction(type, extra = {}) {
  if (mode === "online") {
    send(type, extra);
    return;
  }
  try {
    state = scoringAction(
      state,
      { type, ...extra },
      mode === "local" ? (state.accepted.includes(1) ? -1 : 1) : human,
    );
    if (type === "accept" && mode === "ai" && state.phase === "scoring")
      state = scoringAction(state, { type: "accept" }, -human);
    save();
    render();
    scheduleAI();
  } catch (err) {
    toast(err.message);
  }
}
$("#accept-score").onclick = () => scoreAction("accept");
$("#resume-button").onclick = () => scoreAction("resume");
$("#undo-button").onclick = () => {
  if (!snapshots.length) return;
  cancelAI();
  state = snapshots.pop();
  if (mode === "ai")
    while (state.turn !== human && snapshots.length) state = snapshots.pop();
  selected = state.forced;
  save();
  render();
  scheduleAI();
};
$("#restart-button").onclick = () => {
  if (mode === "online") {
    send("rematch");
    return;
  }
  confirmAction(
    "重新開始這一局？",
    "目前的對局紀錄會清除，重新回到起始局面。",
    () => {
      cancelAI();
      state = createGame(state.game, state.rows);
      snapshots = [];
      selected = null;
      save();
      render();
      scheduleAI();
    },
  );
};
$("#resign-button").onclick = () =>
  confirmAction(
    "確定要認輸？",
    "認輸後將結束這一局，你隨時可以再來挑戰。",
    () => {
      if (mode === "online") {
        send("resign");
        return;
      }
      cancelAI();
      state = {
        ...state,
        winner: -(mode === "ai" ? human : state.turn),
        reason: "對手認輸",
      };
      save();
      render();
    },
  );
$("#copy-room").onclick = async () => {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", room.code);
  try {
    await navigator.clipboard.writeText(url.href);
    toast(
      location.hostname === "localhost" || location.hostname === "127.0.0.1"
        ? "連結已複製；其他裝置請將 localhost 換成此電腦的區網 IP。"
        : "邀請連結已複製",
    );
  } catch {
    toast(`房間代碼：${room.code}，請手動分享網址與代碼。`);
  }
};
function refreshResume() {
  let button = $("#resume-save");
  const saved = store.get("qiju-save");
  if (!saved || saved.state?.winner !== null) {
    button?.remove();
    return;
  }
  if (!button) {
    button = document.createElement("button");
    button.id = "resume-save";
    button.className = "button outline";
    button.style.cssText =
      "margin:16px 0 0;width:100%;justify-content:space-between";
    $(".hero").after(button);
  }
  button.textContent = `繼續上次的${GAMES[saved.state.game]?.name || "棋局"} · 第 ${saved.state.ply + 1} 手 →`;
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
  room = savedRoom;
  mode = "online";
  connect()
    .then(() => socket.send(JSON.stringify({ type: "join", ...savedRoom })))
    .catch((err) => toast(err.message));
}
