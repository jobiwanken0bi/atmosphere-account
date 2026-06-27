import { ATSTORE_REPO_DID, ATSTORE_SOCIAL_REPO_DIDS } from "./env.ts";
import { findPdsEndpoint, resolveDidDocument } from "./identity.ts";
import { getRecordPublic, listRecordsPublic } from "./pds.ts";
import {
  ATSTORE_FAVORITE_NSID,
  ATSTORE_LISTING_NSID,
  ATSTORE_REVIEW_NSID,
  parseAtstoreFavorite,
  parseAtstoreListing,
  parseAtstoreReview,
} from "./app-lexicons.ts";
import {
  rescoreAppDirectoryTrending,
  upsertAppFavorite,
  upsertAppRecordFromDraft,
  upsertAppReview,
} from "./app-directory.ts";
import {
  type AppRecordFailure,
  clearAppRecordFailure,
  recordAppRecordFailure,
} from "./app-directory-failures.ts";

export interface AtstoreBackfillCounts {
  recordsSeen: number;
  listingsImported: number;
  reviewsImported: number;
  favoritesImported: number;
  recordsFailed: number;
  rescored: number;
}

export interface AtstoreBackfillProgress {
  phase: string;
  counts: AtstoreBackfillCounts;
}

export type AtstoreBackfillProgressHandler = (
  progress: AtstoreBackfillProgress,
) => void | Promise<void>;

export interface AtstoreRetryResult {
  ok: boolean;
  kind: "listing" | "review" | "favorite" | "unknown";
  reason?: string;
}

const emptyCounts = (): AtstoreBackfillCounts => ({
  recordsSeen: 0,
  listingsImported: 0,
  reviewsImported: 0,
  favoritesImported: 0,
  recordsFailed: 0,
  rescored: 0,
});

export async function backfillAtstoreListings(
  options: { repos?: string[]; onProgress?: AtstoreBackfillProgressHandler } =
    {},
): Promise<AtstoreBackfillCounts> {
  const counts = emptyCounts();
  const repos = uniqueStrings([...(options.repos ?? []), ATSTORE_REPO_DID]);
  if (repos.length === 0) {
    throw new Error("No ATStore listing repo configured.");
  }
  for (const repoDid of repos) {
    await emitProgress(
      options.onProgress,
      `Backfilling listings from ${repoDid}`,
      counts,
    );
    await backfillCollection(repoDid, ATSTORE_LISTING_NSID, async (record) => {
      counts.recordsSeen += 1;
      const imported = await importAtstoreListingRecord(record);
      if (imported) counts.listingsImported += 1;
      else counts.recordsFailed += 1;
      return imported;
    });
  }
  await emitProgress(options.onProgress, "Listing backfill complete", counts);
  return counts;
}

export async function backfillAtstoreReviewsAndFavorites(
  options: {
    listingRepos?: string[];
    socialRepos?: string[];
    onProgress?: AtstoreBackfillProgressHandler;
  } = {},
): Promise<AtstoreBackfillCounts> {
  const counts = emptyCounts();
  const listingRepos = uniqueStrings([
    ...(options.listingRepos ?? []),
    ATSTORE_REPO_DID,
  ]);
  const configuredSocialRepos = uniqueStrings([
    ...(options.socialRepos ?? []),
    ...ATSTORE_SOCIAL_REPO_DIDS,
  ]);
  const repos = uniqueStrings([...listingRepos, ...configuredSocialRepos]);
  if (repos.length === 0) {
    throw new Error("No ATStore social or listing repos configured.");
  }
  for (const repoDid of repos) {
    await emitProgress(
      options.onProgress,
      `Backfilling reviews from ${repoDid}`,
      counts,
    );
    await backfillCollection(
      repoDid,
      ATSTORE_REVIEW_NSID,
      async (record) => {
        counts.recordsSeen += 1;
        const imported = await importAtstoreReviewRecord(record);
        if (imported) counts.reviewsImported += 1;
        else counts.recordsFailed += 1;
        return imported;
      },
    );

    await emitProgress(
      options.onProgress,
      `Backfilling favorites from ${repoDid}`,
      counts,
    );
    await backfillCollection(
      repoDid,
      ATSTORE_FAVORITE_NSID,
      async (record) => {
        counts.recordsSeen += 1;
        const imported = await importAtstoreFavoriteRecord(record);
        if (imported) counts.favoritesImported += 1;
        else counts.recordsFailed += 1;
        return imported;
      },
    );
  }
  await emitProgress(
    options.onProgress,
    "Review/favorite backfill complete",
    counts,
  );
  return counts;
}

export async function rescoreAtstoreDirectory(
  options: { onProgress?: AtstoreBackfillProgressHandler } = {},
): Promise<AtstoreBackfillCounts> {
  const counts = emptyCounts();
  await emitProgress(options.onProgress, "Rescoring trending", counts);
  counts.rescored = await rescoreAppDirectoryTrending();
  await emitProgress(options.onProgress, "Trending rescore complete", counts);
  return counts;
}

export async function retryAppRecordFailure(
  failure: AppRecordFailure,
): Promise<AtstoreRetryResult> {
  const fetched = await fetchFailureRecord(failure);
  if (!fetched) {
    await recordAppRecordFailure({
      uri: failure.uri,
      collection: failure.collection,
      sourceType: failure.sourceType,
      repoDid: failure.repoDid,
      rkey: failure.rkey,
      reason: "record_not_found",
    });
    return { ok: false, kind: "unknown", reason: "record_not_found" };
  }

  if (failure.collection === ATSTORE_LISTING_NSID) {
    const ok = await importAtstoreListingRecord(fetched);
    return ok
      ? { ok: true, kind: "listing" }
      : { ok: false, kind: "listing", reason: "invalid_atstore_listing" };
  }
  if (failure.collection === ATSTORE_REVIEW_NSID) {
    const ok = await importAtstoreReviewRecord(fetched);
    return ok
      ? { ok: true, kind: "review" }
      : { ok: false, kind: "review", reason: "invalid_atstore_review" };
  }
  if (failure.collection === ATSTORE_FAVORITE_NSID) {
    const ok = await importAtstoreFavoriteRecord(fetched);
    return ok
      ? { ok: true, kind: "favorite" }
      : { ok: false, kind: "favorite", reason: "invalid_atstore_favorite" };
  }
  return {
    ok: false,
    kind: "unknown",
    reason: `Unsupported collection: ${failure.collection}`,
  };
}

async function backfillCollection(
  repoDid: string,
  collection: string,
  onRecord: (input: AtstoreRecordInput) => Promise<boolean>,
): Promise<void> {
  const pdsUrl = findPdsEndpoint(await resolveDidDocument(repoDid));
  let cursor: string | undefined;
  do {
    const page = await listRecordsPublic(
      pdsUrl,
      repoDid,
      collection,
      { limit: 100, cursor },
    );
    for (const record of page.records) {
      const rkey = record.uri.split("/").at(-1) ?? "";
      const uri = record.uri || atUri(repoDid, collection, rkey);
      await onRecord({
        uri,
        cid: record.cid,
        repoDid,
        rkey,
        value: record.value,
      });
    }
    cursor = page.cursor;
  } while (cursor);
}

async function fetchFailureRecord(
  failure: AppRecordFailure,
): Promise<AtstoreRecordInput | null> {
  const pdsUrl = findPdsEndpoint(await resolveDidDocument(failure.repoDid));
  const fetched = await getRecordPublic(
    pdsUrl,
    failure.repoDid,
    failure.collection,
    failure.rkey,
  );
  if (!fetched) return null;
  return {
    uri: fetched.uri || failure.uri,
    cid: fetched.cid,
    repoDid: failure.repoDid,
    rkey: failure.rkey,
    value: fetched.value,
  };
}

interface AtstoreRecordInput {
  uri: string;
  cid: string;
  repoDid: string;
  rkey: string;
  value: unknown;
}

async function importAtstoreListingRecord(
  record: AtstoreRecordInput,
): Promise<boolean> {
  const draft = parseAtstoreListing(record);
  if (!draft) {
    await recordAppRecordFailure({
      uri: record.uri,
      collection: ATSTORE_LISTING_NSID,
      sourceType: "atstore_listing",
      repoDid: record.repoDid,
      rkey: record.rkey,
      reason: "invalid_atstore_listing",
    });
    return false;
  }
  await upsertAppRecordFromDraft({ draft, rawRecord: record.value });
  await clearAppRecordFailure(record.uri);
  return true;
}

async function importAtstoreReviewRecord(
  record: AtstoreRecordInput,
): Promise<boolean> {
  const draft = parseAtstoreReview(record);
  if (!draft) {
    await recordAppRecordFailure({
      uri: record.uri,
      collection: ATSTORE_REVIEW_NSID,
      sourceType: "atstore_review",
      repoDid: record.repoDid,
      rkey: record.rkey,
      reason: "invalid_atstore_review",
    });
    return false;
  }
  await upsertAppReview(draft);
  await clearAppRecordFailure(record.uri);
  return true;
}

async function importAtstoreFavoriteRecord(
  record: AtstoreRecordInput,
): Promise<boolean> {
  const draft = parseAtstoreFavorite(record);
  if (!draft) {
    await recordAppRecordFailure({
      uri: record.uri,
      collection: ATSTORE_FAVORITE_NSID,
      sourceType: "atstore_favorite",
      repoDid: record.repoDid,
      rkey: record.rkey,
      reason: "invalid_atstore_favorite",
    });
    return false;
  }
  await upsertAppFavorite(draft);
  await clearAppRecordFailure(record.uri);
  return true;
}

function atUri(did: string, collection: string, rkey: string): string {
  return `at://${did}/${collection}/${rkey}`;
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = value?.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

async function emitProgress(
  onProgress: AtstoreBackfillProgressHandler | undefined,
  phase: string,
  counts: AtstoreBackfillCounts,
): Promise<void> {
  if (!onProgress) return;
  await onProgress({ phase, counts: { ...counts } });
}
