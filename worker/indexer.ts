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
import {
  jetstreamDisconnectReason,
  nextReconnectFailureCount,
  reconnectDelayMs,
  reconnectLogDecision,
  type ReconnectLogLevel,
} from "../lib/reconnect-backoff.ts";

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
const CURSOR_PERSIST_INTERVAL_MS = 5_000;
const LEASE_NAME = "jetstream-indexer";
const LEASE_TTL_MS = 45_000;
const LEASE_RENEW_INTERVAL_MS = 15_000;
const DEFAULT_MAX_PENDING_EVENTS = 1_000;
const MAX_PENDING_EVENTS = jetstreamMaxPendingEvents(
  Deno.env.get("JETSTREAM_MAX_PENDING_EVENTS"),
);

class LeaseUnavailableError extends Error {
  constructor() {
    super("another indexer owns the Jetstream lease");
    this.name = "LeaseUnavailableError";
  }
}

class JetstreamDisconnectError extends Error {
  connectedForMs: number;

  constructor(message: string, connectedForMs: number) {
    super(message);
    this.name = "JetstreamDisconnectError";
    this.connectedForMs = connectedForMs;
  }
}

const workerId = crypto.randomUUID();
let shuttingDown = false;
let activeSocket: WebSocket | null = null;

function requestShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[indexer] received %s; shutting down", signal);
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

interface IndexerIdentity {
  pdsUrl: string;
  handle: string | null;
}

interface IndexerIdentityCacheOptions {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}

/**
 * Small LRU cache for DID documents used by the serial indexer.
 *
 * This deliberately does not serve an expired identity when refresh fails.
 * A stale PDS endpoint is not merely stale presentation data: after an account
 * migration it could make us read records from a host the DID no longer names.
 */
export class IndexerIdentityCache {
  private readonly values = new Map<
    string,
    { value: IndexerIdentity; expiresAt: number }
  >();
  private readonly inFlight = new Map<string, Promise<IndexerIdentity>>();
  private readonly now: () => number;

  constructor(private readonly options: IndexerIdentityCacheOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  get(
    did: string,
    load: () => Promise<IndexerIdentity>,
  ): Promise<IndexerIdentity> {
    const cached = this.values.get(did);
    if (cached && cached.expiresAt > this.now()) {
      this.values.delete(did);
      this.values.set(did, cached);
      return Promise.resolve(cached.value);
    }
    if (cached) this.values.delete(did);

    const existingLoad = this.inFlight.get(did);
    if (existingLoad) return existingLoad;

    const refresh = load().then((value) => {
      this.set(did, value);
      return value;
    }).finally(() => {
      if (this.inFlight.get(did) === refresh) this.inFlight.delete(did);
    });
    this.inFlight.set(did, refresh);
    return refresh;
  }

  private set(did: string, value: IndexerIdentity): void {
    const now = this.now();
    for (const [key, entry] of this.values) {
      if (entry.expiresAt <= now) this.values.delete(key);
    }
    if (
      !this.values.has(did) &&
      this.values.size >= this.options.maxEntries
    ) {
      const oldest = this.values.keys().next().value;
      if (oldest) this.values.delete(oldest);
    }
    this.values.delete(did);
    this.values.set(did, {
      value,
      expiresAt: now + this.options.ttlMs,
    });
  }
}

// Resolving a DID document yields both values used by the indexer. Keeping them
// together avoids a second PLC/did:web request for profile and host events.
const PDS_CACHE_TTL_MS = 30 * 60 * 1000;
const identityCache = new IndexerIdentityCache({
  ttlMs: PDS_CACHE_TTL_MS,
  maxEntries: 4_096,
});

export function jetstreamMaxPendingEvents(
  raw: string | null | undefined,
): number {
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return DEFAULT_MAX_PENDING_EVENTS;
  }
  return Math.min(parsed, 10_000);
}

export function jetstreamBacklogIsFull(
  pendingEvents: number,
  maxPendingEvents: number,
): boolean {
  return pendingEvents >= maxPendingEvents;
}

export interface IndexerFailureLogFields {
  kind: "public_record_fetch" | "unexpected_error" | "unexpected_value";
  httpStatus: number | null;
}

export function indexerFailureLogFields(
  error: unknown,
): IndexerFailureLogFields {
  if (error instanceof PublicRecordFetchError) {
    const httpStatus = Number.isInteger(error.status) &&
        error.status >= 100 && error.status <= 599
      ? error.status
      : null;
    return { kind: "public_record_fetch", httpStatus };
  }
  return {
    kind: error instanceof Error ? "unexpected_error" : "unexpected_value",
    httpStatus: null,
  };
}

function handleFromDidDocument(
  doc: { alsoKnownAs?: string[] },
): string | null {
  const aka = (doc.alsoKnownAs ?? []).find((u) => u.startsWith("at://"));
  return aka ? aka.slice("at://".length) : null;
}

async function resolvePdsForDid(
  did: string,
): Promise<string> {
  return (await resolveIndexerIdentity(did)).pdsUrl;
}

/** Best-effort handle lookup from the DID document's alsoKnownAs. */
async function resolveHandleFromDoc(did: string): Promise<string> {
  try {
    return (await resolveIndexerIdentity(did)).handle ?? did;
  } catch {
    return did;
  }
}

async function resolveIndexerIdentity(did: string): Promise<{
  pdsUrl: string;
  handle: string | null;
}> {
  return await identityCache.get(did, async () => {
    const doc = await resolveDidDocument(did);
    return {
      pdsUrl: findPdsEndpoint(doc),
      handle: handleFromDidDocument(doc),
    };
  });
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
  if (synced) {
    console.log("[indexer] upsert profile %s (%s)", handle, event.did);
  }
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
      "[indexer] invalid review from %s: %s",
      event.did,
      validation.error,
    );
    return;
  }
  const r = validation.value;
  const target = await getProfileByDid(r.subject).catch(() => null);
  if (!target || target.profileType !== "project") {
    console.warn("[indexer] ignoring review for non-project %s", r.subject);
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
  console.log("[indexer] upsert review %s -> %s", event.did, r.subject);
}

async function handleFeaturedEvent(event: JetstreamEvent): Promise<void> {
  const commit = event.commit;
  if (!commit) return;

  // Only the configured Atmosphere account is allowed to write the
  // featured directory.
  const allowedDid = Deno.env.get("ATMOSPHERE_DID");
  if (allowedDid && event.did !== allowedDid) {
    console.warn(
      "[indexer] ignoring featured write from non-curator %s",
      event.did,
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
    console.warn("[indexer] invalid featured: %s", validation.error);
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
    "[indexer] replaced featured directory (%d entries)",
    validation.value.entries.length,
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
    console.warn("[indexer] ignoring update for non-project %s", event.did);
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
      "[indexer] invalid update from %s: %s",
      event.did,
      validation.error,
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
  console.log("[indexer] upsert update %s/%s", event.did, commit.rkey);
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
        "[indexer] app record fetch failed permanently for %s: HTTP %d",
        uri,
        err.status,
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
      console.warn("[indexer] invalid ATStore listing %s", uri);
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
    console.log("[indexer] upsert app listing %s", uri);
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
    console.log("[indexer] upsert community app %s", uri);
  }
}

async function handleHostProtocolEvent(event: JetstreamEvent): Promise<void> {
  const commit = event.commit;
  if (!commit) return;
  const uri = recordUri(event);
  if (!uri) return;

  if (commit.operation === "delete") {
    await markHostProtocolRecordDeleted(uri);
    console.log("[indexer] deleted host record %s", uri);
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
    console.log("[indexer] upsert host %s %s", parsed.kind, uri);
  } else {
    console.warn("[indexer] invalid host record %s", uri);
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
    const failure = indexerFailureLogFields(err);
    console.error(
      "[indexer] handler failed collection=%s error_kind=%s http_status=%s",
      COLLECTIONS.includes(collection) ? collection : "unknown",
      failure.kind,
      failure.httpStatus ?? "none",
    );
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

async function runOnce(logConnectionLifecycle: boolean): Promise<never> {
  const acquired = await tryAcquireWorkerLease(
    LEASE_NAME,
    workerId,
    LEASE_TTL_MS,
  );
  if (!acquired) throw new LeaseUnavailableError();

  const cursor = await getJetstreamCursor();
  const url = buildJetstreamUrl(cursor);
  if (logConnectionLifecycle) {
    console.log("[indexer] connecting as %s to %s", workerId, url);
  }

  const ws = new WebSocket(url);
  activeSocket = ws;
  let lastPersistedAt = 0;
  let processedCursor = cursor ?? 0;
  let renewTimer: number | undefined;
  let connectedAt: number | null = null;
  let processingQueue = Promise.resolve();

  try {
    return await new Promise<never>((_, reject) => {
      let stopped = false;
      let pendingEvents = 0;

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
        connectedAt = Date.now();
        if (logConnectionLifecycle) console.log("[indexer] connected");
      });
      ws.addEventListener("message", (msg) => {
        if (stopped) return;
        if (jetstreamBacklogIsFull(pendingEvents, MAX_PENDING_EVENTS)) {
          stopWithError(
            new Error(
              `Jetstream event backlog exceeded ${MAX_PENDING_EVENTS}; reconnecting from persisted cursor`,
            ),
          );
          return;
        }
        pendingEvents++;
        processingQueue = processingQueue.then(async () => {
          if (stopped) return;
          const event = JSON.parse(String(msg.data)) as JetstreamEvent;
          await processEvent(event);
          if (event.time_us > processedCursor) processedCursor = event.time_us;
          if (Date.now() - lastPersistedAt > CURSOR_PERSIST_INTERVAL_MS) {
            lastPersistedAt = Date.now();
            await setJetstreamCursor(processedCursor).catch(() =>
              console.warn("[indexer] cursor persist failed")
            );
          }
        }).catch((err) => {
          const failure = indexerFailureLogFields(err);
          console.error(
            "[indexer] message failed error_kind=%s http_status=%s",
            failure.kind,
            failure.httpStatus ?? "none",
          );
          stopWithError(err);
        }).finally(() => {
          pendingEvents--;
        });
      });
      ws.addEventListener("close", (ev) => {
        if (stopped) return;
        stopped = true;
        reject(
          new JetstreamDisconnectError(
            `websocket closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ""})`,
            connectedAt == null ? 0 : Date.now() - connectedAt,
          ),
        );
      });
      ws.addEventListener("error", (ev) => {
        if (stopped) return;
        stopped = true;
        reject(
          new JetstreamDisconnectError(
            `websocket transport error: ${
              (ev as ErrorEvent).message || "unknown"
            }`,
            connectedAt == null ? 0 : Date.now() - connectedAt,
          ),
        );
      });
    });
  } finally {
    if (renewTimer !== undefined) clearInterval(renewTimer);
    if (activeSocket === ws) activeSocket = null;
    // Do not release the distributed lease while an event that already began
    // may still be writing. Queued events become no-ops once `stopped` is set.
    await processingQueue.catch(() => {});
    await releaseWorkerLease(LEASE_NAME, workerId).catch(() => {
      console.warn("[indexer] lease release failed");
    });
  }
}

async function main(): Promise<void> {
  let consecutiveFailures = 0;
  let lastReconnectLoggedAt: number | null = null;
  let lastReconnectLogLevel: ReconnectLogLevel | null = null;
  let suppressedReconnects = 0;
  while (!shuttingDown) {
    let retryDelayMs = reconnectDelayMs(Math.max(1, consecutiveFailures));
    try {
      await runOnce(consecutiveFailures === 0);
    } catch (err) {
      if (shuttingDown) break;
      if (err instanceof LeaseUnavailableError) {
        console.warn("[indexer] %s; retrying soon", err.message);
        consecutiveFailures = 0;
      } else if (err instanceof JetstreamDisconnectError) {
        consecutiveFailures = nextReconnectFailureCount({
          previous: consecutiveFailures,
          connectedForMs: err.connectedForMs,
        });
        retryDelayMs = reconnectDelayMs(consecutiveFailures);
        const now = Date.now();
        const decision = reconnectLogDecision({
          consecutiveFailures,
          connectedForMs: err.connectedForMs,
          now,
          lastLoggedAt: lastReconnectLoggedAt,
          lastLevel: lastReconnectLogLevel,
        });
        if (decision.shouldLog) {
          const message = `[indexer] Jetstream disconnected reason=${
            jetstreamDisconnectReason(err.message)
          } connection_ms=${err.connectedForMs} consecutive_failures=${consecutiveFailures} reconnect_delay_ms=${retryDelayMs} suppressed_reconnects=${suppressedReconnects}`;
          if (decision.level === "error") console.error("%s", message);
          else console.info("%s", message);
          lastReconnectLoggedAt = now;
          suppressedReconnects = 0;
        } else {
          suppressedReconnects += 1;
        }
        lastReconnectLogLevel = decision.level;
      } else {
        consecutiveFailures = Math.min(11, consecutiveFailures + 1);
        retryDelayMs = reconnectDelayMs(consecutiveFailures);
        const failure = indexerFailureLogFields(err);
        console.error(
          "[indexer] worker failed error_kind=%s http_status=%s",
          failure.kind,
          failure.httpStatus ?? "none",
        );
      }
    }
    if (shuttingDown) break;
    await new Promise((r) => setTimeout(r, retryDelayMs));
  }
  await releaseWorkerLease(LEASE_NAME, workerId).catch(() => {});
  console.log("[indexer] stopped");
}

if (import.meta.main) {
  await main();
}
