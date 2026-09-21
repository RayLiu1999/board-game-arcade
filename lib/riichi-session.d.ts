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
  readonly rank: number[];
  readonly scores: number[];
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

export interface RiichiShoupai {
  readonly _zimo?: string;
  readonly _fulou?: string[];
  readonly lizhi?: boolean;
  toString(): string;
}

export interface RiichiModel {
  readonly shoupai: RiichiShoupai[];
  readonly player_id: number[];
  readonly player: string[];
  readonly defen: number[];
  readonly he: Array<{ readonly _pai: string[] }>;
  readonly shan: {
    readonly _baopai: string[];
    readonly baopai?: string[];
    readonly paishu?: number;
  };
  lunban: number;
}

export interface RiichiCoreGame {
  readonly model: RiichiModel;
  _diyizimo: boolean;
  _dapai?: string;
  _neng_rong: boolean[];
  _gang?: string | null;
  allow_hule(id?: number): boolean;
  allow_lizhi(tile: string): boolean;
  allow_pingju(): boolean;
  get_dapai(): string[];
  get_gang_mianzi(id?: number): string[];
  get_peng_mianzi(id: number): string[];
  get_chi_mianzi(id: number): string[];
  hule(): void;
}

export class RiichiSession {
  constructor(options?: RiichiSessionOptions);
  readonly game: RiichiCoreGame;
  readonly pending: ReadonlyMap<number, { readonly choices: RiichiChoice[] }>;
  readonly revision: number;
  readonly paused: boolean;
  readonly done: boolean;
  readonly result: RiichiResult | null;
  start(): void;
  step(): boolean;
  act(id: number, actionId: string): void;
  pause(value?: boolean): void;
  close(): void;
  view(id: number): RiichiView;
}

export const WINDS: readonly string[];
export function tileName(piece: string | undefined): string;
export function handTiles(hand: RiichiShoupai | undefined): string[];
export function riichiChoices(
  game: RiichiCoreGame,
  id: number,
  type: string,
): RiichiChoice[];
