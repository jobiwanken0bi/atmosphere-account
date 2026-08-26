/**
 * Authed PDS XRPC helpers built on top of `authedFetch` from lib/oauth.ts.
 * One thin function per XRPC method we actually call from the registry.
 */
import { authedFetch } from "./oauth.ts";
import {
  assertPublicDnsHostname,
  normalizeServiceEndpoint,
} from "./identity.ts";
import { ATPROTO_FETCH_TIMEOUT_MS, IS_DEV } from "./env.ts";
import { isJsonMediaType, readResponseTextWithLimit } from "./security.ts";
import {
  type BlobRef,
  PROFILE_NSID,
  type ProfileRecord,
  REVIEW_NSID,
  type ReviewRecord,
  UPDATE_NSID,
  type UpdateRecord,
} from "./lexicons.ts";

export interface PutRecordResult {
  uri: string;
  cid: string;
  commit?: { cid: string; rev: string };
  validationStatus?: string;
}

const PDS_ERROR_BODY_MAX_BYTES = 8 * 1024;
const PDS_WRITE_RESPONSE_MAX_BYTES = 256 * 1024;
const PDS_RECORD_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const PDS_LIST_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

async function readPdsErrorBody(response: Response): Promise<string> {
  const bounded = await readResponseTextWithLimit(
    response,
    PDS_ERROR_BODY_MAX_BYTES,
  );
  return bounded.ok ? bounded.text : bounded.error;
}

export async function readPdsErrorBodyForTest(
  response: Response,
): Promise<string> {
  return await readPdsErrorBody(response);
}

async function readPdsJson<T>(
  response: Response,
  maxBytes: number,
): Promise<T> {
  if (!isJsonMediaType(response.headers.get("content-type"))) {
    await response.body?.cancel().catch(() => {});
    throw new Error("PDS returned a non-JSON response");
  }
  const bounded = await readResponseTextWithLimit(response, maxBytes);
  if (!bounded.ok) throw new Error(`PDS JSON ${bounded.error}`);
  try {
    return JSON.parse(bounded.text) as T;
  } catch {
    throw new Error("PDS returned invalid JSON");
  }
}

export async function readPdsJsonForTest(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  return await readPdsJson(response, maxBytes);
}

async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(input);
  if (!IS_DEV) await assertPublicDnsHostname(url.hostname);
  return await fetch(url, {
    ...init,
    redirect: init.redirect ?? "manual",
    signal: init.signal ?? AbortSignal.timeout(ATPROTO_FETCH_TIMEOUT_MS),
  });
}

export class PublicRecordFetchError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(
      `getRecord failed: HTTP ${status}${
        body.trim() ? `: ${body.trim().slice(0, 240)}` : ""
      }`,
    );
    this.name = "PublicRecordFetchError";
  }
}

export class PdsRecordWriteError extends Error {
  constructor(
    readonly operation: "createRecord" | "putRecord" | "deleteRecord",
    readonly status: number,
    readonly body: string,
    readonly retryAfter: string | null = null,
  ) {
    super(
      `${operation} failed: HTTP ${status}${
        body.trim() ? `: ${body.trim().slice(0, 240)}` : ""
      }`,
    );
    this.name = "PdsRecordWriteError";
  }
}

export class PdsRecordReadError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly retryAfter: string | null = null,
  ) {
    super(
      `getRecord failed: HTTP ${status}${
        body.trim() ? `: ${body.trim().slice(0, 240)}` : ""
      }`,
    );
    this.name = "PdsRecordReadError";
  }
}

export class PdsBlobUploadError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly retryAfter: string | null = null,
  ) {
    super(
      `uploadBlob failed: HTTP ${status}${
        body.trim() ? `: ${body.trim().slice(0, 240)}` : ""
      }`,
    );
    this.name = "PdsBlobUploadError";
  }
}

export function isPdsScopeMissingError(value: unknown): boolean {
  if (!(value instanceof PdsRecordWriteError) || value.status !== 403) {
    return false;
  }
  try {
    const parsed = JSON.parse(value.body || "null") as
      | { error?: unknown }
      | null;
    return parsed?.error === "ScopeMissingError";
  } catch {
    return false;
  }
}

/**
 * Create a record with an optional caller-selected rkey. Unlike putRecord,
 * this method requires only the collection's create permission and will not
 * silently turn an idempotent create into an update.
 */
export async function createRecord(
  did: string,
  pdsUrl: string,
  collection: string,
  record: Record<string, unknown>,
  rkey?: string,
): Promise<PutRecordResult> {
  const url = `${
    normalizeServiceEndpoint(pdsUrl)
  }/xrpc/com.atproto.repo.createRecord`;
  const res = await authedFetch(did, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repo: did,
      collection,
      ...(rkey ? { rkey } : {}),
      record: { ...record, $type: collection },
    }),
  });
  if (!res.ok) {
    const text = await readPdsErrorBody(res);
    throw new PdsRecordWriteError(
      "createRecord",
      res.status,
      text,
      res.headers.get("retry-after"),
    );
  }
  return await readPdsJson<PutRecordResult>(res, PDS_WRITE_RESPONSE_MAX_BYTES);
}

export async function putProfileRecord(
  did: string,
  pdsUrl: string,
  record: ProfileRecord,
): Promise<PutRecordResult> {
  const url = `${
    normalizeServiceEndpoint(pdsUrl)
  }/xrpc/com.atproto.repo.putRecord`;
  const res = await authedFetch(did, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repo: did,
      collection: PROFILE_NSID,
      rkey: "self",
      record: { ...record, $type: PROFILE_NSID },
    }),
  });
  if (!res.ok) {
    const text = await readPdsErrorBody(res);
    throw new PdsRecordWriteError(
      "putRecord",
      res.status,
      text,
      res.headers.get("retry-after"),
    );
  }
  return await readPdsJson<PutRecordResult>(res, PDS_WRITE_RESPONSE_MAX_BYTES);
}

export async function getProfileRecord(
  did: string,
  pdsUrl: string,
): Promise<ProfileRecord | null> {
  const url = new URL(
    `${normalizeServiceEndpoint(pdsUrl)}/xrpc/com.atproto.repo.getRecord`,
  );
  url.searchParams.set("repo", did);
  url.searchParams.set("collection", PROFILE_NSID);
  url.searchParams.set("rkey", "self");
  const res = await authedFetch(did, url.toString());
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await readPdsErrorBody(res);
    throw new PdsRecordReadError(
      res.status,
      text,
      res.headers.get("retry-after"),
    );
  }
  const json = await readPdsJson<{ value?: unknown }>(
    res,
    PDS_RECORD_RESPONSE_MAX_BYTES,
  );
  return json.value && typeof json.value === "object"
    ? json.value as ProfileRecord
    : null;
}

export async function putReviewRecord(
  did: string,
  pdsUrl: string,
  rkey: string,
  record: ReviewRecord,
): Promise<PutRecordResult> {
  return await putRecord(
    did,
    pdsUrl,
    REVIEW_NSID,
    rkey,
    record as unknown as Record<string, unknown>,
  );
}

export async function putUpdateRecord(
  did: string,
  pdsUrl: string,
  rkey: string,
  record: UpdateRecord,
): Promise<PutRecordResult> {
  return await putRecord(
    did,
    pdsUrl,
    UPDATE_NSID,
    rkey,
    record as unknown as Record<string, unknown>,
  );
}

/**
 * Generic putRecord helper for arbitrary collections (e.g. our curated
 * featured directory). Always uses the authed user's own repo.
 */
export async function putRecord(
  did: string,
  pdsUrl: string,
  collection: string,
  rkey: string,
  record: Record<string, unknown>,
  options: { swapRecord?: string } = {},
): Promise<PutRecordResult> {
  const url = `${
    normalizeServiceEndpoint(pdsUrl)
  }/xrpc/com.atproto.repo.putRecord`;
  const res = await authedFetch(did, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repo: did,
      collection,
      rkey,
      record: { ...record, $type: collection },
      ...(options.swapRecord ? { swapRecord: options.swapRecord } : {}),
    }),
  });
  if (!res.ok) {
    const text = await readPdsErrorBody(res);
    throw new PdsRecordWriteError(
      "putRecord",
      res.status,
      text,
      res.headers.get("retry-after"),
    );
  }
  return await readPdsJson<PutRecordResult>(res, PDS_WRITE_RESPONSE_MAX_BYTES);
}

export async function deleteProfileRecord(
  did: string,
  pdsUrl: string,
): Promise<void> {
  await deleteRecord(did, pdsUrl, PROFILE_NSID, "self");
}

export async function deleteReviewRecord(
  did: string,
  pdsUrl: string,
  rkey: string,
): Promise<void> {
  await deleteRecord(did, pdsUrl, REVIEW_NSID, rkey);
}

export async function deleteUpdateRecord(
  did: string,
  pdsUrl: string,
  rkey: string,
): Promise<void> {
  await deleteRecord(did, pdsUrl, UPDATE_NSID, rkey);
}

/**
 * Generic deleteRecord helper for any collection in the user's repo.
 * Returns silently on 404 so callers can call it unconditionally to
 * "make sure this record doesn't exist" (e.g. when toggling off a
 * sibling record like the license). Other failures throw.
 */
export async function deleteRecord(
  did: string,
  pdsUrl: string,
  collection: string,
  rkey: string,
  options: { swapRecord?: string } = {},
): Promise<void> {
  const url = `${
    normalizeServiceEndpoint(pdsUrl)
  }/xrpc/com.atproto.repo.deleteRecord`;
  const res = await authedFetch(did, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repo: did,
      collection,
      rkey,
      ...(options.swapRecord ? { swapRecord: options.swapRecord } : {}),
    }),
  });
  if (res.status === 404) return;
  if (!res.ok) {
    const text = await readPdsErrorBody(res);
    throw new PdsRecordWriteError(
      "deleteRecord",
      res.status,
      text,
      res.headers.get("retry-after"),
    );
  }
}

export async function uploadBlob(
  did: string,
  pdsUrl: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<BlobRef> {
  const url = `${
    normalizeServiceEndpoint(pdsUrl)
  }/xrpc/com.atproto.repo.uploadBlob`;
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const res = await authedFetch(did, url, {
    method: "POST",
    headers: { "content-type": mimeType },
    body: buf,
  });
  if (!res.ok) {
    const text = await readPdsErrorBody(res);
    throw new PdsBlobUploadError(
      res.status,
      text,
      res.headers.get("retry-after"),
    );
  }
  const json = await readPdsJson<{ blob: BlobRef }>(
    res,
    PDS_WRITE_RESPONSE_MAX_BYTES,
  );
  return json.blob;
}

/**
 * Publicly describe the collections currently present in a repository.
 * This is useful for suggestions, but it is not proof of an app's complete
 * read/write behavior: apps often write to their users' repositories and
 * public reads leave no repository artifact at all.
 */
export async function describeRepoCollectionsPublic(
  pdsUrl: string,
  did: string,
): Promise<string[]> {
  const url = new URL(
    `${normalizeServiceEndpoint(pdsUrl)}/xrpc/com.atproto.repo.describeRepo`,
  );
  url.searchParams.set("repo", did);
  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) {
    throw new Error(`describeRepo failed: HTTP ${res.status}`);
  }
  const body = await readPdsJson<{ collections?: unknown }>(
    res,
    PDS_RECORD_RESPONSE_MAX_BYTES,
  );
  return Array.isArray(body.collections)
    ? body.collections.filter((item): item is string =>
      typeof item === "string" && item.trim().length > 0
    )
    : [];
}

/** Fetch a record from any PDS without auth (records are public). */
export async function getRecordPublic(
  pdsUrl: string,
  did: string,
  collection: string,
  rkey: string,
): Promise<{ uri: string; cid: string; value: unknown } | null> {
  const url = new URL(
    `${normalizeServiceEndpoint(pdsUrl)}/xrpc/com.atproto.repo.getRecord`,
  );
  url.searchParams.set("repo", did);
  url.searchParams.set("collection", collection);
  url.searchParams.set("rkey", rkey);
  const res = await fetchWithTimeout(url.toString());
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new PublicRecordFetchError(
      res.status,
      await readPdsErrorBody(res),
    );
  }
  return await readPdsJson<{ uri: string; cid: string; value: unknown }>(
    res,
    PDS_RECORD_RESPONSE_MAX_BYTES,
  );
}

export async function listRecordsPublic(
  pdsUrl: string,
  did: string,
  collection: string,
  opts: { limit?: number; reverse?: boolean; cursor?: string } = {},
): Promise<
  {
    cursor?: string;
    records: Array<{ uri: string; cid: string; value: unknown }>;
  }
> {
  const url = new URL(
    `${normalizeServiceEndpoint(pdsUrl)}/xrpc/com.atproto.repo.listRecords`,
  );
  url.searchParams.set("repo", did);
  url.searchParams.set("collection", collection);
  url.searchParams.set(
    "limit",
    String(Math.max(1, Math.min(opts.limit ?? 25, 100))),
  );
  if (opts.reverse) url.searchParams.set("reverse", "true");
  if (opts.cursor) url.searchParams.set("cursor", opts.cursor);
  const res = await fetchWithTimeout(url.toString());
  if (res.status === 404) return { records: [] };
  if (!res.ok) throw new Error(`listRecords failed: HTTP ${res.status}`);
  return await readPdsJson<{
    cursor?: string;
    records: Array<{ uri: string; cid: string; value: unknown }>;
  }>(res, PDS_LIST_RESPONSE_MAX_BYTES);
}

/** Public: fetch app.bsky.actor.profile to pre-fill the create form. */
export async function getBskyProfile(
  pdsUrl: string,
  did: string,
): Promise<
  { displayName?: string; description?: string; avatar?: BlobRef } | null
> {
  const rec = await getRecordPublic(
    pdsUrl,
    did,
    "app.bsky.actor.profile",
    "self",
  );
  if (!rec) return null;
  const v = rec.value as Record<string, unknown>;
  return {
    displayName: typeof v.displayName === "string" ? v.displayName : undefined,
    description: typeof v.description === "string" ? v.description : undefined,
    avatar: v.avatar as BlobRef | undefined,
  };
}

export async function fetchBlobPublic(
  pdsUrl: string,
  did: string,
  cid: string,
): Promise<Response> {
  const url = new URL(
    `${normalizeServiceEndpoint(pdsUrl)}/xrpc/com.atproto.sync.getBlob`,
  );
  url.searchParams.set("did", did);
  url.searchParams.set("cid", cid);
  return await fetchWithTimeout(url.toString(), {
    headers: { accept: "*/*" },
  });
}
