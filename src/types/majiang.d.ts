declare module "@kobalab/majiang-core" {
  export interface MajiangShoupai {
    readonly _zimo?: string;
    readonly _fulou?: string[];
    readonly lizhi?: boolean;
    toString(): string;
  }

  export interface MajiangHe {
    readonly _pai: string[];
  }

  export interface MajiangShan {
    readonly _pai: string[];
    readonly _baopai: string[];
    readonly _fubaopai: string[] | null;
    readonly _weikaigang: boolean;
    readonly _closed: boolean;
    readonly baopai: string[];
    readonly paishu: number;
  }

  export interface MajiangModel {
    title: string;
    player: string[];
    qijia: number;
    readonly player_id: number[];
    readonly defen: number[];
    readonly shan: MajiangShan | null;
    readonly shoupai: MajiangShoupai[];
    readonly he: MajiangHe[];
    lunban: number;
    readonly zhuangfeng: number;
    readonly jushu: number;
    readonly changbang: number;
    readonly lizhibang: number;
    readonly _lizhi?: boolean;
    readonly _fenpei?: number[] | null;
    readonly _lianzhuang?: boolean;
    readonly _changbang?: number;
    readonly _lizhibang?: number;
  }

  export interface MajiangReply {
    readonly [key: string]: unknown;
  }

  export interface MajiangMessageData {
    readonly [key: string]: unknown;
  }

  export type MajiangMessage = Record<string, MajiangMessageData>;

  export interface MajiangPlayer {
    action(
      message: MajiangMessage,
      callback?: (reply: MajiangReply) => void,
    ): void;
  }

  export interface MajiangGame {
    readonly _players: MajiangPlayer[];
    readonly _rule: MajiangRule;
    _paipu: unknown;
    readonly model: MajiangModel;
    _sync: boolean;
    _status: string;
    _reply: Array<MajiangReply | undefined>;
    _diyizimo: boolean;
    _fengpai: boolean;
    _dapai: string | null;
    _neng_rong: boolean[];
    _gang: string | null;
    _lizhi: number[];
    _yifa: number[];
    _n_gang: number[];
    _hule: number[];
    _hule_option: string | null;
    _no_game: boolean;
    _lianzhuang: boolean;
    _changbang: number;
    _fenpei: number[] | null;
    _max_jushu: number;
    last?: () => void;
    delay(callback: () => void, timeout?: number): void;
    call_players(type: string, messages: MajiangMessage[]): void;
    reply(id: number, reply: MajiangReply): void;
    next(): void;
    kaiju(qijia?: number): void;
    jieju(): void;
    allow_hule(id?: number): boolean;
    allow_lizhi(tile: string): boolean;
    allow_pingju(): boolean;
    get_dapai(): string[];
    get_gang_mianzi(id?: number): string[];
    get_peng_mianzi(id: number): string[];
    get_chi_mianzi(id: number): string[];
    hule(): void;
  }

  interface MajiangRule {
    readonly [key: string]: unknown;
  }

  interface MajiangNamespace {
    readonly Game: new (
      players: MajiangPlayer[],
      callback: (paipu: unknown) => void,
      rule: MajiangRule,
      title: string,
    ) => MajiangGame;
    rule(options: Record<string, number>): MajiangRule;
    Shan: new (rule: MajiangRule) => MajiangShan;
    He: new () => MajiangHe;
    Shoupai: {
      fromString(value: string): MajiangShoupai;
    };
  }

  const Majiang: MajiangNamespace;
  export default Majiang;
}

declare module "@kobalab/majiang-ai" {
  import type {
    MajiangMessage,
    MajiangPlayer,
    MajiangReply,
  } from "@kobalab/majiang-core";

  const MahjongAI: new () => MajiangPlayer & {
    action(
      message: MajiangMessage,
      callback?: (reply: MajiangReply) => void,
    ): void;
  };
  export default MahjongAI;
}
