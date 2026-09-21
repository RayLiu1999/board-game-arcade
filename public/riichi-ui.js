const winds = ["東", "南", "西", "北"];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function tileLabel(p) {
  if (!p) return "";
  return p[0] === "z"
    ? ["", "東", "南", "西", "北", "白", "發", "中"][Number(p[1])]
    : `${p[1] === "0" ? "赤5" : p[1]}${{ m: "萬", p: "筒", s: "索" }[p[0]]}`;
}
function tile(p, extra = "") {
  const suit = p?.[0],
    n = p?.[1];
  return `<span class="mj-tile ${suit || ""} ${n === "0" ? "red-five" : ""} ${extra}" title="${esc(tileLabel(p))}"><b>${suit === "z" ? tileLabel(p) : n === "0" ? "5" : n}</b>${suit !== "z" ? `<small>${{ m: "萬", p: "筒", s: "索" }[suit] || ""}</small>` : ""}</span>`;
}
function concealed(str) {
  return [...String(str).matchAll(/([mpsz])(\d+)/g)]
    .flatMap((m) => [...m[2]].map((n) => tile(m[1] + n, "mini")))
    .join("");
}
function meld(m) {
  return `<span class="mj-meld">${(m.match(/\d/g) || []).map((n) => tile(m[0] + n, "mini")).join("")}</span>`;
}
export function renderRiichi(
  root,
  s,
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
  },
) {
  const waiting = s.phase === "waiting",
    done = s.phase === "finished",
    online = mode === "online";
  const available =
    !busy &&
    !s.paused &&
    (!online || (connected && room?.players?.every((p) => p?.online)));
  const hidden = mode === "local" && handoff !== null;
  const seats =
    s.seats ||
    Array.from({ length: 4 }, (_, i) => ({
      id: i,
      wind: i,
      name: room?.players?.[i]?.name || "等待加入",
      score: 25000,
      river: [],
      melds: [],
      handCount: 0,
    }));
  const choices = hidden ? [] : s.choices || [];
  const me = s.seat ?? human - 1;
  const seatHTML = seats
    .map(
      (p) =>
        `<section class="mj-seat ${p.id === me ? "you" : ""} ${s.turn === p.id ? "active" : ""}"><header><span class="wind-badge">${winds[p.wind]}</span><div><strong>${esc(p.name)}</strong><small>${p.id === me ? "你 · " : ""}${online && !room?.players?.[p.id]?.online ? "離線" : p.bot ? "AI 棋手" : "棋手"}${p.riichi ? " · 立直" : ""}</small></div><b class="mj-points">${p.score.toLocaleString()}</b></header><div class="mj-backs" aria-label="${p.handCount} 張暗牌">${Array.from({ length: p.handCount }, () => "<i></i>").join("")}</div><div class="mj-melds">${p.melds.map(meld).join("")}</div><div class="mj-river" aria-label="${winds[p.wind]}家牌河">${p.river.map((p) => tile(p, `mini ${p.includes("*") ? "riichi-discard" : ""} ${/[+=-]/.test(p) ? "called" : ""}`)).join("") || "<small>尚未捨牌</small>"}</div></section>`,
    )
    .join("");
  const result = s.result;
  let resultHTML = "";
  if (result?.type === "hule")
    resultHTML = `<h3>${winds[result.l]}家${result.baojia == null ? "自摸" : "榮和"}</h3><p>${esc(result.fu || "")} 符 · ${esc(result.fanshu || "役滿")} 番 · ${result.defen} 點</p><p>${(result.hupai || []).map((y) => `${esc(y.name)} ${esc(y.fanshu)}`).join(" ／ ")}</p><div class="mj-melds">${String(
      result.shoupai,
    )
      .split(",")
      .map((m, i) => (i ? meld(m) : concealed(m)))
      .join(
        "",
      )}</div>${result.fubaopai?.length ? `<p>裏寶牌指示牌 ${result.fubaopai.map((p) => tile(p, "mini")).join("")}</p>` : ""}<p>${(result.fenpei || []).map((v, i) => `${winds[i]} ${v > 0 ? "+" : ""}${v}`).join(" · ")}</p>`;
  if (result?.type === "pingju")
    resultHTML = `<h3>流局 · ${esc(result.name)}</h3><p>${result.fenpei.map((v, i) => `${winds[i]} ${v > 0 ? "+" : ""}${v}`).join(" · ")}</p>`;
  if (done && result?.rank)
    resultHTML = `<h3>對局結束</h3><div class="mj-ranking">${[...seats]
      .sort((a, b) => result.rank[a.id] - result.rank[b.id])
      .map(
        (p) =>
          `<p><b>#${result.rank[p.id]} ${esc(p.name)}</b><span>${result.scores[p.id].toLocaleString()} 點</span></p>`,
      )
      .join("")}</div>`;
  root.innerHTML = `<div class="mj-heading"><div><div class="eyebrow dark">RIICHI MAHJONG</div><h1>日式麻將</h1></div><div class="mj-toolbar">${online ? `<button class="button outline" data-control="copy">房間 ${esc(room?.code)} ⧉</button>` : ""}<button class="button outline" data-control="rules">規則</button><button class="button outline" data-control="restart" ${online && (!done || room?.rematch?.includes(human) || !available) ? "disabled" : ""}>${online && room?.rematch?.includes(human) ? "等待再戰" : "再來一場"}</button></div></div>
 <div class="mj-center"><span>${waiting ? "等待入席" : `${winds[s.round] || "東"} ${s.handNumber} 局`}</span><div><b>${s.honba || 0} 本場</b><small>立直棒 ${s.riichiSticks || 0} · 牌山 ${s.remaining ?? 70} 張</small></div><div class="mj-dora"><small>寶牌指示牌</small>${(s.dora || []).map((p) => tile(p, "mini")).join("")}</div></div>
 ${waiting ? `<div class="mj-notice"><h3>${online ? "四人一桌，入席即開局。" : "正在洗牌與配牌…"}</h3><p>${online ? "分享房間代碼邀請朋友；房主也可以用 AI 補齊空位。" : "即將開始新的對局。"}</p>${online && human === 1 ? `<button class="button primary" data-control="start" ${busy || !connected ? "disabled" : ""}>以 AI 補齊並開局</button>` : ""}</div>` : ""}
 ${online && (!connected || room?.players?.some((p) => p && !p.online)) ? '<p class="mj-notice">有玩家離線，對局暫停；重新連線後繼續。</p>' : ""}
 <div class="mj-seats">${seatHTML}</div>
 ${resultHTML ? `<section class="mj-result" aria-live="polite">${resultHTML}</section>` : ""}
 <section class="mj-hand-panel"><header><h3>${winds[s.wind] || "東"}家手牌</h3><span aria-live="polite">${hidden ? "請交接裝置" : done ? "對局已結束" : choices.length ? "輪到你操作" : waiting ? "等待開局" : "等待其他棋手"}</span></header>
 ${
   hidden
     ? `<div class="mj-curtain"><strong>請將裝置交給 ${esc(seats.find((p) => p.id === handoff)?.name || `玩家 ${handoff + 1}`)}</strong><p>其他玩家請移開視線，再顯示手牌。</p><button class="button primary" data-control="ready">我是這位玩家，顯示手牌</button></div>`
     : `<div class="mj-hand">${(s.hand || [])
         .map((p, i) => {
           const drawn = !!s.drawn && i === s.hand.length - 1;
           const option =
             choices.find(
               (c) => c.kind === "discard" && c.tile === p + (drawn ? "_" : ""),
             ) || choices.find((c) => c.kind === "discard" && c.tile === p);
           return `<button class="mj-hand-tile ${drawn ? "drawn" : ""}" aria-label="${option ? "打出" : "手牌"} ${esc(tileLabel(p))}${drawn ? " 摸牌" : ""}" ${!option || !available ? "disabled" : ""} ${option ? `data-choice="${option.id}"` : ""}>${tile(p)}</button>`;
         })
         .join("")}</div><div class="mj-actions">${choices
         .filter((c) => c.kind !== "discard")
         .map(
           (c) =>
             `<button class="button ${["ron", "tsumo", "riichi"].includes(c.kind) ? "primary" : "outline"}" data-choice="${c.id}" ${available ? "" : "disabled"}>${esc(c.label)}${c.meld ? ` ${meld(c.meld)}` : ""}</button>`,
         )
         .join("")}</div>`
 }
 <p class="mj-help">點選手牌直接打出；立直請選「立直」按鈕。只有符合規則的吃碰槓與和牌才會出現。${mode !== "online" ? "本機日麻不提供悔棋與重新整理續局。" : ""}</p></section>
 <details class="mj-log"><summary>本場紀錄（最近 ${(s.history || []).length} 筆）</summary>${(
   s.history || []
 )
   .slice(-30)
   .reverse()
   .map((h) => `<p>${esc(h.label)}</p>`)
   .join("")}</details>`;
  root
    .querySelectorAll("[data-choice]")
    .forEach((b) => (b.onclick = () => onAction(b.dataset.choice)));
  for (const [k, fn] of Object.entries({
    ready: onReady,
    start: onStart,
    copy: onCopy,
    restart: onRestart,
    rules: onRules,
  }))
    root.querySelector(`[data-control="${k}"]`)?.addEventListener("click", fn);
}
