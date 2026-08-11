import { type AppUserRow, listAppUsersByDids } from "./account-types.ts";
import type { AppMirroredReview } from "./app-directory.ts";
import { bskyCdnAvatarUrl } from "./avatar.ts";
import { getProfileMicroblogViewer } from "./bsky-clients.ts";
import { isDid, isHandle, resolveIdentity } from "./identity.ts";
import { isJsonMediaType, readResponseTextWithLimit } from "./security.ts";

const DID_HANDLE_CACHE_TTL_MS = 30 * 60 * 1000;
const DID_HANDLE_CACHE_MAX = 500;
const REVIEW_PROFILE_CACHE_TTL_MS = 30 * 60 * 1000;
const REVIEW_PROFILE_CACHE_MAX = 500;
const REVIEW_PROFILE_BATCH_SIZE = 25;
const REVIEW_PROFILE_RESPONSE_MAX_BYTES = 512 * 1024;
const BSKY_PROFILES =
  "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles";
const didHandleCache = new Map<
  string,
  { value: string | null; expiresAt: number }
>();
const reviewProfileCache = new Map<
  string,
  { value: PublicReviewProfile | null; expiresAt: number }
>();

export interface PublicReviewProfile {
  did: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface DisplayAppReview extends AppMirroredReview {
  authorHandle: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  authorHref: string | null;
}

export interface ReviewAuthorIdentity {
  handle: string | null;
  name: string | null;
  avatarUrl: string | null;
  href: string | null;
}

export async function enrichAppMirroredReviews(
  reviews: AppMirroredReview[],
): Promise<DisplayAppReview[]> {
  const authorDids = uniqueDids(reviews.map((review) => review.authorDid));
  const identities = await loadReviewAuthorIdentities(authorDids);
  return reviews.map((review) => {
    const identity = identities.get(review.authorDid) ?? emptyAuthorIdentity();
    return {
      ...review,
      authorHandle: identity.handle,
      authorName: identity.name,
      authorAvatarUrl: identity.avatarUrl,
      authorHref: identity.href,
    };
  });
}

/**
 * Resolve reviewer presentation from the Bluesky-derived local account cache.
 * Legacy Atmosphere user-profile records intentionally do not participate:
 * reviewers keep their microblog identity while app and host profiles remain
 * separate product identities.
 */
export async function loadReviewAuthorIdentities(
  authorDids: string[],
): Promise<Map<string, ReviewAuthorIdentity>> {
  const uniqueAuthorDids = uniqueDids(authorDids);
  const appUsers = await listAppUsersByDids(uniqueAuthorDids).catch(() =>
    new Map<string, AppUserRow>()
  );
  const liveProfiles = await loadPublicReviewProfiles(
    uniqueAuthorDids.filter((did) => {
      const appUser = appUsers.get(did);
      return !appUser?.handle || !appUser.displayName ||
        !appUser.avatarCid || !appUser.avatarMime;
    }),
  );
  const unresolvedDids = uniqueAuthorDids.filter((did) =>
    !appUsers.get(did)?.handle && !liveProfiles.get(did)?.handle
  );
  const resolvedHandles = new Map(
    await Promise.all(
      unresolvedDids.map(
        async (did): Promise<[string, string | null]> => [
          did,
          await resolveHandleForDid(did),
        ],
      ),
    ),
  );
  return new Map(
    uniqueAuthorDids.map((did) => [
      did,
      reviewAuthorIdentity({
        did,
        appUser: appUsers.get(did) ?? null,
        liveProfile: liveProfiles.get(did) ?? null,
        resolvedHandle: resolvedHandles.get(did) ?? null,
      }),
    ]),
  );
}

export function reviewAuthorIdentity(input: {
  did: string;
  appUser: AppUserRow | null;
  liveProfile?: PublicReviewProfile | null;
  resolvedHandle: string | null;
}): ReviewAuthorIdentity {
  const handle = input.liveProfile?.handle ?? input.appUser?.handle ??
    input.resolvedHandle;
  return {
    handle,
    name: input.liveProfile?.displayName ?? input.appUser?.displayName ?? null,
    avatarUrl: input.liveProfile?.avatarUrl ??
      (input.appUser?.avatarCid && input.appUser.avatarMime
        ? bskyCdnAvatarUrl(input.did, input.appUser.avatarCid)
        : null),
    href: microblogProfileHref(handle, input.appUser?.bskyClientId),
  };
}

async function loadPublicReviewProfiles(
  authorDids: string[],
): Promise<Map<string, PublicReviewProfile>> {
  const profiles = new Map<string, PublicReviewProfile>();
  const uncached: string[] = [];
  const now = Date.now();
  for (const did of uniqueDids(authorDids)) {
    const cached = reviewProfileCache.get(did);
    if (cached && cached.expiresAt > now) {
      if (cached.value) profiles.set(did, cached.value);
      continue;
    }
    if (cached) reviewProfileCache.delete(did);
    uncached.push(did);
  }

  const batches = chunk(uncached, REVIEW_PROFILE_BATCH_SIZE);
  await Promise.all(batches.map(async (dids) => {
    try {
      const fetched = await fetchPublicReviewProfiles(dids);
      for (const did of dids) {
        const profile = fetched.get(did) ?? null;
        rememberReviewProfile(did, profile);
        if (profile) profiles.set(did, profile);
      }
    } catch {
      // A profile lookup is presentation-only. Keep cached/local identity when
      // the public Bluesky AppView is unavailable.
    }
  }));
  return profiles;
}

async function fetchPublicReviewProfiles(
  authorDids: string[],
  fetcher: typeof fetch = fetch,
): Promise<Map<string, PublicReviewProfile>> {
  const requestedDids = uniqueDids(authorDids).filter(isDid).slice(
    0,
    REVIEW_PROFILE_BATCH_SIZE,
  );
  if (requestedDids.length === 0) return new Map();
  const requested = new Set(requestedDids);
  const url = new URL(BSKY_PROFILES);
  for (const did of requestedDids) url.searchParams.append("actors", did);
  const response = await fetcher(url, {
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(3500),
  });
  if (!response.ok) throw new Error(`review profiles HTTP ${response.status}`);
  if (!isJsonMediaType(response.headers.get("content-type"))) {
    await response.body?.cancel().catch(() => {});
    throw new Error("review profiles returned a non-JSON response");
  }
  const body = await readResponseTextWithLimit(
    response,
    REVIEW_PROFILE_RESPONSE_MAX_BYTES,
  );
  if (!body.ok) throw new Error(`review profiles ${body.error}`);
  const json = JSON.parse(body.text) as { profiles?: unknown };
  if (!Array.isArray(json.profiles)) {
    throw new Error("review profiles response is malformed");
  }
  const profiles = new Map<string, PublicReviewProfile>();
  for (const candidate of json.profiles.slice(0, REVIEW_PROFILE_BATCH_SIZE)) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Record<string, unknown>;
    const did = typeof row.did === "string" ? row.did : "";
    const handle = typeof row.handle === "string"
      ? row.handle.trim().toLowerCase()
      : "";
    if (!requested.has(did) || !isDid(did) || !isHandle(handle)) continue;
    const displayName = typeof row.displayName === "string" &&
        row.displayName.trim()
      ? row.displayName.trim().slice(0, 80)
      : null;
    profiles.set(did, {
      did,
      handle,
      displayName,
      avatarUrl: normalizeBskyAvatarUrl(row.avatar),
    });
  }
  return profiles;
}

export async function fetchPublicReviewProfilesForTest(
  authorDids: string[],
  fetcher: typeof fetch,
): Promise<Map<string, PublicReviewProfile>> {
  return await fetchPublicReviewProfiles(authorDids, fetcher);
}

function normalizeBskyAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.username || url.password ||
      url.hostname !== "cdn.bsky.app" ||
      !url.pathname.startsWith("/img/avatar/")
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function rememberReviewProfile(
  did: string,
  value: PublicReviewProfile | null,
): void {
  if (reviewProfileCache.size >= REVIEW_PROFILE_CACHE_MAX) {
    const oldest = reviewProfileCache.keys().next().value;
    if (oldest) reviewProfileCache.delete(oldest);
  }
  reviewProfileCache.set(did, {
    value,
    expiresAt: Date.now() + REVIEW_PROFILE_CACHE_TTL_MS,
  });
}

function uniqueDids(dids: string[]): string[] {
  return [...new Set(dids.map((did) => did.trim()).filter(Boolean))];
}

function microblogProfileHref(
  handle: string | null,
  clientId?: string | null,
): string | null {
  const clean = handle?.replace(/^@/, "").trim();
  return clean ? getProfileMicroblogViewer(clientId).profileUrl(clean) : null;
}

function emptyAuthorIdentity(): ReviewAuthorIdentity {
  return { handle: null, name: null, avatarUrl: null, href: null };
}

async function resolveHandleForDid(did: string): Promise<string | null> {
  const cached = didHandleCache.get(did);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) didHandleCache.delete(did);
  try {
    const identity = await resolveIdentity(did);
    const value = identity.handle.startsWith("did:") ? null : identity.handle;
    rememberDidHandle(did, value);
    return value;
  } catch {
    rememberDidHandle(did, null);
    return null;
  }
}

function rememberDidHandle(did: string, value: string | null): void {
  if (didHandleCache.size >= DID_HANDLE_CACHE_MAX) {
    const oldest = didHandleCache.keys().next().value;
    if (oldest) didHandleCache.delete(oldest);
  }
  didHandleCache.set(did, {
    value,
    expiresAt: Date.now() + DID_HANDLE_CACHE_TTL_MS,
  });
}
