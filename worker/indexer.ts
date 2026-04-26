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
 * Run on Fly.io: see worker/Dockerfile + fly.toml.
 */
import {
  FEATURED_NSID,
  PROFILE_NSID,
  validateFeatured,
  validateProfile,
} from "../lib/lexicons.ts";
import {
  deleteProfile,
  getJetstreamCursor,
  replaceFeatured,
  setJetstreamCursor,
  upsertProfile,
} from "../lib/registry.ts";
import { findPdsEndpoint, resolveDidDocument } from "../lib/identity.ts";
import { getRecordPublic } from "../lib/pds.ts";
import { JETSTREAM_URL } from "../lib/env.ts";

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

const COLLECTIONS = [PROFILE_NSID, FEATURED_NSID];
const RECONNECT_DELAY_MS = 5_000;
const CURSOR_PERSIST_INTERVAL_MS = 5_000;

// Lightweight in-memory cache so we don't re-resolve every author's
// DID document for every event.
const pdsCache = new Map<string, { pdsUrl: string; expiresAt: number }>();
const PDS_CACHE_TTL_MS = 30 * 60 * 1000;

async function resolvePdsForDid(did: string): Promise<string> {
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
    const aka = (doc.alsoKnownAs ?? []).find((u) => u.startsWith("at://"));
    return aka ? aka.slice("at://".length) : did;
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
    "self",
  );
  if (!fetched) return;

  const validation = validateProfile(fetched.value);
  if (!validation.ok || !validation.value) {
    console.warn(
      `[indexer] invalid profile from ${event.did}: ${validation.error}`,
    );
    return;
  }
  const r = validation.value;
  const handle = await resolveHandleFromDoc(event.did);

  await upsertProfile({
    did: event.did,
    handle,
    name: r.name,
    description: r.description,
    mainLink: r.mainLink ?? null,
    iosLink: r.iosLink ?? null,
    androidLink: r.androidLink ?? null,
    categories: r.categories,
    subcategories: r.subcategories ?? [],
    links: r.links ?? [],
    avatarCid: r.avatar?.ref.$link ?? null,
    avatarMime: r.avatar?.mimeType ?? null,
    iconCid: r.icon?.ref.$link ?? null,
    iconMime: r.icon?.mimeType ?? null,
    pdsUrl,
    recordCid: fetched.cid,
    recordRev: commit.rev,
    createdAt: Date.parse(r.createdAt) || Date.now(),
  });
  console.log(`[indexer] upsert profile ${handle} (${event.did})`);
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

async function processEvent(event: JetstreamEvent): Promise<void> {
  if (event.kind !== "commit" || !event.commit) return;
  const collection = event.commit.collection;
  try {
    if (collection === PROFILE_NSID) {
      await handleProfileEvent(event);
    } else if (collection === FEATURED_NSID) {
      await handleFeaturedEvent(event);
    }
  } catch (err) {
    console.error(`[indexer] handler error for ${collection}:`, err);
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
  const cursor = await getJetstreamCursor();
  const url = buildJetstreamUrl(cursor);
  console.log(`[indexer] connecting to ${url}`);

  const ws = new WebSocket(url);
  let lastPersistedAt = 0;
  let highestSeen = cursor ?? 0;

  return await new Promise<never>((_, reject) => {
    ws.addEventListener("open", () => {
      console.log("[indexer] connected");
    });
    ws.addEventListener("message", async (msg) => {
      try {
        const event = JSON.parse(msg.data as string) as JetstreamEvent;
        if (event.time_us > highestSeen) highestSeen = event.time_us;
        await processEvent(event);
        if (Date.now() - lastPersistedAt > CURSOR_PERSIST_INTERVAL_MS) {
          lastPersistedAt = Date.now();
          await setJetstreamCursor(highestSeen).catch((e) =>
            console.warn("[indexer] cursor persist failed:", e)
          );
        }
      } catch (err) {
        console.error("[indexer] message error:", err);
      }
    });
    ws.addEventListener("close", (ev) => {
      reject(new Error(`websocket closed: ${ev.code} ${ev.reason}`));
    });
    ws.addEventListener("error", (ev) => {
      reject(
        new Error(
          `websocket error: ${(ev as ErrorEvent).message ?? "unknown"}`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  while (true) {
    try {
      await runOnce();
    } catch (err) {
      console.error("[indexer]", err);
    }
    console.log(`[indexer] reconnecting in ${RECONNECT_DELAY_MS}ms...`);
    await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
  }
}

if (import.meta.main) {
  await main();
}
