import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateElo,
  ESTABLISHED_K_FACTOR,
  PROVISIONAL_K_FACTOR,
} from "../src/server/rating.js";

void test("ELO gives equal provisional players symmetric changes", () => {
  const winner = calculateElo({
    rating: 1500,
    opponentRating: 1500,
    gamesPlayed: 0,
    result: "win",
  });
  const loser = calculateElo({
    rating: 1500,
    opponentRating: 1500,
    gamesPlayed: 0,
    result: "loss",
  });
  assert.equal(winner.kFactor, PROVISIONAL_K_FACTOR);
  assert.equal(winner.ratingAfter, 1520);
  assert.equal(loser.ratingAfter, 1480);
  assert.equal(winner.ratingDelta + loser.ratingDelta, 0);
  assert.equal(winner.provisional, true);
});

void test("ELO uses the established K factor after provisional games", () => {
  const result = calculateElo({
    rating: 1600,
    opponentRating: 1400,
    gamesPlayed: 10,
    result: "loss",
  });
  assert.equal(result.kFactor, ESTABLISHED_K_FACTOR);
  assert.equal(result.ratingDelta, -15);
  assert.equal(result.gamesAfter, 11);
  assert.equal(result.provisional, false);
});

void test("ELO draw uses half a point", () => {
  const result = calculateElo({
    rating: 1600,
    opponentRating: 1400,
    gamesPlayed: 0,
    result: "draw",
  });
  assert.equal(result.ratingDelta, -10);
});
