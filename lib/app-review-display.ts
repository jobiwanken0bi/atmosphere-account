import { type AppUserRow, listAppUsersByDids } from "./account-types.ts";
import type { AppMirroredReview } from "./app-directory.ts";
import { bskyCdnAvatarUrl } from "./avatar.ts";
import { getProfileMicroblogViewer } from "./bsky-clients.ts";
import { resolveIdentity } from "./identity.ts";

const DID_HANDLE_CACHE_TTL_MS = 30 * 60 * 1000;
const DID_HANDLE_CACHE_MAX = 500;
const didHandleCache = new Map<
  string,
  { value: string | null; expiresAt: number }
>();

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
  const unresolvedDids = uniqueAuthorDids.filter((did) => !appUsers.has(did));
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
        resolvedHandle: resolvedHandles.get(did) ?? null,
      }),
    ]),
  );
}

export function reviewAuthorIdentity(input: {
  did: string;
  appUser: AppUserRow | null;
  resolvedHandle: string | null;
}): ReviewAuthorIdentity {
  const handle = input.appUser?.handle ?? input.resolvedHandle;
  return {
    handle,
    name: input.appUser?.displayName ?? null,
    avatarUrl: input.appUser?.avatarCid && input.appUser.avatarMime
      ? bskyCdnAvatarUrl(input.did, input.appUser.avatarCid)
      : null,
    href: microblogProfileHref(handle, input.appUser?.bskyClientId),
  };
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
