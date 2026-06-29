import {
  type BlobRef,
  PROFILE_NSID,
  type ProfileRecord,
  validateProfile,
} from "./lexicons.ts";
import { getRecordPublic, putProfileRecord } from "./pds.ts";
import { upsertProfile } from "./registry.ts";

/**
 * Legacy user-profile publisher. Ordinary reviewer sign-in no longer calls
 * this; normal review identity comes from ATProto/Bluesky profile data and
 * ATStore-compatible review records.
 */
interface EnsureUserProfileRecordInput {
  did: string;
  handle: string;
  pdsUrl: string;
  fallbackName?: string | null;
  fallbackDescription?: string | null;
  fallbackAvatar?: BlobRef | null;
}

function blobCid(blob: BlobRef | undefined): string | null {
  return blob?.ref.$link ?? null;
}

function blobMime(blob: BlobRef | undefined): string | null {
  return blob?.mimeType ?? null;
}

function recordCreatedAt(record: ProfileRecord): number {
  const parsed = Date.parse(record.createdAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

async function mirrorUserProfileRecord(input: {
  did: string;
  handle: string;
  pdsUrl: string;
  record: ProfileRecord;
  recordCid: string;
  recordRev?: string | null;
}): Promise<void> {
  await upsertProfile({
    did: input.did,
    handle: input.handle,
    profileType: "user",
    name: input.record.name,
    description: input.record.description,
    mainLink: input.record.mainLink ?? null,
    iosLink: input.record.iosLink ?? null,
    androidLink: input.record.androidLink ?? null,
    categories: input.record.categories ?? [],
    subcategories: input.record.subcategories ?? [],
    links: input.record.links ?? [],
    lexicons: input.record.lexicons ?? null,
    accountIndicators: input.record.accountIndicators ?? [],
    screenshots: input.record.screenshots ?? [],
    avatarCid: blobCid(input.record.avatar),
    avatarMime: blobMime(input.record.avatar),
    bannerCid: blobCid(input.record.banner),
    bannerMime: blobMime(input.record.banner),
    iconCid: blobCid(input.record.icon),
    iconMime: blobMime(input.record.icon),
    iconBwCid: blobCid(input.record.iconBw),
    iconBwMime: blobMime(input.record.iconBw),
    pdsUrl: input.pdsUrl,
    recordCid: input.recordCid,
    recordRev: input.recordRev ?? input.recordCid,
    createdAt: recordCreatedAt(input.record),
  });
}

export async function ensureUserProfileRecord(
  input: EnsureUserProfileRecordInput,
): Promise<void> {
  const existing = await getRecordPublic(
    input.pdsUrl,
    input.did,
    PROFILE_NSID,
    "self",
  );

  if (existing) {
    const validation = validateProfile(existing.value);
    if (
      validation.ok && validation.value &&
      validation.value.profileType === "user"
    ) {
      await mirrorUserProfileRecord({
        did: input.did,
        handle: input.handle,
        pdsUrl: input.pdsUrl,
        record: validation.value,
        recordCid: existing.cid,
      });
    }
    return;
  }

  const now = new Date().toISOString();
  const draft: ProfileRecord = {
    profileType: "user",
    name: input.fallbackName?.trim() || input.handle,
    description: input.fallbackDescription?.trim() ?? "",
    avatar: input.fallbackAvatar ?? undefined,
    createdAt: now,
  };
  const validation = validateProfile(draft);
  if (!validation.ok || !validation.value) {
    throw new Error(`invalid user profile: ${validation.error}`);
  }
  const put = await putProfileRecord(input.did, input.pdsUrl, validation.value);
  await mirrorUserProfileRecord({
    did: input.did,
    handle: input.handle,
    pdsUrl: input.pdsUrl,
    record: validation.value,
    recordCid: put.cid,
    recordRev: put.commit?.rev ?? put.cid,
  });
}
