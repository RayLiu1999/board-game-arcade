import Majiang, {
  type MajiangGame,
  type MajiangMessage,
  type MajiangModel,
  type MajiangReply,
  type MajiangShoupai,
} from "@kobalab/majiang-core";
import MahjongAI from "@kobalab/majiang-ai";

export const WINDS = ["東", "南", "西", "北"] as const;

export type RiichiShoupai = MajiangShoupai;
export type RiichiModel = MajiangModel;
export type RiichiCoreGame = MajiangGame;

export interface RiichiSessionOptions {
  humans?: number[];
  rounds?: number;
  names?: string[];
  onChange?: () => void;
  onError?: (error: unknown) => void;
  delay?: number;
  auto?: boolean;
}

export interface RiichiResult {
  readonly type: string;
  readonly rank?: number[];
  readonly scores?: number[];
  readonly point?: Array<string | number>;
  readonly log?: unknown;
  readonly fu?: string | number;
  readonly fanshu?: string | number;
  readonly defen?: number;
  readonly fenpei?: number[];
  readonly [key: string]: unknown;
}

export interface RiichiChoice {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly tile?: string;
  readonly meld?: string;
}

export interface RiichiChoiceDraft {
  readonly label: string;
  readonly reply: MajiangReply;
  readonly kind: string;
  readonly tile?: string;
  readonly meld?: string;
}

export interface RiichiSeat {
  readonly id: number;
  readonly wind: number;
  readonly name: string;
  readonly score: number;
  readonly handCount: number;
  readonly river: string[];
  readonly melds: string[];
  readonly hand?: never;
  readonly shoupai?: never;
  readonly bot?: boolean;
}

export interface RiichiView {
  readonly game: "riichi";
  readonly phase: "waiting" | "play" | "finished";
  readonly winner: number | null;
  readonly ply: number;
  readonly seat: number;
  readonly wind: number;
  readonly turn: number | null;
  readonly round: number;
  readonly handNumber: number;
  readonly honba: number;
  readonly riichiSticks: number;
  readonly remaining: number;
  readonly dora: string[];
  readonly hand: string[];
  readonly drawn: string | null;
  readonly seats: RiichiSeat[];
  readonly choices: RiichiChoice[];
  readonly awaiting: number[];
  readonly rounds: number;
  readonly result: RiichiResult | null;
  readonly history: Array<{ readonly label: string }>;
  readonly paused: boolean;
}

interface RiichiPendingChoice extends RiichiChoiceDraft {
  readonly id: string;
}

interface RiichiPrompt {
  readonly callback: (reply: MajiangReply) => void;
  readonly choices: RiichiPendingChoice[];
}

interface RiichiHistoryEntry {
  readonly label: string;
}

const choice = (
  label: string,
  reply: MajiangReply,
  extra: Pick<RiichiChoiceDraft, "kind" | "tile" | "meld">,
): RiichiChoiceDraft => ({ label, reply, ...extra });

const publicChoice = (current: RiichiPendingChoice): RiichiChoice => ({
  id: current.id,
  label: current.label,
  kind: current.kind,
  ...(current.tile === undefined ? {} : { tile: current.tile }),
  ...(current.meld === undefined ? {} : { meld: current.meld }),
});

const recordOf = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("日麻事件資料格式錯誤");
  return value as Record<string, unknown>;
};

const numberAt = (data: Record<string, unknown>, key: string): number => {
  const value = data[key];
  if (typeof value !== "number")
    throw new Error(`日麻事件缺少數字欄位：${key}`);
  return value;
};

const stringAt = (data: Record<string, unknown>, key: string): string => {
  const value = data[key];
  if (typeof value !== "string")
    throw new Error(`日麻事件缺少文字欄位：${key}`);
  return value;
};

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.every((entry: unknown): entry is number => typeof entry === "number");

const numberArrayAt = (
  data: Record<string, unknown>,
  key: string,
): number[] => {
  const value = data[key];
  if (!isNumberArray(value))
    throw new Error(`日麻事件缺少數字陣列欄位：${key}`);
  return value;
};

const stringOrNumberArrayAt = (
  data: Record<string, unknown>,
  key: string,
): Array<string | number> => {
  const value = data[key];
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry: unknown): entry is string | number =>
        typeof entry === "string" || typeof entry === "number",
    )
  )
    throw new Error(`日麻事件缺少文字或數字陣列欄位：${key}`);
  return value;
};

const windName = (wind: number): string => WINDS[wind] ?? "";

export function tileName(piece: string | undefined): string {
  if (!piece) return "";
  const suit = piece[0];
  const number = piece[1];
  if (!suit || !number) return "";
  if (suit === "z")
    return ["", "東", "南", "西", "北", "白", "發", "中"][Number(number)] ?? "";
  const suitNames: Record<string, string> = {
    m: "萬",
    p: "筒",
    s: "索",
  };
  return `${number === "0" ? "赤5" : number}${suitNames[suit] ?? ""}`;
}

export function handTiles(hand: RiichiShoupai | string | undefined): string[] {
  if (!hand) return [];
  const first = (typeof hand === "string" ? hand : hand.toString()).split(
    ",",
  )[0];
  if (!first) return [];
  return [...first.matchAll(/([mpsz])(\d+)/g)].flatMap((match) => {
    const suit = match[1];
    const numbers = match[2];
    if (!suit || !numbers) return [];
    return Array.from(numbers, (number) => suit + number);
  });
}

// Legal choices are computed on the authoritative engine, never trusted from a client.
export function riichiChoices(
  game: RiichiCoreGame,
  id: number,
  type: string,
): RiichiChoiceDraft[] {
  const model = game.model;
  const localSeat = model.player_id.indexOf(id);
  const own = localSeat === model.lunban;
  const out: RiichiChoiceDraft[] = [];
  const discards = (): void => {
    for (const piece of game.get_dapai()) {
      out.push(
        choice(
          `打 ${tileName(piece)}`,
          { dapai: piece },
          {
            kind: "discard",
            tile: piece,
          },
        ),
      );
      if (type !== "fulou" && game.allow_lizhi(piece))
        out.push(
          choice(
            `立直 · ${tileName(piece)}`,
            { dapai: `${piece}*` },
            {
              kind: "riichi",
              tile: piece,
            },
          ),
        );
    }
  };
  if (["zimo", "gangzimo"].includes(type) && own) {
    if (game.allow_hule())
      out.push(choice("自摸", { hule: "-" }, { kind: "tsumo" }));
    if (game.allow_pingju())
      out.push(choice("九種九牌流局", { daopai: "-" }, { kind: "abort" }));
    for (const meld of game.get_gang_mianzi())
      out.push(
        choice(
          meld.match(/^[mpsz]\d{4}$/) ? "暗槓" : "加槓",
          { gang: meld },
          {
            kind: "kan",
            meld,
          },
        ),
      );
    discards();
  }
  if (type === "fulou" && own && !game._gang) discards();
  if (type === "dapai" && !own) {
    if (game.allow_hule(localSeat))
      out.push(choice("榮和", { hule: "-" }, { kind: "ron" }));
    const calls: Array<
      ["pon" | "kan" | "chi", string, (seat: number) => string[]]
    > = [
      ["pon", "碰", (seat) => game.get_peng_mianzi(seat)],
      ["kan", "明槓", (seat) => game.get_gang_mianzi(seat)],
      ["chi", "吃", (seat) => game.get_chi_mianzi(seat)],
    ];
    for (const [kind, label, getMelds] of calls)
      for (const meld of getMelds(localSeat))
        out.push(choice(label, { fulou: meld }, { kind, meld }));
    if (out.length) out.push(choice("跳過", {}, { kind: "pass" }));
  }
  if (
    type === "gang" &&
    !own &&
    game._gang !== null &&
    game._gang.match(/^[mpsz]\d{4}$/) === null &&
    game.allow_hule(localSeat)
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
  readonly humans: Set<number>;
  readonly onChange: () => void;
  readonly onError: (error: unknown) => void;
  readonly delay: number;
  readonly auto: boolean;
  readonly rounds: number;
  readonly pending: Map<number, RiichiPrompt>;
  readonly queue: Array<() => void>;
  readonly history: RiichiHistoryEntry[];
  game: RiichiCoreGame;
  revision: number;
  result: RiichiResult | null;
  done: boolean;
  closed: boolean;
  paused: boolean;
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;

  constructor(options: RiichiSessionOptions = {}) {
    const {
      humans = [0],
      rounds = 1,
      names = ["你", "AI 南", "AI 西", "AI 北"],
      onChange = () => {},
      onError = () => {},
      delay = 180,
      auto = true,
    } = options;
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
    this.started = false;
    this.timer = null;

    const players = Array.from({ length: 4 }, (_, id) => {
      if (!this.humans.has(id)) return new MahjongAI();
      return {
        action: (
          message: MajiangMessage,
          callback?: (reply: MajiangReply) => void,
        ): void => {
          if (!callback) return;
          const type = Object.keys(message)[0];
          if (!type) {
            callback({});
            return;
          }
          const choices = riichiChoices(this.game, id, type);
          if (!choices.length) {
            callback({});
            return;
          }
          this.pending.set(id, {
            callback,
            choices: choices.map((current, index) => ({
              ...current,
              id: `${String(this.revision)}:${String(id)}:${String(index)}`,
            })),
          });
        },
      };
    });

    this.game = new Majiang.Game(
      players,
      () => {},
      Majiang.rule({ 場数: this.rounds, 延長戦方式: 0 }),
      "棋聚 · 日式麻將",
    );
    this.game.model.player = names.map((name, index) => {
      const playerName = name || "玩家 " + String(index + 1);
      return playerName.slice(0, 20);
    });
    this.game._sync = true;
    this.game.delay = (callback) => {
      this.queue.push(callback);
    };
    this.game.call_players = (type, messages) => {
      if (this.closed) return;
      this.revision++;
      this.game._status = type;
      this.game._reply = [];
      const firstMessage = messages[0];
      if (!firstMessage) throw new Error("日麻事件缺少玩家訊息");
      this.record(type, firstMessage[type]);
      for (let seat = 0; seat < 4; seat++) {
        const id = this.game.model.player_id[seat];
        const player = id === undefined ? undefined : players[id];
        const message = messages[seat];
        if (id === undefined || !player || !message) continue;
        player.action(message, (reply) => {
          this.game.reply(id, reply);
        });
      }
      this.onChange();
      this.schedule();
    };
    if (this.rounds === 0)
      this.game.last = () => {
        this.queue.push(() => {
          this.game.jieju();
        });
      };
  }

  start(): void {
    if (this.started) throw new Error("對局已開始");
    this.started = true;
    this.game.kaiju(0);
    this.schedule();
  }

  record(type: string, data: unknown): void {
    const event = recordOf(data);
    if (type === "qipai") {
      this.result = null;
      this.history.push({
        label: `${windName(numberAt(event, "zhuangfeng"))}${String(numberAt(event, "jushu") + 1)}局 · ${String(numberAt(event, "changbang"))}本場`,
      });
    }
    if (type === "dapai") {
      const piece = stringAt(event, "p");
      this.history.push({
        label: `${windName(numberAt(event, "l"))}家打 ${tileName(piece)}${piece.includes("*") ? " · 立直" : ""}`,
      });
    }
    if (type === "fulou" || type === "gang") {
      const meld = stringAt(event, "m");
      this.history.push({
        label: `${windName(numberAt(event, "l"))}家 ${type === "gang" ? "槓" : "副露"} ${(meld.match(/\d/g) || []).map((number) => tileName(`${meld[0] ?? ""}${number}`)).join(" ")}`,
      });
    }
    if (type === "hule") {
      this.result = { type, ...event };
      this.history.push({
        label: `${windName(numberAt(event, "l"))}家${event.baojia == null ? "自摸" : "榮和"} · ${String(numberAt(event, "defen"))}點`,
      });
    }
    if (type === "pingju") {
      this.result = { type, ...event };
      this.history.push({ label: `流局 · ${stringAt(event, "name")}` });
    }
    if (type === "jieju") {
      this.done = true;
      this.result = {
        type,
        scores: [...numberArrayAt(event, "defen")],
        rank: [...numberArrayAt(event, "rank")],
        point: [...stringOrNumberArrayAt(event, "point")],
      };
    }
    this.history.splice(0, Math.max(0, this.history.length - 160));
  }

  schedule(): void {
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
      } catch (error: unknown) {
        this.paused = true;
        this.onError(error);
      }
    }, this.delay);
  }

  step(): boolean {
    if (this.closed || this.paused || this.done || this.pending.size)
      return false;
    const queued = this.queue.shift();
    if (queued) queued();
    else if (this.game._reply.filter(Boolean).length === 4) this.game.next();
    else return false;
    this.schedule();
    return true;
  }

  act(id: number, actionId: string): void {
    if (this.closed || this.paused) throw new Error("對局目前暫停");
    const prompt = this.pending.get(id);
    if (!prompt) throw new Error("此操作已失效或不屬於你的座位");
    const action = prompt.choices.find((current) => current.id === actionId);
    if (!action) throw new Error("此操作已失效或不屬於你的座位");
    this.pending.delete(id);
    prompt.callback(structuredClone(action.reply));
    this.onChange();
    this.schedule();
  }

  pause(value = true): void {
    this.paused = value;
    if (value) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    } else this.schedule();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    this.queue.length = 0;
  }

  view(id: number): RiichiView {
    if (!Number.isInteger(id) || id < 0 || id > 3) throw new Error("無效座位");
    const model = this.game.model;
    const seat = model.player_id.indexOf(id);
    if (seat < 0) throw new Error("無效座位");
    const hand = model.shoupai[seat];
    return {
      game: "riichi",
      phase: this.done ? "finished" : this.started ? "play" : "waiting",
      winner: this.done ? (this.result?.rank?.indexOf(1) ?? -1) + 1 : null,
      ply: this.revision,
      seat: id,
      wind: seat,
      turn: model.player_id[model.lunban] ?? null,
      round: model.zhuangfeng,
      handNumber: model.jushu + 1,
      honba: model.changbang,
      riichiSticks: model.lizhibang,
      remaining: model.shan?.paishu ?? 70,
      dora: model.shan?.baopai ? [...model.shan.baopai] : [],
      rounds: this.rounds,
      // Only this seat's concealed tiles are serialized. Never send Game.model or paipu.
      hand: handTiles(hand),
      drawn: hand?._zimo?.length === 2 ? hand._zimo : null,
      seats: model.player_id.map((playerId, wind) => ({
        id: playerId,
        wind,
        name: model.player[playerId] ?? `玩家 ${String(playerId + 1)}`,
        score: model.defen[playerId] ?? 0,
        handCount: handTiles(model.shoupai[wind]).length,
        melds: [...(model.shoupai[wind]?._fulou || [])],
        river: [...(model.he[wind]?._pai || [])],
        riichi: !!model.shoupai[wind]?.lizhi,
        bot: !this.humans.has(playerId),
      })),
      choices: (this.pending.get(id)?.choices || []).map(publicChoice),
      awaiting: [...this.pending.keys()],
      result: this.result ? structuredClone(this.result) : null,
      history: structuredClone(this.history),
      paused: this.paused,
    };
  }
}
