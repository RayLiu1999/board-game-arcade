export const RATING_VERSION = 1;
export const INITIAL_RATING = 1500;
export const PROVISIONAL_MATCHES = 10;
export const PROVISIONAL_K_FACTOR = 40;
export const ESTABLISHED_K_FACTOR = 20;

export type RatingResult = "win" | "loss" | "draw";

export interface EloCalculationInput {
  readonly rating: number;
  readonly opponentRating: number;
  readonly gamesPlayed: number;
  readonly result: RatingResult;
}

export interface EloCalculation {
  readonly ratingBefore: number;
  readonly ratingAfter: number;
  readonly ratingDelta: number;
  readonly gamesBefore: number;
  readonly gamesAfter: number;
  readonly kFactor: number;
  readonly expectedScore: number;
  readonly provisional: boolean;
}

const validateRating = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label}格式錯誤`);
  return value;
};

const validateGames = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("評分對局數格式錯誤");
  return value;
};

const scoreForResult = (result: RatingResult): number => {
  if (result === "win") return 1;
  if (result === "draw") return 0.5;
  return 0;
};

export const calculateElo = (input: EloCalculationInput): EloCalculation => {
  const rating = validateRating(input.rating, "目前評分");
  const opponentRating = validateRating(input.opponentRating, "對手評分");
  const gamesPlayed = validateGames(input.gamesPlayed);
  const kFactor =
    gamesPlayed < PROVISIONAL_MATCHES
      ? PROVISIONAL_K_FACTOR
      : ESTABLISHED_K_FACTOR;
  const expectedScore = 1 / (1 + 10 ** ((opponentRating - rating) / 400));
  const ratingDelta = Math.round(
    kFactor * (scoreForResult(input.result) - expectedScore),
  );
  const gamesAfter = gamesPlayed + 1;
  return {
    ratingBefore: rating,
    ratingAfter: rating + ratingDelta,
    ratingDelta,
    gamesBefore: gamesPlayed,
    gamesAfter,
    kFactor,
    expectedScore,
    provisional: gamesAfter < PROVISIONAL_MATCHES,
  };
};
