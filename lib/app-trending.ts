const MS_PER_DAY = 24 * 60 * 60 * 1000;

function envFloat(key: string, fallback: number): number {
  let raw: string | undefined;
  try {
    raw = Deno.env.get(key)?.trim();
  } catch {
    raw = undefined;
  }
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envInt(key: string, fallback: number): number {
  let raw: string | undefined;
  try {
    raw = Deno.env.get(key)?.trim();
  } catch {
    raw = undefined;
  }
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function trendingWeights() {
  return {
    favorite: envFloat("TRENDING_WEIGHT_FAVORITE", 0.35),
    rating: envFloat("TRENDING_WEIGHT_RATING", 0.35),
    mention: envFloat("TRENDING_WEIGHT_MENTION", 0.3),
  };
}

export function trendingFavoriteHalfLifeDays(): number {
  return envFloat("TRENDING_FAVORITE_HALF_LIFE_DAYS", 10);
}

export function trendingMentionHalfLifeDays(): number {
  return envFloat("TRENDING_MENTION_HALF_LIFE_DAYS", 7);
}

export function trendingRatingPriorMean(): number {
  return envFloat("TRENDING_RATING_PRIOR_MEAN", 3.25);
}

export function trendingRatingPriorWeight(): number {
  return envFloat("TRENDING_RATING_PRIOR_WEIGHT", 4);
}

export function trendingDecayWindowDays(): number {
  return envInt("TRENDING_DECAY_WINDOW_DAYS", 90);
}

export function trendingRatingRecentHalfLifeDays(): number {
  return envFloat("TRENDING_RATING_RECENT_HALF_LIFE_DAYS", 30);
}

export function trendingRatingRecentBlendWeight(): number {
  const w = envFloat("TRENDING_RATING_RECENT_WEIGHT", 0.5);
  return Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0.5;
}

export function trendingFavoriteVelocityRecentDays(): number {
  return envFloat("TRENDING_FAVORITE_VELOCITY_RECENT_DAYS", 3);
}

export function trendingFavoriteVelocityBaselineDays(): number {
  return envFloat("TRENDING_FAVORITE_VELOCITY_BASELINE_DAYS", 30);
}

export function trendingFavoriteVelocityPrior(): number {
  return envFloat("TRENDING_FAVORITE_VELOCITY_PRIOR", 1);
}

export function trendingFavoriteVelocitySubweight(): number {
  const w = envFloat("TRENDING_FAVORITE_VELOCITY_SUBWEIGHT", 0.2);
  return Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0.2;
}

export function trendingFavoriteVelocitySquashK(): number {
  const k = envFloat("TRENDING_FAVORITE_VELOCITY_SQUASH_K", 4);
  return k > 0 ? k : 4;
}

export function daysToMs(days: number): number {
  return days * MS_PER_DAY;
}

export function decayFactorForAgeMs(
  ageMs: number,
  halfLifeDays: number,
): number {
  if (ageMs <= 0) return 1;
  if (
    !Number.isFinite(ageMs) ||
    !Number.isFinite(halfLifeDays) ||
    halfLifeDays <= 0
  ) {
    return 0;
  }
  return Math.pow(2, -ageMs / daysToMs(halfLifeDays));
}

export function bayesianAverageRating(input: {
  reviewCount: number;
  averageRating: number | null;
}): number {
  const n = input.reviewCount;
  const prior = trendingRatingPriorMean();
  const w = trendingRatingPriorWeight();
  if (
    n <= 0 ||
    input.averageRating == null ||
    Number.isNaN(input.averageRating)
  ) {
    return prior;
  }
  return (input.averageRating * n + prior * w) / (n + w);
}

export function ratingSignalFromAverage(mean15: number): number {
  const clamped = Math.min(5, Math.max(1, mean15));
  return (clamped - 1) / 4;
}

export function decayedBayesianRating(
  reviews: ReadonlyArray<{ rating: number; createdAtMs: number }>,
  halfLifeDays: number,
  nowMs = Date.now(),
): number {
  const prior = trendingRatingPriorMean();
  const w = trendingRatingPriorWeight();
  let weightSum = 0;
  let weightedRatingSum = 0;
  for (const review of reviews) {
    if (
      !Number.isFinite(review.rating) ||
      !Number.isFinite(review.createdAtMs) ||
      review.rating < 1 ||
      review.rating > 5
    ) {
      continue;
    }
    const decay = decayFactorForAgeMs(nowMs - review.createdAtMs, halfLifeDays);
    if (decay <= 0) continue;
    weightSum += decay;
    weightedRatingSum += decay * review.rating;
  }
  if (weightSum <= 0) return prior;
  return (weightedRatingSum + prior * w) / (weightSum + w);
}

export function blendRatingSignals(
  allTime01: number,
  recent01: number,
  recentWeight: number,
): number {
  const rw = Math.min(1, Math.max(0, recentWeight));
  return (1 - rw) * allTime01 + rw * recent01;
}

export function favoriteVelocitySignal(input: {
  recentCount: number;
  baselineCount: number;
  recentDays: number;
  baselineDays: number;
  prior: number;
  squashK: number;
}): number {
  const recentDays = Math.max(0.0001, input.recentDays);
  const baselineDays = Math.max(0.0001, input.baselineDays);
  const recentRate = Math.max(0, input.recentCount) / recentDays;
  const baselineRate = Math.max(0, input.baselineCount) / baselineDays;
  const prior = Math.max(0, input.prior);
  const k = Math.max(0.0001, input.squashK);
  const ratio = recentRate / (baselineRate + prior);
  const sig = Math.log1p(Math.max(0, ratio)) / Math.log1p(k);
  return Math.min(1, Math.max(0, sig));
}

export function mentionVolumeSignal(mentionCount7d: number): number {
  return Math.log1p(Math.max(0, mentionCount7d)) / Math.log1p(50);
}

export function sumDecayedWeights(
  timestampsMs: ReadonlyArray<number>,
  halfLifeDays: number,
  nowMs = Date.now(),
): number {
  let sum = 0;
  for (const timestamp of timestampsMs) {
    if (!Number.isFinite(timestamp)) continue;
    sum += decayFactorForAgeMs(nowMs - timestamp, halfLifeDays);
  }
  return sum;
}

export function combineTrendingScore(parts: {
  decayedFavoriteWeight: number;
  ratingSignal01: number;
  decayedMentionWeight: number;
  mentionVolume01: number;
  favoriteVelocity01?: number;
}): number {
  const w = trendingWeights();
  const sumW = w.favorite + w.rating + w.mention;
  const norm = sumW > 0 ? sumW : 1;
  const fav01 = Math.min(1, parts.decayedFavoriteWeight / 25);
  const men01 = Math.min(1, parts.decayedMentionWeight / 35);
  const vol = Math.min(1, parts.mentionVolume01);
  const favVel = Math.min(1, Math.max(0, parts.favoriteVelocity01 ?? 0));
  const velSub = trendingFavoriteVelocitySubweight();
  const favTerm = (1 - velSub) * fav01 + velSub * favVel;
  const combined = (w.favorite * favTerm +
    w.rating * parts.ratingSignal01 +
    w.mention * (0.75 * men01 + 0.25 * vol)) /
    norm;
  return Math.round(combined * 1000) / 10;
}
