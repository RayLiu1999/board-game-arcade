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

export interface RiichiShanSnapshot {
  readonly pai: string[];
  readonly baopai: string[];
  readonly fubaopai: string[] | null;
  readonly weikaigang: boolean;
  readonly closed: boolean;
}

export interface RiichiModelSnapshot {
  readonly title: string;
  readonly player: string[];
  readonly qijia: number;
  readonly zhuangfeng: number;
  readonly jushu: number;
  readonly changbang: number;
  readonly lizhibang: number;
  readonly defen: number[];
  readonly shan: RiichiShanSnapshot | null;
  readonly shoupai: string[];
  readonly he: string[][];
  readonly playerId: number[];
  readonly lunban: number;
  readonly board: {
    readonly lizhi: boolean;
    readonly fenpei: number[] | null;
    readonly lianzhuang: boolean;
    readonly changbang: number;
    readonly lizhibang: number;
  };
}

export interface RiichiEngineSnapshot {
  readonly status: string | null;
  readonly reply: Array<MajiangReply | null>;
  readonly paipu: Record<string, unknown> | null;
  readonly diyizimo: boolean;
  readonly fengpai: boolean;
  readonly dapai: string | null;
  readonly gang: string | null;
  readonly lizhi: number[];
  readonly yifa: number[];
  readonly nGang: number[];
  readonly nengRong: boolean[];
  readonly hule: number[];
  readonly huleOption: string | null;
  readonly noGame: boolean;
  readonly lianzhuang: boolean;
  readonly changbang: number;
  readonly fenpei: number[] | null;
  readonly maxJushu: number;
  readonly activeType: string | null;
}

export interface RiichiSessionSnapshot {
  readonly version: 1;
  readonly humans: number[];
  readonly rounds: number;
  readonly names: string[];
  readonly revision: number;
  readonly started: boolean;
  readonly paused: boolean;
  readonly done: boolean;
  readonly result: RiichiResult | null;
  readonly history: RiichiHistoryEntry[];
  readonly model: RiichiModelSnapshot;
  readonly engine: RiichiEngineSnapshot;
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

export interface RiichiHistoryEntry {
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

const integerAt = (
  data: Record<string, unknown>,
  key: string,
  minimum?: number,
): number => {
  const value = data[key];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (minimum !== undefined && value < minimum)
  )
    throw new Error(`日麻快照缺少有效整數欄位：${key}`);
  return value;
};

const booleanAt = (data: Record<string, unknown>, key: string): boolean => {
  const value = data[key];
  if (typeof value !== "boolean")
    throw new Error(`日麻快照缺少布林欄位：${key}`);
  return value;
};

const nullableStringAt = (
  data: Record<string, unknown>,
  key: string,
): string | null => {
  const value = data[key];
  if (value !== null && typeof value !== "string")
    throw new Error(`日麻快照缺少文字欄位：${key}`);
  return value;
};

const stringArrayAt = (
  data: Record<string, unknown>,
  key: string,
  length?: number,
): string[] => {
  const value = data[key];
  if (
    !Array.isArray(value) ||
    (length !== undefined && value.length !== length) ||
    !value.every((entry: unknown): entry is string => typeof entry === "string")
  )
    throw new Error(`日麻快照缺少文字陣列欄位：${key}`);
  return [...value];
};

const integerArrayAt = (
  data: Record<string, unknown>,
  key: string,
  length?: number,
): number[] => {
  const value = data[key];
  if (
    !Array.isArray(value) ||
    (length !== undefined && value.length !== length) ||
    !value.every(
      (entry: unknown): entry is number =>
        typeof entry === "number" && Number.isSafeInteger(entry),
    )
  )
    throw new Error(`日麻快照缺少整數陣列欄位：${key}`);
  return [...value];
};

const booleanArrayAt = (
  data: Record<string, unknown>,
  key: string,
  length?: number,
): boolean[] => {
  const value = data[key];
  if (
    !Array.isArray(value) ||
    (length !== undefined && value.length !== length) ||
    !value.every(
      (entry: unknown): entry is boolean => typeof entry === "boolean",
    )
  )
    throw new Error(`日麻快照布林陣列欄位錯誤：${key}`);
  return [...value];
};

const nullableIntegerArrayAt = (
  data: Record<string, unknown>,
  key: string,
  length?: number,
): number[] | null => {
  if (data[key] === null) return null;
  return integerArrayAt(data, key, length);
};

const parseResult = (value: unknown): RiichiResult | null => {
  if (value === null) return null;
  const result = recordOf(value);
  if (typeof result.type !== "string")
    throw new Error("日麻快照 result 格式錯誤");
  return structuredClone(result) as RiichiResult;
};

const parsePaipu = (value: unknown): Record<string, unknown> | null => {
  if (value === null) return null;
  const paipu = recordOf(value);
  if (
    !Array.isArray(paipu.log) ||
    !paipu.log.every(
      (round: unknown) =>
        Array.isArray(round) &&
        round.every(
          (entry: unknown) =>
            typeof entry === "object" &&
            entry !== null &&
            !Array.isArray(entry),
        ),
    )
  )
    throw new Error("日麻快照 paipu 格式錯誤");
  return structuredClone(paipu);
};

const parseSnapshotArray = (value: unknown): string[][] => {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(
      (entry: unknown) =>
        Array.isArray(entry) &&
        entry.every(
          (piece: unknown): piece is string => typeof piece === "string",
        ),
    )
  )
    throw new Error("日麻快照牌河格式錯誤");
  return value.map((entry) => [...entry]);
};

const parseShanSnapshot = (value: unknown): RiichiShanSnapshot | null => {
  if (value === null) return null;
  const shan = recordOf(value);
  const fubaopai =
    shan.fubaopai === null ? null : stringArrayAt(shan, "fubaopai");
  return {
    pai: stringArrayAt(shan, "pai"),
    baopai: stringArrayAt(shan, "baopai"),
    fubaopai,
    weikaigang: booleanAt(shan, "weikaigang"),
    closed: booleanAt(shan, "closed"),
  };
};

const parseSnapshotModel = (value: unknown): RiichiModelSnapshot => {
  const model = recordOf(value);
  const board = recordOf(model.board);
  return {
    title: stringAt(model, "title"),
    player: stringArrayAt(model, "player", 4),
    qijia: integerAt(model, "qijia", 0),
    zhuangfeng: integerAt(model, "zhuangfeng", 0),
    jushu: integerAt(model, "jushu", 0),
    changbang: integerAt(model, "changbang", 0),
    lizhibang: integerAt(model, "lizhibang", 0),
    defen: integerArrayAt(model, "defen", 4),
    shan: parseShanSnapshot(model.shan),
    shoupai: stringArrayAt(model, "shoupai", 4),
    he: parseSnapshotArray(model.he),
    playerId: integerArrayAt(model, "playerId", 4),
    lunban: integerAt(model, "lunban"),
    board: {
      lizhi: booleanAt(board, "lizhi"),
      fenpei: nullableIntegerArrayAt(board, "fenpei", 4),
      lianzhuang: booleanAt(board, "lianzhuang"),
      changbang: integerAt(board, "changbang", 0),
      lizhibang: integerAt(board, "lizhibang", 0),
    },
  };
};

const parseSnapshotEngine = (value: unknown): RiichiEngineSnapshot => {
  const engine = recordOf(value);
  const replies = engine.reply;
  if (
    !Array.isArray(replies) ||
    replies.length !== 4 ||
    !replies.every(
      (reply: unknown) =>
        reply === null || (typeof reply === "object" && !Array.isArray(reply)),
    )
  )
    throw new Error("日麻快照回覆格式錯誤");
  return {
    status: nullableStringAt(engine, "status"),
    reply: replies.map((reply) =>
      reply === null ? null : (structuredClone(reply) as MajiangReply),
    ),
    paipu: parsePaipu(engine.paipu),
    diyizimo: booleanAt(engine, "diyizimo"),
    fengpai: booleanAt(engine, "fengpai"),
    dapai: nullableStringAt(engine, "dapai"),
    gang: nullableStringAt(engine, "gang"),
    lizhi: integerArrayAt(engine, "lizhi", 4),
    yifa: integerArrayAt(engine, "yifa", 4),
    nGang: integerArrayAt(engine, "nGang", 4),
    nengRong: booleanArrayAt(engine, "nengRong", 4),
    hule: integerArrayAt(engine, "hule"),
    huleOption: nullableStringAt(engine, "huleOption"),
    noGame: booleanAt(engine, "noGame"),
    lianzhuang: booleanAt(engine, "lianzhuang"),
    changbang: integerAt(engine, "changbang", 0),
    fenpei: nullableIntegerArrayAt(engine, "fenpei", 4),
    maxJushu: integerAt(engine, "maxJushu", 0),
    activeType: nullableStringAt(engine, "activeType"),
  };
};

export function parseRiichiSessionSnapshot(
  value: unknown,
): RiichiSessionSnapshot {
  const snapshot = recordOf(value);
  if (snapshot.version !== 1) throw new Error("不支援的日麻快照版本");
  const humans = integerArrayAt(snapshot, "humans");
  if (
    humans.some((id) => id < 0 || id > 3) ||
    new Set(humans).size !== humans.length
  )
    throw new Error("日麻快照真人座位格式錯誤");
  const rounds = integerAt(snapshot, "rounds", 0);
  if (![0, 1, 2].includes(rounds)) throw new Error("日麻快照場數格式錯誤");
  return {
    version: 1,
    humans,
    rounds,
    names: stringArrayAt(snapshot, "names", 4),
    revision: integerAt(snapshot, "revision", 0),
    started: booleanAt(snapshot, "started"),
    paused: booleanAt(snapshot, "paused"),
    done: booleanAt(snapshot, "done"),
    result: parseResult(snapshot.result),
    history: (() => {
      if (!Array.isArray(snapshot.history))
        throw new Error("日麻快照歷史格式錯誤");
      return snapshot.history.map((entry) => ({
        label: stringAt(recordOf(entry), "label"),
      }));
    })(),
    model: parseSnapshotModel(snapshot.model),
    engine: parseSnapshotEngine(snapshot.engine),
  };
}

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

const restoreShan = (
  game: RiichiCoreGame,
  snapshot: RiichiShanSnapshot,
): NonNullable<RiichiModel["shan"]> => {
  const shan = new Majiang.Shan(game._rule);
  Object.assign(shan as unknown as Record<string, unknown>, {
    _pai: [...snapshot.pai],
    _baopai: [...snapshot.baopai],
    _fubaopai: snapshot.fubaopai ? [...snapshot.fubaopai] : null,
    _weikaigang: snapshot.weikaigang,
    _closed: snapshot.closed,
  });
  return shan;
};

const restoreRiver = (pais: string[]): MajiangModel["he"][number] => {
  const river = new Majiang.He();
  const find: Record<string, boolean> = {};
  for (const pai of pais) {
    const normalized = pai.replace(/[+=-]$/, "");
    const suit = normalized[0];
    const number = normalized[1];
    if (!suit || !number) throw new Error("日麻快照牌河資料錯誤");
    find[suit + String(Number(number) || 5)] = true;
  }
  Object.assign(river as unknown as Record<string, unknown>, {
    _pai: [...pais],
    _find: find,
  });
  return river;
};

const playerWind = (id: number, qijia: number, jushu: number): number =>
  (id - qijia - jushu + 8) % 4;

const replayMessage = (
  type: string,
  data: Record<string, unknown>,
  id: number,
  qijia: number,
  jushu: number,
): MajiangMessage => {
  const replayed = structuredClone(data);
  if (type === "qipai") {
    const qipai = replayed;
    const hands = stringArrayAt(qipai, "shoupai", 4);
    const wind = playerWind(id, qijia, integerAt(qipai, "jushu", 0));
    return {
      qipai: {
        ...qipai,
        shoupai: hands.map((hand, index) => (index === wind ? hand : "")),
      },
    };
  }
  if (type === "zimo" || type === "gangzimo") {
    const zimo = replayed;
    const wind = integerAt(zimo, "l", 0);
    if (wind !== playerWind(id, qijia, jushu)) zimo.p = "";
    return { [type]: zimo };
  }
  return { [type]: replayed };
};

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
  activeType: string | null;
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
    this.activeType = null;
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
      this.activeType = type;
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

  static fromSnapshot(
    value: unknown,
    options: Omit<RiichiSessionOptions, "humans" | "rounds" | "names"> = {},
  ): RiichiSession {
    const snapshot = parseRiichiSessionSnapshot(value);
    const session = new RiichiSession({
      ...options,
      humans: snapshot.humans,
      rounds: snapshot.rounds,
      names: snapshot.names,
    });
    session.restore(snapshot);
    return session;
  }

  snapshot(): RiichiSessionSnapshot {
    if (!this.started) throw new Error("日麻尚未開始，沒有可保存的對局快照");
    if (this.queue.length)
      throw new Error("日麻快照不可在引擎佇列未清空時建立");
    const model = this.game.model;
    const shan = model.shan;
    const game = this.game;
    const modelRecord = model as unknown as Record<string, unknown>;
    return {
      version: 1,
      humans: [...this.humans],
      rounds: this.rounds,
      names: [...model.player],
      revision: this.revision,
      started: this.started,
      paused: this.paused,
      done: this.done,
      result: this.result ? structuredClone(this.result) : null,
      history: structuredClone(this.history),
      model: {
        title: model.title,
        player: [...model.player],
        qijia: model.qijia,
        zhuangfeng: model.zhuangfeng,
        jushu: model.jushu,
        changbang: model.changbang,
        lizhibang: model.lizhibang,
        defen: [...model.defen],
        shan: shan
          ? {
              pai: [...shan._pai],
              baopai: [...shan._baopai],
              fubaopai: shan._fubaopai ? [...shan._fubaopai] : null,
              weikaigang: shan._weikaigang,
              closed: shan._closed,
            }
          : null,
        shoupai: model.shoupai.map((hand) => hand.toString()),
        he: model.he.map((river) => [...river._pai]),
        playerId: [...model.player_id],
        lunban: model.lunban,
        board: {
          lizhi: Boolean(modelRecord._lizhi),
          fenpei: Array.isArray(modelRecord._fenpei)
            ? [...(modelRecord._fenpei as number[])]
            : null,
          lianzhuang: Boolean(modelRecord._lianzhuang),
          changbang:
            typeof modelRecord._changbang === "number"
              ? modelRecord._changbang
              : model.changbang,
          lizhibang:
            typeof modelRecord._lizhibang === "number"
              ? modelRecord._lizhibang
              : model.lizhibang,
        },
      },
      engine: {
        status: typeof game._status === "string" ? game._status : null,
        reply: Array.from(game._reply, (reply) =>
          reply === undefined ? null : structuredClone(reply),
        ),
        paipu:
          game._paipu && typeof game._paipu === "object"
            ? (structuredClone(game._paipu) as Record<string, unknown>)
            : null,
        diyizimo: game._diyizimo,
        fengpai: game._fengpai,
        dapai: game._dapai,
        gang: game._gang,
        lizhi: [...game._lizhi],
        yifa: [...game._yifa],
        nGang: [...game._n_gang],
        nengRong: game._neng_rong.map(Boolean),
        hule: [...game._hule],
        huleOption: game._hule_option,
        noGame: game._no_game,
        lianzhuang: game._lianzhuang,
        changbang: game._changbang,
        fenpei: game._fenpei ? [...game._fenpei] : null,
        maxJushu: game._max_jushu,
        activeType: this.activeType,
      },
    };
  }

  restore(value: unknown): void {
    if (this.started || this.revision)
      throw new Error("只能在新的日麻 session 上還原快照");
    const snapshot = parseRiichiSessionSnapshot(value);
    if (!snapshot.started)
      throw new Error("日麻快照尚未開始，無法還原進行中的 session");
    if (snapshot.humans.some((id) => !this.humans.has(id)))
      throw new Error("日麻快照真人座位與 session 設定不一致");
    if (this.rounds !== snapshot.rounds)
      throw new Error("日麻快照場數與 session 設定不一致");
    if (this.queue.length) this.queue.length = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();

    const model = this.game.model as unknown as Record<string, unknown>;
    const restoredModel = snapshot.model;
    Object.assign(model, {
      title: restoredModel.title,
      player: [...restoredModel.player],
      qijia: restoredModel.qijia,
      zhuangfeng: restoredModel.zhuangfeng,
      jushu: restoredModel.jushu,
      changbang: restoredModel.changbang,
      lizhibang: restoredModel.lizhibang,
      defen: [...restoredModel.defen],
      shan: restoredModel.shan
        ? restoreShan(this.game, restoredModel.shan)
        : null,
      shoupai: restoredModel.shoupai.map((paistr) =>
        Majiang.Shoupai.fromString(paistr),
      ),
      he: restoredModel.he.map((river) => restoreRiver(river)),
      player_id: [...restoredModel.playerId],
      lunban: restoredModel.lunban,
      _lizhi: restoredModel.board.lizhi,
      _fenpei: restoredModel.board.fenpei
        ? [...restoredModel.board.fenpei]
        : null,
      _lianzhuang: restoredModel.board.lianzhuang,
      _changbang: restoredModel.board.changbang,
      _lizhibang: restoredModel.board.lizhibang,
    });

    const engine = snapshot.engine;
    Object.assign(this.game as unknown as Record<string, unknown>, {
      _paipu: engine.paipu ? structuredClone(engine.paipu) : null,
      _status: engine.status ?? "",
      _reply: engine.reply.map((reply) =>
        reply === null ? undefined : structuredClone(reply),
      ),
      _diyizimo: engine.diyizimo,
      _fengpai: engine.fengpai,
      _dapai: engine.dapai,
      _gang: engine.gang,
      _lizhi: [...engine.lizhi],
      _yifa: [...engine.yifa],
      _n_gang: [...engine.nGang],
      _neng_rong: [...engine.nengRong],
      _hule: [...engine.hule],
      _hule_option: engine.huleOption,
      _no_game: engine.noGame,
      _lianzhuang: engine.lianzhuang,
      _changbang: engine.changbang,
      _fenpei: engine.fenpei ? [...engine.fenpei] : null,
      _max_jushu: engine.maxJushu,
      _timeout_id: undefined,
    });
    this.game._sync = true;
    this.activeType = engine.activeType;
    this.revision = snapshot.revision;
    this.result = snapshot.result ? structuredClone(snapshot.result) : null;
    this.history.splice(
      0,
      this.history.length,
      ...structuredClone(snapshot.history),
    );
    this.done = snapshot.done;
    this.closed = false;
    this.paused = snapshot.paused;
    this.started = true;
    this.rebuildBotState(snapshot);
    this.restorePending();
    this.schedule();
  }

  private rebuildBotState(snapshot: RiichiSessionSnapshot): void {
    const paipu = snapshot.engine.paipu;
    if (!paipu) return;
    const qijia = integerAt(paipu, "qijia", 0);
    const title = stringAt(paipu, "title");
    const player = stringArrayAt(paipu, "player", 4);
    const players = this.game._players;
    for (const id of players.keys()) {
      if (this.humans.has(id)) continue;
      const current = players[id];
      if (!current) continue;
      current.action(
        {
          kaiju: {
            id,
            rule: structuredClone(this.game._rule),
            title,
            player: [...player],
            qijia,
          },
        },
        () => {},
      );
    }
    const log = paipu.log;
    if (!Array.isArray(log)) throw new Error("日麻快照牌譜格式錯誤");
    const events: unknown[] = [];
    for (const round of log as unknown[]) {
      if (!Array.isArray(round)) throw new Error("日麻快照牌譜格式錯誤");
      events.push(...(round as unknown[]));
    }
    let jushu = 0;
    for (const entryValue of events) {
      const entry = recordOf(entryValue);
      const type = Object.keys(entry)[0];
      if (!type) throw new Error("日麻快照牌譜事件格式錯誤");
      const data = recordOf(entry[type]);
      if (type === "qipai") jushu = integerAt(data, "jushu", 0);
      for (const id of players.keys()) {
        if (this.humans.has(id)) continue;
        const current = players[id];
        if (!current) continue;
        current.action(replayMessage(type, data, id, qijia, jushu), () => {});
      }
    }
    if (snapshot.done)
      for (const id of players.keys()) {
        if (!this.humans.has(id)) {
          players[id]?.action({ jieju: paipu }, () => {});
        }
      }
  }

  private restorePending(): void {
    const type = this.activeType;
    if (!type || this.done) return;
    for (const id of this.humans) {
      const choices = riichiChoices(this.game, id, type);
      if (!choices.length) continue;
      this.pending.set(id, {
        callback: (reply) => {
          this.game.reply(id, reply);
        },
        choices: choices.map((current, index) => ({
          ...current,
          id: `${String(this.revision)}:${String(id)}:${String(index)}`,
        })),
      });
    }
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
