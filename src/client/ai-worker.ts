import { chooseMove, type Difficulty } from "./ai.js";
import type { BoardState, GameMove } from "../shared/game-types.js";

interface AiRequest {
  readonly id: number;
  readonly state: BoardState;
  readonly difficulty?: Difficulty;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent): void => {
  const data = event.data as AiRequest;
  try {
    const move: GameMove | null = chooseMove(data.state, data.difficulty);
    scope.postMessage({ id: data.id, move });
  } catch (error: unknown) {
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : "AI 執行失敗",
    });
  }
};
