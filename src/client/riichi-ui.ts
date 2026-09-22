import type { ChatMessage } from "../shared/protocol.js";

const winds = ["東", "南", "西", "北"] as const;

interface RiichiChoice {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly tile?: string;
  readonly meld?: string;
}

interface RiichiSeat {
  readonly id: number;
  readonly wind: number;
  readonly name: string;
  readonly score: number;
  readonly handCount: number;
  readonly river: string[];
  readonly melds: string[];
  readonly riichi?: boolean;
  readonly bot?: boolean;
}

interface HuleResult {
  readonly type: "hule";
  readonly l: number;
  readonly baojia?: number | null;
  readonly fu?: string | number;
  readonly fanshu?: string | number;
  readonly defen: number;
  readonly hupai?: Array<{
    readonly name: string;
    readonly fanshu: string | number;
  }>;
  readonly shoupai: string;
  readonly fubaopai?: string[];
  readonly fenpei?: number[];
}

interface PingjuResult {
  readonly type: "pingju";
  readonly name: string;
  readonly fenpei: number[];
}

interface FinalResult {
  readonly type: "jieju";
  readonly rank: number[];
  readonly scores: number[];
}

type RiichiResult = HuleResult | PingjuResult | FinalResult;

export interface RiichiView {
  readonly game?: "riichi";
  readonly phase: "waiting" | "play" | "finished";
  readonly winner: number | null;
  readonly paused: boolean;
  readonly seat?: number;
  readonly wind: number;
  readonly round: number;
  readonly handNumber: number;
  readonly honba: number;
  readonly riichiSticks: number;
  readonly remaining?: number;
  readonly dora?: string[];
  readonly turn?: number | null;
  readonly hand?: string[];
  readonly drawn?: string | null;
  readonly seats?: RiichiSeat[];
  readonly choices?: RiichiChoice[];
  readonly result: RiichiResult | null;
  readonly history?: Array<{ readonly label: string }>;
}

interface RoomPlayer {
  readonly name?: string;
  readonly online?: boolean;
  readonly bot?: boolean;
}

export interface RoomView {
  readonly code?: string;
  readonly players?: Array<RoomPlayer | null>;
  readonly rematch?: number[];
  readonly chat?: readonly ChatMessage[];
}

export interface RenderOptions {
  readonly mode: string;
  readonly room: RoomView | null;
  readonly human: number;
  readonly connected: boolean;
  readonly busy: boolean;
  readonly handoff: number | null;
  readonly onAction: (id: string) => void;
  readonly onReady: () => void;
  readonly onStart: () => void;
  readonly onCopy: () => void;
  readonly onRestart: () => void;
  readonly onRules: () => void;
}

const textValue = (value: unknown): string =>
  value === null || value === undefined
    ? ""
    : typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ? String(value)
      : "";

const esc = (value: unknown): string =>
  textValue(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character,
  );

export function tileLabel(piece: string | undefined): string {
  if (!piece) return "";
  const number = piece[1] ?? "";
  return piece[0] === "z"
    ? (["", "東", "南", "西", "北", "白", "發", "中"][Number(number)] ?? "")
    : `${number === "0" ? "赤5" : number}${({ m: "萬", p: "筒", s: "索" } as Record<string, string>)[piece[0] ?? ""] ?? ""}`;
}

const tile = (piece: string | undefined, extra = ""): string => {
  const suit = piece?.[0] ?? "";
  const number = piece?.[1] ?? "";
  return `<span class="mj-tile ${suit} ${number === "0" ? "red-five" : ""} ${extra}" title="${esc(tileLabel(piece))}"><b>${suit === "z" ? tileLabel(piece) : number === "0" ? "5" : number}</b>${suit !== "z" ? `<small>${({ m: "萬", p: "筒", s: "索" } as Record<string, string>)[suit] ?? ""}</small>` : ""}</span>`;
};

const concealed = (value: string): string =>
  [...value.matchAll(/([mpsz])(\d+)/g)]
    .flatMap((match) =>
      Array.from(match[2] ?? "", (number) =>
        tile(`${match[1] ?? ""}${number}`, "mini"),
      ),
    )
    .join("");

const meld = (value: string): string =>
  `<span class="mj-meld">${(value.match(/\d/g) ?? []).map((number) => tile(`${value[0] ?? ""}${number}`, "mini")).join("")}</span>`;

export function renderRiichi(
  root: HTMLElement,
  state: RiichiView,
  {
    mode,
    room,
    human,
    connected,
    busy,
    handoff,
    onAction,
    onReady,
    onStart,
    onCopy,
    onRestart,
    onRules,
  }: RenderOptions,
): void {
  const waiting = state.phase === "waiting";
  const done = state.phase === "finished";
  const online = mode === "online";
  const available =
    !busy &&
    !state.paused &&
    (!online ||
      (connected && Boolean(room?.players?.every((player) => player?.online))));
  const hidden = mode === "local" && handoff !== null;
  const seats =
    state.seats ??
    Array.from(
      { length: 4 },
      (_, index): RiichiSeat => ({
        id: index,
        wind: index,
        name: room?.players?.[index]?.name ?? "等待加入",
        score: 25000,
        river: [],
        melds: [],
        handCount: 0,
      }),
    );
  const choices = hidden ? [] : (state.choices ?? []);
  const me = state.seat ?? human - 1;
  const handoffNumber = handoff === null ? 0 : handoff;
  const handoffName =
    seats.find((player) => player.id === handoff)?.name ??
    `玩家 ${String(handoffNumber + 1)}`;
  const seatHTML = seats
    .map(
      (player) =>
        `<section class="mj-seat ${player.id === me ? "you" : ""} ${state.turn === player.id ? "active" : ""}"><header><span class="wind-badge">${winds[player.wind] ?? "東"}</span><div><strong>${esc(player.name)}</strong><small>${player.id === me ? "你 · " : ""}${online && !room?.players?.[player.id]?.online ? "離線" : player.bot ? "AI 棋手" : "棋手"}${player.riichi ? " · 立直" : ""}</small></div><b class="mj-points">${player.score.toLocaleString()}</b></header><div class="mj-backs" aria-label="${String(player.handCount)} 張暗牌">${Array.from({ length: player.handCount }, () => "<i></i>").join("")}</div><div class="mj-melds">${player.melds.map(meld).join("")}</div><div class="mj-river" aria-label="${winds[player.wind] ?? "東"}家牌河">${player.river.map((discard) => tile(discard, `mini ${discard.includes("*") ? "riichi-discard" : ""} ${/[+=-]/.test(discard) ? "called" : ""}`)).join("") || "<small>尚未捨牌</small>"}</div></section>`,
    )
    .join("");
  const result = state.result;
  let resultHTML = "";
  if (result?.type === "hule")
    resultHTML = `<h3>${winds[result.l] ?? "東"}家${result.baojia == null ? "自摸" : "榮和"}</h3><p>${esc(result.fu ?? "")} 符 · ${esc(result.fanshu ?? "役滿")} 番 · ${String(result.defen)} 點</p><p>${(result.hupai ?? []).map((yaku) => `${esc(yaku.name)} ${esc(yaku.fanshu)}`).join(" ／ ")}</p><div class="mj-melds">${result.shoupai
      .split(",")
      .map((part, index) => (index ? meld(part) : concealed(part)))
      .join(
        "",
      )}</div>${result.fubaopai?.length ? `<p>裏寶牌指示牌 ${result.fubaopai.map((piece) => tile(piece, "mini")).join("")}</p>` : ""}<p>${(result.fenpei ?? []).map((value, index) => `${winds[index] ?? "東"} ${value > 0 ? "+" : ""}${String(value)}`).join(" · ")}</p>`;
  if (result?.type === "pingju")
    resultHTML = `<h3>流局 · ${esc(result.name)}</h3><p>${result.fenpei.map((value, index) => `${winds[index] ?? "東"} ${value > 0 ? "+" : ""}${String(value)}`).join(" · ")}</p>`;
  if (done && result?.type === "jieju")
    resultHTML = `<h3>對局結束</h3><div class="mj-ranking">${[...seats]
      .sort(
        (left, right) =>
          (result.rank[left.id] ?? 0) - (result.rank[right.id] ?? 0),
      )
      .map(
        (player) =>
          `<p><b>#${String(result.rank[player.id] ?? "")} ${esc(player.name)}</b><span>${(result.scores[player.id] ?? 0).toLocaleString()} 點</span></p>`,
      )
      .join("")}</div>`;
  root.innerHTML = `<div class="mj-heading"><div><div class="eyebrow dark">RIICHI MAHJONG</div><h1>日式麻將</h1></div><div class="mj-toolbar">${online ? `<button class="button outline" data-control="copy">房間 ${esc(room?.code)} ⧉</button>` : ""}<button class="button outline" data-control="rules">規則</button><button class="button outline" data-control="restart" ${online && (!done || room?.rematch?.includes(human) || !available) ? "disabled" : ""}>${online && room?.rematch?.includes(human) ? "等待再戰" : "再來一場"}</button></div></div>
 <div class="mj-center"><span>${waiting ? "等待入席" : `${winds[state.round] ?? "東"} ${String(state.handNumber)} 局`}</span><div><b>${String(state.honba)} 本場</b><small>立直棒 ${String(state.riichiSticks)} · 牌山 ${String(state.remaining ?? 70)} 張</small></div><div class="mj-dora"><small>寶牌指示牌</small>${(state.dora ?? []).map((piece) => tile(piece, "mini")).join("")}</div></div>
 ${waiting ? `<div class="mj-notice"><h3>${online ? "四人一桌，入席即開局。" : "正在洗牌與配牌…"}</h3><p>${online ? "分享房間代碼邀請朋友；房主也可以用 AI 補齊空位。" : "即將開始新的對局。"}</p>${online && human === 1 ? `<button class="button primary" data-control="start" ${busy || !connected ? "disabled" : ""}>以 AI 補齊並開局</button>` : ""}</div>` : ""}
  ${online && (!connected || room?.players?.some((player) => player && !player.online)) ? '<p class="mj-notice">有玩家離線，對局暫停；重新連線後繼續。</p>' : ""}
 <div class="mj-seats">${seatHTML}</div>
 ${resultHTML ? `<section class="mj-result" aria-live="polite">${resultHTML}</section>` : ""}
 <section class="mj-hand-panel"><header><h3>${winds[state.wind] ?? "東"}家手牌</h3><span aria-live="polite">${hidden ? "請交接裝置" : done ? "對局已結束" : choices.length ? "輪到你操作" : waiting ? "等待開局" : "等待其他棋手"}</span></header>
 ${
   hidden
     ? `<div class="mj-curtain"><strong>請將裝置交給 ${esc(handoffName)}</strong><p>其他玩家請移開視線，再顯示手牌。</p><button class="button primary" data-control="ready">我是這位玩家，顯示手牌</button></div>`
     : `<div class="mj-hand">${(state.hand ?? [])
         .map((piece, index) => {
           const drawn =
             Boolean(state.drawn) && index === (state.hand?.length ?? 0) - 1;
           const option =
             choices.find(
               (choice) =>
                 choice.kind === "discard" &&
                 choice.tile === piece + (drawn ? "_" : ""),
             ) ??
             choices.find(
               (choice) => choice.kind === "discard" && choice.tile === piece,
             );
           return `<button class="mj-hand-tile ${drawn ? "drawn" : ""}" aria-label="${option ? "打出" : "手牌"} ${esc(tileLabel(piece))}${drawn ? " 摸牌" : ""}" ${!option || !available ? "disabled" : ""} ${option ? `data-choice="${option.id}"` : ""}>${tile(piece)}</button>`;
         })
         .join("")}</div><div class="mj-actions">${choices
         .filter((choice) => choice.kind !== "discard")
         .map(
           (choice) =>
             `<button class="button ${["ron", "tsumo", "riichi"].includes(choice.kind) ? "primary" : "outline"}" data-choice="${choice.id}" ${available ? "" : "disabled"}>${esc(choice.label)}${choice.meld ? ` ${meld(choice.meld)}` : ""}</button>`,
         )
         .join("")}</div>`
 }
 <p class="mj-help">點選手牌直接打出；立直請選「立直」按鈕。只有符合規則的吃碰槓與和牌才會出現。${mode !== "online" ? "本機日麻不提供悔棋與重新整理續局。" : ""}</p></section>
 <details class="mj-log"><summary>本場紀錄（最近 ${String((state.history ?? []).length)} 筆）</summary>${(
   state.history ?? []
 )
   .slice(-30)
   .reverse()
   .map((entry) => `<p>${esc(entry.label)}</p>`)
   .join("")}</details>`;
  root.querySelectorAll<HTMLElement>("[data-choice]").forEach((button) => {
    button.onclick = (): void => {
      const id = button.dataset.choice;
      if (id) onAction(id);
    };
  });
  const controls: Record<string, () => void> = {
    ready: onReady,
    start: onStart,
    copy: onCopy,
    restart: onRestart,
    rules: onRules,
  };
  for (const [name, handler] of Object.entries(controls))
    root
      .querySelector<HTMLElement>(`[data-control="${name}"]`)
      ?.addEventListener("click", handler);
}
