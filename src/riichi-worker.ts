import { RiichiSession } from "../lib/riichi-session.js";

type RiichiMode = "ai" | "local";

interface StartMessage {
  readonly type: "start";
  readonly mode: RiichiMode;
  readonly rounds: number;
}

interface ActionMessage {
  readonly type: "action";
  readonly id: string;
}

type WorkerMessage =
  | StartMessage
  | ActionMessage
  | { readonly type: "ready" }
  | { readonly type: "close" };

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
}

type UnknownRecord = Record<string, unknown>;

interface GlobalScope extends WorkerScope {
  self?: WorkerScope;
}

const globalScope = globalThis as unknown as GlobalScope;
const scope = globalScope.self ?? globalScope;
let session: RiichiSession | null = null;
let seat = 0;
let mode: RiichiMode = "ai";
let handoff: number | null = null;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const parseMessage = (value: unknown): WorkerMessage => {
  if (!isRecord(value) || typeof value.type !== "string")
    throw new Error("日麻 Worker 訊息格式錯誤");
  if (value.type === "start") {
    if (
      (value.mode !== "ai" && value.mode !== "local") ||
      typeof value.rounds !== "number" ||
      !Number.isInteger(value.rounds)
    )
      throw new Error("日麻 Worker 開局訊息格式錯誤");
    return { type: "start", mode: value.mode, rounds: value.rounds };
  }
  if (value.type === "action") {
    if (typeof value.id !== "string")
      throw new Error("日麻 Worker 操作訊息格式錯誤");
    return { type: "action", id: value.id };
  }
  if (value.type === "ready" || value.type === "close") return { type: value.type };
  throw new Error("未知日麻 Worker 操作");
};

const publish = (): void => {
  if (!session) return;
  if (mode === "local" && session.pending.size && !session.pending.has(seat)) {
    seat = [...session.pending.keys()][0] ?? seat;
    handoff = seat;
  }
  scope.postMessage({ type: "state", state: session.view(seat), handoff });
};

scope.onmessage = (event: MessageEvent): void => {
  try {
    const message = parseMessage(event.data as unknown);
    if (message.type === "start") {
      session?.close();
      mode = message.mode;
      seat = 0;
      handoff = mode === "local" ? 0 : null;
      const nextSession = new RiichiSession({
        humans: mode === "local" ? [0, 1, 2, 3] : [0],
        rounds: message.rounds,
        names:
          mode === "local"
            ? ["玩家 1", "玩家 2", "玩家 3", "玩家 4"]
            : ["你", "AI 南", "AI 西", "AI 北"],
        onChange: publish,
        onError: (error: unknown) => {
          scope.postMessage({
            type: "error",
            message: error instanceof Error ? error.message : "日麻執行失敗",
          });
        },
      });
      session = nextSession;
      nextSession.start();
    } else if (message.type === "action") {
      if (!session) throw new Error("日麻尚未開局");
      session.act(seat, message.id);
    }
    else if (message.type === "ready") {
      handoff = null;
      publish();
    } else {
      session?.close();
      session = null;
    }
  } catch (error: unknown) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "日麻執行失敗",
    });
  }
};
