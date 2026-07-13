import { listAppUsersByDids } from "./account-types.ts";
import type { AppMirroredReview } from "./app-directory.ts";
import { bskyCdnAvatarUrl } from "./avatar.ts";
import { resolveIdentity } from "./identity.ts";
import { listProfilesByDids } from "./registry.ts";

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

export async function enrichAppMirroredReviews(
  reviews: AppMirroredReview[],
): Promise<DisplayAppReview[]> {
  const authorDids = uniqueDids(reviews.map((review) => review.authorDid));
  const [appUsers, profiles] = await Promise.all([
    listAppUsersByDids(authorDids).catch(() => new Map()),
    listProfilesByDids(authorDids).catch(() => new Map()),
  ]);
  const unresolvedDids = authorDids.filter((did) =>
    !appUsers.has(did) && !profiles.has(did)
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
  return reviews.map((review) => {
    const appUser = appUsers.get(review.authorDid) ?? null;
    const profile = profiles.get(review.authorDid) ?? null;
    const authorHandle = appUser?.handle ?? profile?.handle ??
      resolvedHandles.get(review.authorDid) ?? null;
    const authorName = appUser?.displayName ?? profile?.name ?? null;
    const authorAvatarUrl = appUser?.avatarCid && appUser.avatarMime
      ? bskyCdnAvatarUrl(review.authorDid, appUser.avatarCid)
      : profile?.avatarCid
      ? bskyCdnAvatarUrl(review.authorDid, profile.avatarCid)
      : null;
    return {
      ...review,
      authorHandle,
      authorName,
      authorAvatarUrl,
      authorHref: microblogProfileHref(authorHandle),
    };
  });
}

function uniqueDids(dids: string[]): string[] {
  return [...new Set(dids.map((did) => did.trim()).filter(Boolean))];
}

function microblogProfileHref(handle: string | null): string | null {
  const clean = handle?.replace(/^@/, "").trim();
  return clean ? `https://bsky.app/profile/${encodeURIComponent(clean)}` : null;
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
