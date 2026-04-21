/**
 * Authed PDS XRPC helpers built on top of `authedFetch` from lib/oauth.ts.
 * One thin function per XRPC method we actually call from the registry.
 */
import { authedFetch } from "./oauth.ts";
import { type BlobRef, PROFILE_NSID, type ProfileRecord } from "./lexicons.ts";

export interface PutRecordResult {
  uri: string;
  cid: string;
  commit?: { cid: string; rev: string };
  validationStatus?: string;
}

export async function putProfileRecord(
  did: string,
  pdsUrl: string,
  record: ProfileRecord,
): Promise<PutRecordResult> {
  const url = `${pdsUrl.replace(/\/$/, "")}/xrpc/com.atproto.repo.putRecord`;
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
    const text = await res.text();
    throw new Error(`putRecord failed: HTTP ${res.status}: ${text}`);
  }
  return await res.json() as PutRecordResult;
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
): Promise<PutRecordResult> {
  const url = `${pdsUrl.replace(/\/$/, "")}/xrpc/com.atproto.repo.putRecord`;
  const res = await authedFetch(did, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repo: did,
      collection,
      rkey,
      record: { ...record, $type: collection },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`putRecord failed: HTTP ${res.status}: ${text}`);
  }
  return await res.json() as PutRecordResult;
}

export async function deleteProfileRecord(
  did: string,
  pdsUrl: string,
): Promise<void> {
  await deleteRecord(did, pdsUrl, PROFILE_NSID, "self");
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
): Promise<void> {
  const url = `${pdsUrl.replace(/\/$/, "")}/xrpc/com.atproto.repo.deleteRecord`;
  const res = await authedFetch(did, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo: did, collection, rkey }),
  });
  if (res.status === 404) return;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`deleteRecord failed: HTTP ${res.status}: ${text}`);
  }
}

export async function uploadBlob(
  did: string,
  pdsUrl: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<BlobRef> {
  const url = `${pdsUrl.replace(/\/$/, "")}/xrpc/com.atproto.repo.uploadBlob`;
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const res = await authedFetch(did, url, {
    method: "POST",
    headers: { "content-type": mimeType },
    body: buf,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`uploadBlob failed: HTTP ${res.status}: ${text}`);
  }
  const json = await res.json() as { blob: BlobRef };
  return json.blob;
}

/** Fetch a record from any PDS without auth (records are public). */
export async function getRecordPublic(
  pdsUrl: string,
  did: string,
  collection: string,
  rkey: string,
): Promise<{ uri: string; cid: string; value: unknown } | null> {
  const url = new URL(
    `${pdsUrl.replace(/\/$/, "")}/xrpc/com.atproto.repo.getRecord`,
  );
  url.searchParams.set("repo", did);
  url.searchParams.set("collection", collection);
  url.searchParams.set("rkey", rkey);
  const res = await fetch(url.toString());
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getRecord failed: HTTP ${res.status}`);
  return await res.json() as { uri: string; cid: string; value: unknown };
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
    `${pdsUrl.replace(/\/$/, "")}/xrpc/com.atproto.sync.getBlob`,
  );
  url.searchParams.set("did", did);
  url.searchParams.set("cid", cid);
  return await fetch(url.toString());
}
