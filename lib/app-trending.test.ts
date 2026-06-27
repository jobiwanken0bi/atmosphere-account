import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bayesianAverageRating,
  combineTrendingScore,
  decayedBayesianRating,
  decayFactorForAgeMs,
  favoriteVelocitySignal,
  mentionVolumeSignal,
  ratingSignalFromAverage,
} from "./app-trending.ts";

Deno.test("decayFactorForAgeMs halves at the configured half-life", () => {
  const halfLifeDays = 10;
  const ageMs = halfLifeDays * 24 * 60 * 60 * 1000;
  assertEquals(decayFactorForAgeMs(ageMs, halfLifeDays), 0.5);
});

Deno.test("bayesianAverageRating shrinks low-N ratings toward the ATStore prior", () => {
  assertEquals(
    bayesianAverageRating({ reviewCount: 0, averageRating: null }),
    3.25,
  );
  assertEquals(
    bayesianAverageRating({ reviewCount: 1, averageRating: 5 }),
    3.6,
  );
});

Deno.test("decayedBayesianRating weights newer reviews more heavily", () => {
  const now = Date.UTC(2026, 0, 31);
  const recent = now - 1 * 24 * 60 * 60 * 1000;
  const old = now - 30 * 24 * 60 * 60 * 1000;
  const score = decayedBayesianRating(
    [
      { rating: 5, createdAtMs: recent },
      { rating: 1, createdAtMs: old },
    ],
    30,
    now,
  );
  assert(score > 3.25);
});

Deno.test("favoriteVelocitySignal is normalized to a bounded trend signal", () => {
  const score = favoriteVelocitySignal({
    recentCount: 6,
    baselineCount: 10,
    recentDays: 3,
    baselineDays: 30,
    prior: 1,
    squashK: 4,
  });
  assert(score > 0);
  assert(score <= 1);
});

Deno.test("combineTrendingScore matches ATStore's normalized 0-100 scale", () => {
  const ratingSignal01 = ratingSignalFromAverage(4.25);
  const score = combineTrendingScore({
    decayedFavoriteWeight: 25,
    ratingSignal01,
    decayedMentionWeight: 35,
    mentionVolume01: mentionVolumeSignal(50),
    favoriteVelocity01: 1,
  });
  assertEquals(score, 93.4);
});
