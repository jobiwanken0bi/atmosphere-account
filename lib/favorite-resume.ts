export type FavoriteResumeIntent = "save" | "remove";
export type FavoriteMutationIntent = FavoriteResumeIntent | "toggle";

const FAVORITE_RESUME_PROOF_TTL_MS = 30 * 60 * 1_000;

export function favoriteResumeProofKey(identifier: string): string {
  return `atmosphere:favorite-resume:${encodeURIComponent(identifier)}`;
}

export function favoriteResumeProofValue(
  intent: FavoriteResumeIntent,
  ownerDid: string | null,
  savedAt = Date.now(),
): string {
  return JSON.stringify({ intent, ownerDid, savedAt });
}

/** A query marker alone is never authority to write. It must be paired with
 * a fresh, same-tab proof armed when the person actually continues sign-in. */
export function isValidFavoriteResumeProof(
  value: string | null,
  intent: FavoriteResumeIntent,
  currentDid: string | null,
  now = Date.now(),
): boolean {
  if (!value) return false;
  try {
    const proof = JSON.parse(value) as Record<string, unknown>;
    if (
      proof.intent !== intent || typeof proof.savedAt !== "number" ||
      !Number.isFinite(proof.savedAt) || proof.savedAt > now ||
      now - proof.savedAt > FAVORITE_RESUME_PROOF_TTL_MS
    ) return false;
    if (proof.ownerDid === null) return true;
    return typeof proof.ownerDid === "string" && !!currentDid &&
      proof.ownerDid === currentDid;
  } catch {
    return false;
  }
}

export function favoriteResumeIntent(
  value: string | null | undefined,
): FavoriteResumeIntent | null {
  return value === "save" || value === "remove" ? value : null;
}

export function favoriteResumeReturnPath(
  identifier: string,
  intent: FavoriteResumeIntent,
): string {
  return `/apps/${encodeURIComponent(identifier)}?favorite=${intent}`;
}

export function favoriteTargetLiked(
  currentlyLiked: boolean,
  intent: FavoriteMutationIntent,
): boolean {
  if (intent === "save") return true;
  if (intent === "remove") return false;
  return !currentlyLiked;
}

export function favoriteRequestMethod(
  currentlyLiked: boolean,
  intent: FavoriteMutationIntent,
): "POST" | "DELETE" | null {
  const targetLiked = favoriteTargetLiked(currentlyLiked, intent);
  if (targetLiked === currentlyLiked) return null;
  return targetLiked ? "POST" : "DELETE";
}
