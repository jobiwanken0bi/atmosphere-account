import { listManagedAppListingsByAccountDid } from "./app-directory.ts";
import { findPdsEndpoint, resolveDidDocument } from "./identity.ts";
import { listRecordsPublic } from "./pds.ts";
import {
  markMissingStandardSiteProfileUpdatesRemoved,
  upsertProfileUpdate,
} from "./profile-updates.ts";
import { SITE_URL } from "./env.ts";
import {
  getStandardSitePublicationBindingByUri,
  type StandardSitePublicationBinding,
} from "./standard-site-publication-bindings.ts";
import {
  atmosphereStandardSiteAppIdFromTags,
  atmosphereStandardSiteDocumentSlug,
  atmosphereStandardSiteUpdateSource,
  isStandardSiteRkey,
  parseStandardSiteDocument,
  parseStandardSitePublication,
  STANDARD_SITE_DOCUMENT_NSID,
  STANDARD_SITE_PUBLICATION_NSID,
  standardSiteVersionFromTags,
} from "./standard-site-updates.ts";

export const STANDARD_SITE_SYNC_LIMIT = 40;
export const STANDARD_SITE_UPDATE_SOURCE = "standard_site";
export const STANDARD_SITE_DOCUMENT_SCAN_LIMIT = 100;
export const STANDARD_SITE_DOCUMENT_SCAN_MAX_PAGES = 10;
export const STANDARD_SITE_PUBLICATION_SCAN_LIMIT = 100;
const STANDARD_SITE_PUBLICATION_SCAN_MAX_PAGES = 10;
export const STANDARD_SITE_SYNC_CACHE_TTL_MS = 5 * 60 * 1_000;
const STANDARD_SITE_SYNC_CACHE_MAX_ENTRIES = 256;

export interface StandardSiteSyncRecord {
  uri: string;
  cid: string;
  value: unknown;
}

export interface StandardSiteSyncDependencies {
  listManagedListings: (
    did: string,
  ) => Promise<Array<{ id: string; productDid: string | null; slug: string }>>;
  resolvePds: (did: string) => Promise<string>;
  listRecords: (
    pdsUrl: string,
    did: string,
    collection: string,
    options: { limit: number; reverse?: boolean; cursor?: string },
  ) => Promise<{ records: StandardSiteSyncRecord[]; cursor?: string }>;
  getPublicationBindingByUri: (
    appId: string,
    publicationUri: string,
  ) => Promise<StandardSitePublicationBinding | null>;
  upsertUpdate: (input: StandardSiteUpdateUpsert) => Promise<unknown>;
  reconcileUpdates: (
    did: string,
    projectedUris: ReadonlySet<string>,
    indexedBefore: number,
  ) => Promise<unknown>;
}

export interface StandardSiteUpdateUpsert {
  uri: string;
  cid: string;
  rkey: string;
  projectDid: string;
  title: string;
  body: string;
  version: string | null;
  source: string;
  createdAt: number;
  updatedAt: number;
}

export interface StandardSiteSyncResult {
  managed: boolean;
  recordsSeen: number;
  recordsSynced: number;
  recordsSkipped: number;
}

export interface StandardSiteSyncCacheOptions {
  ttlMs?: number;
  now?: () => number;
}

/**
 * Dependency-injected public backfill. The ownership gate deliberately runs
 * before DID resolution or PDS reads so arbitrary repositories cannot be
 * mirrored into the managed What's New index.
 */
export async function syncStandardSiteDocumentsForProductCore(
  did: string,
  dependencies: StandardSiteSyncDependencies,
): Promise<StandardSiteSyncResult> {
  const productDid = did.trim();
  if (!productDid.startsWith("did:")) {
    return emptyResult(false);
  }

  const listings = (await dependencies.listManagedListings(productDid))
    .filter((listing) =>
      listing.productDid === productDid && listing.slug.trim().length > 0
    );
  if (listings.length === 0) {
    return emptyResult(false);
  }

  const reconciliationCutoff = Date.now();
  const pdsUrl = await dependencies.resolvePds(productDid);
  const atmospherePublicationUrls = await loadAtmospherePublicationUrls(
    pdsUrl,
    productDid,
    dependencies,
  );
  const scanned = await scanStandardSiteDocuments(
    pdsUrl,
    productDid,
    dependencies,
  );
  const records = [...scanned.documents.values()]
    .sort(compareDocumentsByPublishedAt)
    .slice(0, STANDARD_SITE_SYNC_LIMIT);
  const bindingCache = new Map<
    string,
    Promise<StandardSitePublicationBinding | null>
  >();
  let recordsSynced = 0;

  for (const { envelope, record, rkey } of records) {
    const body = record.textContent ?? record.description ?? "";
    const appId = atmosphereStandardSiteAppIdFromTags(record.tags);
    const publicationUrl = atmospherePublicationUrls.get(record.site);
    let binding: StandardSitePublicationBinding | null = null;
    if (
      appId && publicationUrl &&
      listings.some((listing) => listing.id === appId)
    ) {
      const cacheKey = JSON.stringify([appId, record.site]);
      let bindingPromise = bindingCache.get(cacheKey);
      if (!bindingPromise) {
        bindingPromise = dependencies.getPublicationBindingByUri(
          appId,
          record.site,
        );
        bindingCache.set(cacheKey, bindingPromise);
      }
      binding = await bindingPromise;
    }
    const managedAtmosphereDocument = !!(
      appId && binding?.appListingId === appId &&
      binding.publicationUri === record.site && publicationUrl &&
      binding.publicationUrl === publicationUrl &&
      atmosphereStandardSiteDocumentSlug(record, {
        publicationUrl,
        siteUrl: SITE_URL,
        rkey,
      })
    );
    const source = managedAtmosphereDocument
      ? atmosphereStandardSiteUpdateSource(appId!)
      : STANDARD_SITE_UPDATE_SOURCE;

    await dependencies.upsertUpdate({
      uri: envelope.uri,
      cid: envelope.cid,
      rkey,
      projectDid: productDid,
      title: record.title,
      body,
      version: standardSiteVersionFromTags(record.tags),
      source,
      createdAt: Date.parse(record.publishedAt),
      updatedAt: Date.parse(record.updatedAt ?? record.publishedAt),
    });
    recordsSynced += 1;
  }

  if (scanned.complete) {
    await dependencies.reconcileUpdates(
      productDid,
      new Set(records.map(({ envelope }) => envelope.uri)),
      reconciliationCutoff,
    );
  }

  return {
    managed: true,
    recordsSeen: scanned.recordsSeen,
    recordsSynced,
    recordsSkipped: scanned.recordsSkipped,
  };
}

interface ScannedStandardSiteDocument {
  envelope: StandardSiteSyncRecord;
  record: NonNullable<ReturnType<typeof parseStandardSiteDocument>>;
  rkey: string;
  publishedAt: number;
}

async function scanStandardSiteDocuments(
  pdsUrl: string,
  did: string,
  dependencies: StandardSiteSyncDependencies,
): Promise<{
  complete: boolean;
  documents: Map<string, ScannedStandardSiteDocument>;
  recordsSeen: number;
  recordsSkipped: number;
}> {
  const documents = new Map<string, ScannedStandardSiteDocument>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let recordsSeen = 0;
  let recordsSkipped = 0;

  for (
    let pageNumber = 0;
    pageNumber < STANDARD_SITE_DOCUMENT_SCAN_MAX_PAGES;
    pageNumber++
  ) {
    const page = await dependencies.listRecords(
      pdsUrl,
      did,
      STANDARD_SITE_DOCUMENT_NSID,
      {
        limit: STANDARD_SITE_DOCUMENT_SCAN_LIMIT,
        reverse: true,
        ...(cursor ? { cursor } : {}),
      },
    );
    recordsSeen += page.records.length;
    for (const envelope of page.records) {
      const rkey = documentRkeyFromUri(envelope.uri, did);
      const record = parseStandardSiteDocument(envelope.value);
      if (!rkey || !record) {
        recordsSkipped += 1;
        continue;
      }
      documents.set(envelope.uri, {
        envelope,
        record,
        rkey,
        publishedAt: Date.parse(record.publishedAt),
      });
    }

    if (!page.cursor) {
      return {
        complete: true,
        documents,
        recordsSeen,
        recordsSkipped,
      };
    }
    if (cursors.has(page.cursor)) break;
    cursors.add(page.cursor);
    cursor = page.cursor;
  }

  return {
    complete: false,
    documents,
    recordsSeen,
    recordsSkipped,
  };
}

function compareDocumentsByPublishedAt(
  left: ScannedStandardSiteDocument,
  right: ScannedStandardSiteDocument,
): number {
  return right.publishedAt - left.publishedAt ||
    right.rkey.localeCompare(left.rkey);
}

async function loadAtmospherePublicationUrls(
  pdsUrl: string,
  did: string,
  dependencies: StandardSiteSyncDependencies,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await dependencies.listRecords(
      pdsUrl,
      did,
      STANDARD_SITE_PUBLICATION_NSID,
      { limit: STANDARD_SITE_PUBLICATION_SCAN_LIMIT, cursor },
    );
    for (const envelope of page.records) {
      const publication = parseStandardSitePublication(envelope.value);
      if (!publication) continue;
      result.set(envelope.uri, publication.url);
    }
    cursor = page.cursor;
    pages += 1;
  } while (cursor && pages < STANDARD_SITE_PUBLICATION_SCAN_MAX_PAGES);
  return result;
}

/**
 * Add a short success cache and per-DID singleflight around a sync function.
 * Empty successful results are cached too, preventing an app with no update
 * documents from polling its PDS on every public page view. Failures are not
 * cached and the dependency-injected core above remains fully uncached.
 */
export function createCachedStandardSiteSync(
  sync: (did: string) => Promise<StandardSiteSyncResult>,
  options: StandardSiteSyncCacheOptions = {},
): (did: string) => Promise<StandardSiteSyncResult> {
  const ttlMs = Math.max(1, options.ttlMs ?? STANDARD_SITE_SYNC_CACHE_TTL_MS);
  const now = options.now ?? Date.now;
  const cache = new Map<
    string,
    { expiresAt: number; result: StandardSiteSyncResult }
  >();
  const inFlight = new Map<string, Promise<StandardSiteSyncResult>>();

  return (did) => {
    const key = did.trim();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      return Promise.resolve(cached.result);
    }
    if (cached) cache.delete(key);
    const running = inFlight.get(key);
    if (running) return running;

    const promise = Promise.resolve()
      .then(() => sync(key))
      .then((result) => {
        evictExpiredAndOldest(cache, now());
        cache.set(key, { expiresAt: now() + ttlMs, result });
        return result;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}

const runRuntimeStandardSiteSync = createCachedStandardSiteSync((did) =>
  syncStandardSiteDocumentsForProductCore(did, {
    listManagedListings: (productDid) =>
      listManagedAppListingsByAccountDid(productDid, { syncLegacy: false }),
    resolvePds: async (productDid) =>
      findPdsEndpoint(await resolveDidDocument(productDid)),
    listRecords: listRecordsPublic,
    getPublicationBindingByUri: getStandardSitePublicationBindingByUri,
    upsertUpdate: upsertProfileUpdate,
    reconcileUpdates: markMissingStandardSiteProfileUpdatesRemoved,
  })
);

/** Resolve the current PDS and mirror the newest public records into DB. */
export function syncStandardSiteDocumentsForProduct(
  did: string,
): Promise<StandardSiteSyncResult> {
  return runRuntimeStandardSiteSync(did);
}

function documentRkeyFromUri(uri: string, did: string): string | null {
  const prefix = `at://${did}/${STANDARD_SITE_DOCUMENT_NSID}/`;
  if (!uri.startsWith(prefix)) return null;
  const rkey = uri.slice(prefix.length);
  return rkey && !rkey.includes("/") && isStandardSiteRkey(rkey) ? rkey : null;
}

function emptyResult(managed: boolean): StandardSiteSyncResult {
  return {
    managed,
    recordsSeen: 0,
    recordsSynced: 0,
    recordsSkipped: 0,
  };
}

function evictExpiredAndOldest(
  cache: Map<string, { expiresAt: number; result: StandardSiteSyncResult }>,
  now: number,
): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= STANDARD_SITE_SYNC_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
