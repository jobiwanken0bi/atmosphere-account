/**
 * Atmosphere registry indexer.
 *
 * Long-running Deno process that subscribes to Bluesky's Jetstream WebSocket
 * filtered to our registry collections, fetches the authoritative record
 * from each author's PDS, validates it, and upserts (or deletes) the row in
 * the Turso registry DB. Cursor is persisted in the DB so the worker can
 * resume after restarts.
 *
 * Run locally:
 *   TURSO_DATABASE_URL=file:./local.db deno task indexer
 *
 * Run on Fly.io: see worker.Dockerfile + fly.indexer.toml.
 */
import {
  FEATURED_NSID,
  HOST_PROFILE_NSID,
  HOST_SERVICE_NSID,
  PROFILE_NSID,
  REVIEW_NSID,
  UPDATE_NSID,
  validateFeatured,
  validateReview,
  validateUpdate,
} from "../lib/lexicons.ts";
import {
  deleteProfile,
  getJetstreamCursor,
  getProfileByDid,
  replaceFeatured,
  setJetstreamCursor,
} from "../lib/registry.ts";
import {
  createOrUpdateReview,
  markReviewRemovedByRkey,
  reviewUriForRkey,
} from "../lib/reviews.ts";
import {
  markProfileUpdateRemovedByRkey,
  updateUriForRkey,
  upsertProfileUpdate,
} from "../lib/profile-updates.ts";
import { findPdsEndpoint, resolveDidDocument } from "../lib/identity.ts";
import { getRecordPublic, PublicRecordFetchError } from "../lib/pds.ts";
import { COMMUNITY_APP_LEXICON_ENABLED, JETSTREAM_URL } from "../lib/env.ts";
import { upsertProfileFromRecord } from "../lib/profile-sync.ts";
import {
  deleteAppFavorite,
  deleteAppRecord,
  deleteAppReview,
  upsertAppFavorite,
  upsertAppRecordFromDraft,
  upsertAppReview,
} from "../lib/app-directory.ts";
import {
  APP_DIRECTORY_COLLECTIONS,
  ATSTORE_FAVORITE_NSID,
  ATSTORE_LISTING_NSID,
  ATSTORE_REVIEW_NSID,
  COMMUNITY_APP_ENTRY_NSID,
  COMMUNITY_APP_PROFILE_NSID,
  parseAtstoreFavorite,
  parseAtstoreListing,
  parseAtstoreReview,
  parseCommunityAppRecord,
} from "../lib/app-lexicons.ts";
import {
  clearAppRecordFailure,
  recordAppRecordFailure,
} from "../lib/app-directory-failures.ts";
import {
  releaseWorkerLease,
  renewWorkerLease,
  tryAcquireWorkerLease,
} from "../lib/worker-lease.ts";
import {
  markHostProtocolRecordDeleted,
  upsertHostProtocolRecord,
} from "../lib/host-record-indexing.ts";

interface JetstreamCommit {
  rev: string;
  operation: "create" | "update" | "delete";
  collection: string;
  rkey: string;
  record?: Record<string, unknown>;
  cid?: string;
}

interface JetstreamEvent {
  did: string;
  time_us: number;
  kind: string;
  commit?: JetstreamCommit;
}

const COLLECTIONS: string[] = [
  PROFILE_NSID,
  REVIEW_NSID,
  UPDATE_NSID,
  FEATURED_NSID,
  HOST_PROFILE_NSID,
  HOST_SERVICE_NSID,
  ...APP_DIRECTORY_COLLECTIONS.filter((collection) =>
    COMMUNITY_APP_LEXICON_ENABLED ||
    !collection.startsWith("community.lexicon.app.")
  ),
];
const RECONNECT_DELAY_MS = 5_000;
const CURSOR_PERSIST_INTERVAL_MS = 5_000;
const LEASE_NAME = "jetstream-indexer";
const LEASE_TTL_MS = 45_000;
const LEASE_RENEW_INTERVAL_MS = 15_000;

class LeaseUnavailableError extends Error {
  constructor() {
    super("another indexer owns the Jetstream lease");
    this.name = "LeaseUnavailableError";
  }
}

const workerId = crypto.randomUUID();
let shuttingDown = false;
let activeSocket: WebSocket | null = null;

function requestShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[indexer] received ${signal}; shutting down`);
  try {
    activeSocket?.close(1001, "shutdown");
  } catch {
    // Already closed.
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  try {
    Deno.addSignalListener(signal, () => requestShutdown(signal));
  } catch {
    // Signal listeners are not available in every runtime.
  }
}

// Lightweight in-memory cache so we don't re-resolve every author's
// DID document for every event.
const pdsCache = new Map<string, { pdsUrl: string; expiresAt: number }>();
const PDS_CACHE_TTL_MS = 30 * 60 * 1000;

function handleFromDidDocument(
  doc: { alsoKnownAs?: string[] },
): string | null {
  const aka = (doc.alsoKnownAs ?? []).find((u) => u.startsWith("at://"));
  return aka ? aka.slice("at://".length) : null;
}

async function resolvePdsForDid(
  did: string,
): Promise<string> {
  const cached = pdsCache.get(did);
  if (cached && cached.expiresAt > Date.now()) return cached.pdsUrl;
  const doc = await resolveDidDocument(did);
  const pdsUrl = findPdsEndpoint(doc);
  pdsCache.set(did, { pdsUrl, expiresAt: Date.now() + PDS_CACHE_TTL_MS });
  return pdsUrl;
}

/** Best-effort handle lookup from the DID document's alsoKnownAs. */
async function resolveHandleFromDoc(did: string): Promise<string> {
  try {
    const doc = await resolveDidDocument(did);
    return handleFromDidDocument(doc) ?? did;
  } catch {
    return did;
  }
}

async function handleProfileEvent(event: JetstreamEvent): Promise<void> {
  const commit = event.commit;
  if (!commit) return;

  if (commit.operation === "delete") {
    await deleteProfile(event.did);
    return;
  }

  const pdsUrl = await resolvePdsForDid(event.did);
  // Trust Jetstream's record bytes when present, but fetch from PDS for
  // create/update to make sure we have the canonical value (Jetstream may
  // omit blobs in some configurations).
  const fetched = await getRecordPublic(
    pdsUrl,
    event.did,
    PROFILE_NSID,
    commit.rkey,
  );
  if (!fetched) return;

  const handle = await resolveHandleFromDoc(event.did);
  const synced = await upsertProfileFromRecord({
    did: event.did,
    handle,
    pdsUrl,
    record: { ...fetched, rkey: commit.rkey },
    recordRev: commit.rev,
  });
  if (synced) console.log(`[indexer] upsert profile ${handle} (${event.did})`);
}

async function handleReviewEvent(event: JetstreamEvent): Promise<void> {
  const commit = event.commit;
  if (!commit) return;

  if (commit.operation === "delete") {
    await markReviewRemovedByRkey(event.did, commit.rkey);
    return;
  }

  const pdsUrl = await resolvePdsForDid(event.did);
  const fetched = await getRecordPublic(
    pdsUrl,
    event.did,
    REVIEW_NSID,
    commit.rkey,
  );
  if (!fetched) return;

  const validation = validateReview(fetched.value);
  if (!validation.ok || !validation.value) {
    console.warn(
      `[indexer] invalid review from ${event.did}: ${validation.error}`,
    );
    return;
  }
  const r = validation.value;
  const target = await getProfileByDid(r.subject).catch(() => null);
  if (!target || target.profileType !== "project") {
    console.warn(`[indexer] ignoring review for non-project ${r.subject}`);
    return;
  }
  await createOrUpdateReview({
    targetDid: r.subject,
    reviewerDid: event.did,
    reviewUri: reviewUriForRkey(event.did, commit.rkey),
    reviewCid: fetched.cid,
    reviewRkey: commit.rkey,
    rating: r.rating,
    body: r.body ?? "",
    createdAt: Date.parse(r.createdAt) || Date.now(),
    updatedAt: Date.parse(r.updatedAt ?? r.createdAt) || Date.now(),
  });
  console.log(`[indexer] upsert review ${event.did} -> ${r.subject}`);
}

async function handleFeaturedEvent(event: JetstreamEvent): Promise<void> {
  const commit = event.commit;
  if (!commit) return;

  // Only the configured Atmosphere account is allowed to write the
  // featured directory.
  const allowedDid = Deno.env.get("ATMOSPHERE_DID");
  if (allowedDid && event.did !== allowedDid) {
    console.warn(
      `[indexer] ignoring featured write from non-curator ${event.did}`,
    );
    return;
  }

  if (commit.operation === "delete") {
    await replaceFeatured([]);
    return;
  }

  const pdsUrl = await resolvePdsForDid(event.did);
  const fetched = await getRecordPublic(
    pdsUrl,
    event.did,
    FEATURED_NSID,
    "self",
  );
  if (!fetched) return;

  const validation = validateFeatured(fetched.value);
  if (!validation.ok || !validation.value) {
    console.warn(`[indexer] invalid featured: ${validation.error}`);
    return;
  }
  await replaceFeatured(
    validation.value.entries.map((e, i) => ({
      did: e.did,
      badges: (e.badges ?? []) as string[],
      position: e.position ?? i,
    })),
  );
  console.log(
    `[indexer] replaced featured directory (${validation.value.entries.length} entries)`,
  );
}

async function handleUpdateEvent(event: JetstreamEvent): Promise<void> {
  const commit = event.commit;
  if (!commit) return;

  if (commit.operation === "delete") {
    await markProfileUpdateRemovedByRkey(event.did, commit.rkey);
    return;
  }

  const project = await getProfileByDid(event.did).catch(() => null);
  if (!project || project.profileType !== "project") {
    console.warn(`[indexer] ignoring update for non-project ${event.did}`);
    return;
  }

  const pdsUrl = await resolvePdsForDid(event.did);
  const fetched = await getRecordPublic(
    pdsUrl,
    event.did,
    UPDATE_NSID,
    commit.rkey,
  );
  if (!fetched) return;

  const validation = validateUpdate(fetched.value);
  if (!validation.ok || !validation.value) {
    console.warn(
      `[indexer] invalid update from ${event.did}: ${validation.error}`,
    );
    return;
  }
  const r = validation.value;
  await upsertProfileUpdate({
    uri: updateUriForRkey(event.did, commit.rkey),
    cid: fetched.cid,
    rkey: commit.rkey,
    projectDid: event.did,
    title: r.title,
    body: r.body,
    version: r.version ?? null,
    tangledCommitUrl: r.tangledCommitUrl ?? null,
    tangledRepoUrl: r.tangledRepoUrl ?? null,
    source: r.source ?? "manual",
    createdAt: Date.parse(r.createdAt) || Date.now(),
    updatedAt: Date.parse(r.updatedAt ?? r.createdAt) || Date.now(),
  });
  console.log(`[indexer] upsert update ${event.did}/${commit.rkey}`);
}

function recordUri(event: JetstreamEvent): string | null {
  const commit = event.commit;
  return commit
    ? `at://${event.did}/${commit.collection}/${commit.rkey}`
    : null;
}

async function handleAppDirectoryEvent(event: JetstreamEvent): Promise<void> {
  const commit = event.commit;
  if (!commit) return;
  const uri = recordUri(event);
  if (!uri) return;

  if (commit.operation === "delete") {
    if (commit.collection === ATSTORE_REVIEW_NSID) {
      await deleteAppReview(uri);
    } else if (commit.collection === ATSTORE_FAVORITE_NSID) {
      await deleteAppFavorite(uri);
    } else {
      await deleteAppRecord(uri);
    }
    await clearAppRecordFailure(uri);
    return;
  }

  const pdsUrl = await resolvePdsForDid(event.did);
  let fetched: Awaited<ReturnType<typeof getRecordPublic>>;
  try {
    fetched = await getRecordPublic(
      pdsUrl,
      event.did,
      commit.collection,
      commit.rkey,
    );
  } catch (err) {
    if (err instanceof PublicRecordFetchError && isPermanentFetchMiss(err)) {
      console.warn(
        `[indexer] app record fetch failed permanently for ${uri}: HTTP ${err.status}`,
      );
      await recordAppRecordFailure({
        uri,
        collection: commit.collection,
        sourceType: appDirectorySourceType(commit.collection),
        repoDid: event.did,
        rkey: commit.rkey,
        reason: `get_record_http_${err.status}`,
      });
      return;
    }
    throw err;
  }
  if (!fetched) {
    await recordAppRecordFailure({
      uri,
      collection: commit.collection,
      sourceType: appDirectorySourceType(commit.collection),
      repoDid: event.did,
      rkey: commit.rkey,
      reason: "record_not_found",
    });
    return;
  }

  if (commit.collection === ATSTORE_LISTING_NSID) {
    const draft = parseAtstoreListing({
      uri,
      cid: fetched.cid,
      repoDid: event.did,
      rkey: commit.rkey,
      value: fetched.value,
    });
    if (!draft) {
      console.warn(`[indexer] invalid ATStore listing ${uri}`);
      await recordAppRecordFailure({
        uri,
        collection: commit.collection,
        sourceType: "atstore_listing",
        repoDid: event.did,
        rkey: commit.rkey,
        reason: "invalid_atstore_listing",
      });
      return;
    }
    await upsertAppRecordFromDraft({ draft, rawRecord: fetched.value });
    await clearAppRecordFailure(uri);
    console.log(`[indexer] upsert app listing ${uri}`);
  } else if (commit.collection === ATSTORE_REVIEW_NSID) {
    const draft = parseAtstoreReview({
      uri,
      cid: fetched.cid,
      repoDid: event.did,
      rkey: commit.rkey,
      value: fetched.value,
    });
    if (draft) {
      await upsertAppReview(draft);
      await clearAppRecordFailure(uri);
    } else {
      await recordAppRecordFailure({
        uri,
        collection: commit.collection,
        sourceType: "atstore_review",
        repoDid: event.did,
        rkey: commit.rkey,
        reason: "invalid_atstore_review",
      });
    }
  } else if (commit.collection === ATSTORE_FAVORITE_NSID) {
    const draft = parseAtstoreFavorite({
      uri,
      cid: fetched.cid,
      repoDid: event.did,
      rkey: commit.rkey,
      value: fetched.value,
    });
    if (draft) {
      await upsertAppFavorite(draft);
      await clearAppRecordFailure(uri);
    } else {
      await recordAppRecordFailure({
        uri,
        collection: commit.collection,
        sourceType: "atstore_favorite",
        repoDid: event.did,
        rkey: commit.rkey,
        reason: "invalid_atstore_favorite",
      });
    }
  } else if (
    COMMUNITY_APP_LEXICON_ENABLED &&
    (commit.collection === COMMUNITY_APP_PROFILE_NSID ||
      commit.collection === COMMUNITY_APP_ENTRY_NSID)
  ) {
    const draft = parseCommunityAppRecord({
      uri,
      cid: fetched.cid,
      repoDid: event.did,
      rkey: commit.rkey,
      collection: commit.collection,
      value: fetched.value,
    });
    if (!draft) {
      await recordAppRecordFailure({
        uri,
        collection: commit.collection,
        sourceType: appDirectorySourceType(commit.collection),
        repoDid: event.did,
        rkey: commit.rkey,
        reason: "invalid_community_app_record",
      });
      return;
    }
    await upsertAppRecordFromDraft({ draft, rawRecord: fetched.value });
    await clearAppRecordFailure(uri);
    console.log(`[indexer] upsert community app ${uri}`);
  }
}

async function handleHostProtocolEvent(event: JetstreamEvent): Promise<void> {
  const commit = event.commit;
  if (!commit) return;
  const uri = recordUri(event);
  if (!uri) return;

  if (commit.operation === "delete") {
    await markHostProtocolRecordDeleted(uri);
    console.log(`[indexer] deleted host record ${uri}`);
    return;
  }

  const pdsUrl = await resolvePdsForDid(event.did);
  const fetched = await getRecordPublic(
    pdsUrl,
    event.did,
    commit.collection,
    commit.rkey,
  );
  if (!fetched) return;

  const authorHandle = await resolveHandleFromDoc(event.did);
  const parsed = await upsertHostProtocolRecord({
    uri,
    cid: fetched.cid,
    collection: commit.collection,
    repoDid: event.did,
    rkey: commit.rkey,
    authorHandle,
    value: fetched.value,
  });
  if (parsed) {
    console.log(`[indexer] upsert host ${parsed.kind} ${uri}`);
  } else {
    console.warn(`[indexer] invalid host record ${uri}`);
  }
}

function appDirectorySourceType(collection: string): string {
  if (collection === ATSTORE_LISTING_NSID) return "atstore_listing";
  if (collection === ATSTORE_REVIEW_NSID) return "atstore_review";
  if (collection === ATSTORE_FAVORITE_NSID) return "atstore_favorite";
  if (collection === COMMUNITY_APP_PROFILE_NSID) return "community_profile";
  if (collection === COMMUNITY_APP_ENTRY_NSID) return "community_entry";
  return "unknown";
}

function isPermanentFetchMiss(err: PublicRecordFetchError): boolean {
  return err.status >= 400 && err.status < 500;
}

async function processEvent(event: JetstreamEvent): Promise<void> {
  if (event.kind !== "commit" || !event.commit) return;
  const collection = event.commit.collection;
  try {
    if (collection === PROFILE_NSID) {
      await handleProfileEvent(event);
    } else if (collection === REVIEW_NSID) {
      await handleReviewEvent(event);
    } else if (collection === UPDATE_NSID) {
      await handleUpdateEvent(event);
    } else if (collection === FEATURED_NSID) {
      await handleFeaturedEvent(event);
    } else if (
      collection === HOST_PROFILE_NSID || collection === HOST_SERVICE_NSID
    ) {
      await handleHostProtocolEvent(event);
    } else if (COLLECTIONS.includes(collection)) {
      await handleAppDirectoryEvent(event);
    }
  } catch (err) {
    console.error(`[indexer] handler error for ${collection}:`, err);
    throw err;
  }
}

function buildJetstreamUrl(cursor: number | null): string {
  const url = new URL(JETSTREAM_URL);
  for (const c of COLLECTIONS) {
    url.searchParams.append("wantedCollections", c);
  }
  if (cursor !== null) {
    url.searchParams.set("cursor", String(cursor));
  }
  return url.toString();
}

async function runOnce(): Promise<never> {
  const acquired = await tryAcquireWorkerLease(
    LEASE_NAME,
    workerId,
    LEASE_TTL_MS,
  );
  if (!acquired) throw new LeaseUnavailableError();

  const cursor = await getJetstreamCursor();
  const url = buildJetstreamUrl(cursor);
  console.log(`[indexer] connecting as ${workerId} to ${url}`);

  const ws = new WebSocket(url);
  activeSocket = ws;
  let lastPersistedAt = 0;
  let processedCursor = cursor ?? 0;
  let renewTimer: number | undefined;

  try {
    return await new Promise<never>((_, reject) => {
      let stopped = false;
      let queue = Promise.resolve();

      const stopWithError = (err: unknown) => {
        if (stopped) return;
        stopped = true;
        try {
          ws.close(1011, "handler error");
        } catch {
          // The socket may already be closed.
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      renewTimer = setInterval(() => {
        renewWorkerLease(LEASE_NAME, workerId, LEASE_TTL_MS).then((ok) => {
          if (!ok) stopWithError(new Error("lost Jetstream worker lease"));
        }).catch(stopWithError);
      }, LEASE_RENEW_INTERVAL_MS);

      ws.addEventListener("open", () => {
        console.log("[indexer] connected");
      });
      ws.addEventListener("message", (msg) => {
        if (stopped) return;
        queue = queue.then(async () => {
          const event = JSON.parse(String(msg.data)) as JetstreamEvent;
          await processEvent(event);
          if (event.time_us > processedCursor) processedCursor = event.time_us;
          if (Date.now() - lastPersistedAt > CURSOR_PERSIST_INTERVAL_MS) {
            lastPersistedAt = Date.now();
            await setJetstreamCursor(processedCursor).catch((e) =>
              console.warn("[indexer] cursor persist failed:", e)
            );
          }
        }).catch((err) => {
          console.error("[indexer] message error:", err);
          stopWithError(err);
        });
      });
      ws.addEventListener("close", (ev) => {
        stopped = true;
        reject(new Error(`websocket closed: ${ev.code} ${ev.reason}`));
      });
      ws.addEventListener("error", (ev) => {
        stopped = true;
        reject(
          new Error(
            `websocket error: ${(ev as ErrorEvent).message ?? "unknown"}`,
          ),
        );
      });
    });
  } finally {
    if (renewTimer !== undefined) clearInterval(renewTimer);
    if (activeSocket === ws) activeSocket = null;
    await releaseWorkerLease(LEASE_NAME, workerId).catch((err) => {
      console.warn("[indexer] lease release failed:", err);
    });
  }
}

async function main(): Promise<void> {
  while (!shuttingDown) {
    try {
      await runOnce();
    } catch (err) {
      if (shuttingDown) break;
      if (err instanceof LeaseUnavailableError) {
        console.warn(`[indexer] ${err.message}; retrying soon`);
      } else {
        console.error("[indexer]", err);
      }
    }
    if (shuttingDown) break;
    console.log(`[indexer] reconnecting in ${RECONNECT_DELAY_MS}ms...`);
    await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
  }
  await releaseWorkerLease(LEASE_NAME, workerId).catch(() => {});
  console.log("[indexer] stopped");
}

if (import.meta.main) {
  await main();
}
