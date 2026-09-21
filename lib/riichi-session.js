import Majiang from "@kobalab/majiang-core";
import MahjongAI from "@kobalab/majiang-ai";

export const WINDS = ["東", "南", "西", "北"];
export function tileName(p) {
  if (!p) return "";
  const suit = p[0],
    n = p[1];
  return suit === "z"
    ? ["", "東", "南", "西", "北", "白", "發", "中"][Number(n)]
    : (n === "0" ? "赤5" : n) + ({ m: "萬", p: "筒", s: "索" }[suit] || "");
}
export function handTiles(hand) {
  if (!hand) return [];
  const str =
    typeof hand === "string"
      ? hand.split(",")[0]
      : hand.toString().split(",")[0];
  return [...str.matchAll(/([mpsz])(\d+)/g)].flatMap((m) =>
    [...m[2]].map((n) => m[1] + n),
  );
}
const choice = (label, reply, extra = {}) => ({ label, reply, ...extra });
// Legal choices are computed on the authoritative engine, never trusted from a client.
export function riichiChoices(game, id, type) {
  const m = game.model,
    l = m.player_id.indexOf(id),
    own = l === m.lunban,
    out = [];
  const discards = () => {
    for (const p of game.get_dapai()) {
      out.push(
        choice("打 " + tileName(p), { dapai: p }, { kind: "discard", tile: p }),
      );
      if (type !== "fulou" && game.allow_lizhi(p))
        out.push(
          choice(
            "立直 · " + tileName(p),
            { dapai: p + "*" },
            { kind: "riichi", tile: p },
          ),
        );
    }
  };
  if (["zimo", "gangzimo"].includes(type) && own) {
    if (game.allow_hule())
      out.push(choice("自摸", { hule: "-" }, { kind: "tsumo" }));
    if (game.allow_pingju())
      out.push(choice("九種九牌流局", { daopai: "-" }, { kind: "abort" }));
    for (const meld of game.get_gang_mianzi() || [])
      out.push(
        choice(
          meld.match(/^[mpsz]\d{4}$/) ? "暗槓" : "加槓",
          { gang: meld },
          { kind: "kan", meld },
        ),
      );
    discards();
  }
  if (type === "fulou" && own && !game._gang) discards();
  if (type === "dapai" && !own) {
    if (game.allow_hule(l))
      out.push(choice("榮和", { hule: "-" }, { kind: "ron" }));
    for (const [kind, label, method] of [
      ["pon", "碰", "get_peng_mianzi"],
      ["kan", "明槓", "get_gang_mianzi"],
      ["chi", "吃", "get_chi_mianzi"],
    ])
      for (const meld of game[method](l) || [])
        out.push(choice(label, { fulou: meld }, { kind, meld }));
    if (out.length) out.push(choice("跳過", {}, { kind: "pass" }));
  }
  if (
    type === "gang" &&
    !own &&
    !game._gang.match(/^[mpsz]\d{4}$/) &&
    game.allow_hule(l)
  )
    out.push(
      choice("搶槓榮和", { hule: "-" }, { kind: "ron" }),
      choice("跳過", {}, { kind: "pass" }),
    );
  if (["hule", "pingju"].includes(type))
    out.push(choice("確認結算，繼續", {}, { kind: "continue" }));
  return out;
}

export class RiichiSession {
  constructor({
    humans = [0],
    rounds = 1,
    names = ["你", "AI 南", "AI 西", "AI 北"],
    onChange = () => {},
    onError = () => {},
    delay = 180,
    auto = true,
  } = {}) {
    this.humans = new Set(humans);
    this.onChange = onChange;
    this.onError = onError;
    this.delay = delay;
    this.auto = auto;
    this.rounds = [0, 1, 2].includes(rounds) ? rounds : 1;
    this.pending = new Map();
    this.queue = [];
    this.revision = 0;
    this.history = [];
    this.result = null;
    this.done = false;
    this.closed = false;
    this.paused = false;
    this.timer = null;
    const players = Array.from({ length: 4 }, (_, id) =>
      this.humans.has(id)
        ? {
            action: (msg, callback) => {
              if (!callback) return;
              const type = Object.keys(msg)[0],
                choices = riichiChoices(this.game, id, type);
              if (!choices.length) return callback({});
              this.pending.set(id, {
                callback,
                choices: choices.map((c, i) => ({
                  ...c,
                  id: `${this.revision}:${id}:${i}`,
                })),
              });
            },
          }
        : new MahjongAI(),
    );
    this.game = new Majiang.Game(
      players,
      () => {},
      Majiang.rule({ 場数: this.rounds, 延長戦方式: 0 }),
      "棋聚 · 日式麻將",
    );
    this.game.model.player = names.map((n, i) =>
      String(n || `玩家 ${i + 1}`).slice(0, 20),
    );
    this.game._sync = true;
    this.game.delay = (fn) => this.queue.push(fn);
    this.game.call_players = (type, messages) => {
      if (this.closed) return;
      this.revision++;
      this.game._status = type;
      this.game._reply = [];
      this.pending.clear();
      this.record(type, messages[0][type]);
      for (let l = 0; l < 4; l++) {
        const id = this.game.model.player_id[l];
        players[id].action(messages[l], (reply) => this.game.reply(id, reply));
      }
      this.onChange();
      this.schedule();
    };
    if (this.rounds === 0)
      this.game.last = () => this.queue.push(() => this.game.jieju());
  }
  start() {
    if (this.started) throw Error("對局已開始");
    this.started = true;
    this.game.kaiju(0);
    this.schedule();
  }
  record(type, data) {
    const model = this.game.model;
    if (type === "qipai") {
      this.result = null;
      this.history.push({
        label: `${WINDS[data.zhuangfeng]}${data.jushu + 1}局 · ${data.changbang}本場`,
      });
    }
    if (type === "dapai")
      this.history.push({
        label: `${WINDS[data.l]}家打 ${tileName(data.p)}${data.p.includes("*") ? " · 立直" : ""}`,
      });
    if (type === "fulou" || type === "gang")
      this.history.push({
        label: `${WINDS[data.l]}家 ${type === "gang" ? "槓" : "副露"} ${(data.m.match(/\d/g) || []).map((n) => tileName(data.m[0] + n)).join(" ")}`,
      });
    if (type === "hule") {
      this.result = { type, ...structuredClone(data) };
      this.history.push({
        label: `${WINDS[data.l]}家${data.baojia == null ? "自摸" : "榮和"} · ${data.defen}點`,
      });
    }
    if (type === "pingju") {
      this.result = { type, ...structuredClone(data) };
      this.history.push({ label: `流局 · ${data.name}` });
    }
    if (type === "jieju") {
      this.done = true;
      this.result = {
        type,
        scores: [...data.defen],
        rank: [...data.rank],
        point: [...data.point],
      };
    }
    this.history = this.history.slice(-160);
  }
  schedule() {
    if (
      !this.auto ||
      this.timer ||
      this.closed ||
      this.paused ||
      this.done ||
      this.pending.size
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.step();
      } catch (e) {
        this.paused = true;
        this.onError(e);
      }
    }, this.delay);
  }
  step() {
    if (this.closed || this.paused || this.done || this.pending.size)
      return false;
    if (this.queue.length) this.queue.shift()();
    else if (this.game._reply.filter(Boolean).length === 4) this.game.next();
    else return false;
    this.schedule();
    return true;
  }
  act(id, actionId) {
    if (this.closed || this.paused) throw Error("對局目前暫停");
    const prompt = this.pending.get(id);
    const action = prompt?.choices.find((c) => c.id === actionId);
    if (!action) throw Error("此操作已失效或不屬於你的座位");
    this.pending.delete(id);
    prompt.callback(structuredClone(action.reply));
    this.onChange();
    this.schedule();
  }
  pause(value = true) {
    this.paused = value;
    if (value) {
      clearTimeout(this.timer);
      this.timer = null;
    } else this.schedule();
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    this.queue = [];
  }
  view(id) {
    if (!Number.isInteger(id) || id < 0 || id > 3) throw Error("無效座位");
    const m = this.game.model,
      seat = m.player_id.indexOf(id),
      hand = m.shoupai[seat];
    return {
      game: "riichi",
      phase: this.done ? "finished" : this.started ? "play" : "waiting",
      winner: this.done ? this.result.rank.indexOf(1) + 1 : null,
      ply: this.revision,
      seat: id,
      wind: seat,
      turn: m.player_id[m.lunban] ?? null,
      round: m.zhuangfeng,
      handNumber: m.jushu + 1,
      honba: m.changbang,
      riichiSticks: m.lizhibang,
      remaining: m.shan?.paishu ?? 70,
      dora: m.shan?.baopai ? [...m.shan.baopai] : [],
      rounds: this.rounds,
      // Only this seat's concealed tiles are serialized. Never send Game.model or paipu.
      hand: handTiles(hand),
      drawn: hand?._zimo?.length === 2 ? hand._zimo : null,
      seats: m.player_id.map((playerId, l) => ({
        id: playerId,
        wind: l,
        name: m.player[playerId],
        score: m.defen[playerId],
        handCount: handTiles(m.shoupai[l]).length,
        melds: [...(m.shoupai[l]?._fulou || [])],
        river: [...(m.he[l]?._pai || [])],
        riichi: !!m.shoupai[l]?.lizhi,
        bot: !this.humans.has(playerId),
      })),
      choices: (this.pending.get(id)?.choices || []).map(
        ({ reply, ...publicChoice }) => publicChoice,
      ),
      awaiting: [...this.pending.keys()],
      result: this.result ? structuredClone(this.result) : null,
      history: structuredClone(this.history),
      paused: this.paused,
    };
  }
}
