import { createClient, type InValue } from "@libsql/client";
import { updateAppListingAggregatesForIdsForTest } from "./app-directory.ts";
import type { DbClient } from "./db.ts";
import {
  bayesianAverageRating,
  blendRatingSignals,
  combineTrendingScore,
  decayedBayesianRating,
  favoriteVelocitySignal,
  mentionVolumeSignal,
  ratingSignalFromAverage,
  sumDecayedWeights,
  trendingFavoriteHalfLifeDays,
  trendingFavoriteVelocityBaselineDays,
  trendingFavoriteVelocityPrior,
  trendingFavoriteVelocityRecentDays,
  trendingFavoriteVelocitySquashK,
  trendingMentionHalfLifeDays,
  trendingRatingRecentBlendWeight,
  trendingRatingRecentHalfLifeDays,
} from "./app-trending.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("app interaction aggregates batch listings in two database statements", async () => {
  const db = createClient({ url: "file::memory:" });
  await db.execute(`CREATE TABLE app_listing (
    id TEXT PRIMARY KEY,
    review_count INTEGER,
    average_rating REAL,
    favorite_count INTEGER,
    mention_count_24h INTEGER,
    mention_count_7d INTEGER,
    trending_score REAL
  )`);
  await db.execute(`CREATE TABLE app_review (
    uri TEXT PRIMARY KEY,
    listing_id TEXT,
    rating INTEGER,
    created_at INTEGER,
    deleted_at INTEGER
  )`);
  await db.execute(`CREATE TABLE app_favorite (
    uri TEXT PRIMARY KEY,
    listing_id TEXT,
    created_at INTEGER,
    deleted_at INTEGER
  )`);
  await db.execute(`CREATE TABLE app_mention (
    uri TEXT PRIMARY KEY,
    listing_id TEXT,
    post_created_at INTEGER,
    deleted_at INTEGER
  )`);
  await db.execute(
    `CREATE INDEX app_review_listing ON app_review(listing_id, deleted_at, created_at)`,
  );
  await db.execute(
    `CREATE INDEX app_favorite_listing ON app_favorite(listing_id, deleted_at, created_at)`,
  );
  await db.execute(
    `CREATE INDEX app_mention_listing ON app_mention(listing_id, deleted_at, post_created_at)`,
  );

  const now = 1_800_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  await db.batch([
    {
      sql: `INSERT INTO app_listing VALUES (?, 99, 1, 99, 99, 99, 99)`,
      args: ["app-a"],
    },
    {
      sql: `INSERT INTO app_listing VALUES (?, 99, 1, 99, 99, 99, 99)`,
      args: ["app-b"],
    },
    {
      sql: `INSERT INTO app_review VALUES (?, ?, ?, ?, NULL)`,
      args: ["review-a-1", "app-a", 5, now - day],
    },
    {
      sql: `INSERT INTO app_review VALUES (?, ?, ?, ?, NULL)`,
      args: ["review-a-2", "app-a", 3, now - 2 * day],
    },
    {
      sql: `INSERT INTO app_review VALUES (?, ?, ?, ?, ?)`,
      args: ["review-a-deleted", "app-a", 1, now, now],
    },
    {
      sql: `INSERT INTO app_favorite VALUES (?, ?, ?, NULL)`,
      args: ["favorite-a-recent", "app-a", now - day],
    },
    {
      sql: `INSERT INTO app_favorite VALUES (?, ?, ?, NULL)`,
      args: ["favorite-a-old", "app-a", now - 90 * day],
    },
    {
      sql: `INSERT INTO app_favorite VALUES (?, ?, ?, ?)`,
      args: ["favorite-a-deleted", "app-a", now, now],
    },
    {
      sql: `INSERT INTO app_mention VALUES (?, ?, ?, NULL)`,
      args: ["mention-a-24h", "app-a", now - day + 1],
    },
    {
      sql: `INSERT INTO app_mention VALUES (?, ?, ?, NULL)`,
      args: ["mention-a-7d", "app-a", now - 5 * day],
    },
    {
      sql: `INSERT INTO app_mention VALUES (?, ?, ?, NULL)`,
      args: ["mention-a-old", "app-a", now - 10 * day],
    },
    {
      sql: `INSERT INTO app_mention VALUES (?, ?, ?, ?)`,
      args: ["mention-a-deleted", "app-a", now, now],
    },
  ]);

  let statements = 0;
  const capturedQueries: Array<{ sql: string; args?: unknown[] }> = [];
  const countingClient = {
    execute: (query: string | { sql: string; args?: unknown[] }) => {
      statements += 1;
      if (statements === 1 && typeof query !== "string") {
        capturedQueries.push(query);
      }
      return db.execute(query as Parameters<typeof db.execute>[0]);
    },
  } as unknown as DbClient;
  await updateAppListingAggregatesForIdsForTest(
    countingClient,
    ["app-a", "app-b", "app-a"],
    now,
  );

  assertEquals(statements, 2);
  const aggregateQuery = capturedQueries[0];
  if (!aggregateQuery) throw new Error("Expected one batched aggregate query");
  const plan = await db.execute({
    sql: `EXPLAIN QUERY PLAN ${aggregateQuery.sql}`,
    args: aggregateQuery.args as InValue[],
  });
  const planText = plan.rows.map((row) => String(row.detail ?? "")).join("\n");
  for (
    const index of [
      "app_review_listing",
      "app_favorite_listing",
      "app_mention_listing",
    ]
  ) {
    if (!planText.includes(index)) {
      throw new Error(`Aggregate query did not use ${index}:\n${planText}`);
    }
  }
  const ratingSignal = (reviewCount: number, averageRating: number | null) => {
    const allTime = ratingSignalFromAverage(
      bayesianAverageRating({ reviewCount, averageRating }),
    );
    const recent = reviewCount > 0
      ? ratingSignalFromAverage(decayedBayesianRating(
        [
          { rating: 5, createdAtMs: now - day },
          { rating: 3, createdAtMs: now - 2 * day },
        ],
        trendingRatingRecentHalfLifeDays(),
        now,
      ))
      : allTime;
    return blendRatingSignals(
      allTime,
      recent,
      trendingRatingRecentBlendWeight(),
    );
  };
  const velocitySignal = (recentCount: number, baselineCount: number) =>
    favoriteVelocitySignal({
      recentCount,
      baselineCount,
      recentDays: trendingFavoriteVelocityRecentDays(),
      baselineDays: trendingFavoriteVelocityBaselineDays(),
      prior: trendingFavoriteVelocityPrior(),
      squashK: trendingFavoriteVelocitySquashK(),
    });
  const expectedTrendingA = combineTrendingScore({
    decayedFavoriteWeight: sumDecayedWeights(
      [now - day],
      trendingFavoriteHalfLifeDays(),
      now,
    ),
    ratingSignal01: ratingSignal(2, 4),
    decayedMentionWeight: sumDecayedWeights(
      [now - day + 1, now - 5 * day, now - 10 * day],
      trendingMentionHalfLifeDays(),
      now,
    ),
    mentionVolume01: mentionVolumeSignal(2),
    favoriteVelocity01: velocitySignal(1, 1),
  });
  const expectedTrendingB = combineTrendingScore({
    decayedFavoriteWeight: 0,
    ratingSignal01: ratingSignal(0, null),
    decayedMentionWeight: 0,
    mentionVolume01: mentionVolumeSignal(0),
    favoriteVelocity01: velocitySignal(0, 0),
  });
  const rows = await db.execute(`SELECT * FROM app_listing ORDER BY id`);
  assertEquals(
    rows.rows.map((row) => ({
      id: String(row.id),
      reviewCount: Number(row.review_count),
      averageRating: row.average_rating == null
        ? null
        : Number(row.average_rating),
      favoriteCount: Number(row.favorite_count),
      mentionCount24h: Number(row.mention_count_24h),
      mentionCount7d: Number(row.mention_count_7d),
      trendingScore: Number(row.trending_score),
    })),
    [
      {
        id: "app-a",
        reviewCount: 2,
        averageRating: 4,
        favoriteCount: 2,
        mentionCount24h: 1,
        mentionCount7d: 2,
        trendingScore: expectedTrendingA,
      },
      {
        id: "app-b",
        reviewCount: 0,
        averageRating: null,
        favoriteCount: 0,
        mentionCount24h: 0,
        mentionCount7d: 0,
        trendingScore: expectedTrendingB,
      },
    ],
  );
  db.close();
});
