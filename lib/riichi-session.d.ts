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
  rank: number[];
  [key: string]: unknown;
}

export class RiichiSession {
  constructor(options?: RiichiSessionOptions);
  readonly pending: ReadonlyMap<number, unknown>;
  readonly revision: number;
  readonly done: boolean;
  readonly result: RiichiResult | null;
  start(): void;
  act(id: number, actionId: string): void;
  pause(value?: boolean): void;
  close(): void;
  view(id: number): unknown;
}
