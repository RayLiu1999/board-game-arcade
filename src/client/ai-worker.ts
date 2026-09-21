import { chooseMove, createSeededRandom, type Difficulty } from "./ai.js";
import type { BoardState, GameMove } from "../shared/game-types.js";

interface AiRequest {
  readonly id: number;
  readonly state: BoardState;
  readonly difficulty?: Difficulty;
  readonly seed?: number;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
}

interface GlobalScope extends WorkerScope {
  self?: WorkerScope;
}

const globalScope = globalThis as unknown as GlobalScope;
const scope = globalScope.self ?? globalScope;

scope.onmessage = (event: MessageEvent): void => {
  const data = event.data as AiRequest;
  try {
    const random =
      data.seed === undefined ? undefined : createSeededRandom(data.seed);
    const move: GameMove | null = chooseMove(
      data.state,
      data.difficulty,
      random,
    );
    scope.postMessage({ id: data.id, move });
  } catch (error: unknown) {
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : "AI 執行失敗",
    });
  }
};
