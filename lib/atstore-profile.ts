import { ATSTORE_PROFILE_NSID } from "./app-lexicons.ts";
import { getBskyProfile, getRecordPublic, putRecord } from "./pds.ts";

const ATSTORE_PROFILE_RKEY = "self";
const MAX_ATSTORE_DISPLAY_NAME = 640;

export async function ensureAtstoreReviewerProfile(input: {
  did: string;
  handle: string;
  pdsUrl: string;
}): Promise<void> {
  const existing = await getRecordPublic(
    input.pdsUrl,
    input.did,
    ATSTORE_PROFILE_NSID,
    ATSTORE_PROFILE_RKEY,
  ).catch(() => null);
  if (existing) return;

  const bskyProfile = await getBskyProfile(input.pdsUrl, input.did).catch(() =>
    null
  );
  const displayName = atstoreReviewerDisplayName(
    bskyProfile?.displayName,
    input.handle,
    input.did,
  );

  await putRecord(
    input.did,
    input.pdsUrl,
    ATSTORE_PROFILE_NSID,
    ATSTORE_PROFILE_RKEY,
    { displayName },
  );
}

export function atstoreReviewerDisplayName(
  bskyDisplayName: string | null | undefined,
  handle: string | null | undefined,
  did: string,
): string {
  return normalizeDisplayName(bskyDisplayName || handle || did);
}

function normalizeDisplayName(value: string): string {
  const trimmed = value.trim();
  return (trimmed || "Atmosphere user").slice(0, MAX_ATSTORE_DISPLAY_NAME);
}
