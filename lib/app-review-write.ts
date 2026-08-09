import { createAtprotoTid, isAtprotoTid } from "./tid.ts";

/** Create the client-owned key for one new shared-app review attempt. */
export function createAppReviewRkey(nowMs = Date.now()): string {
  return createAtprotoTid(nowMs);
}

export function isAppReviewRkey(value: unknown): value is string {
  return typeof value === "string" && isAtprotoTid(value);
}

/**
 * Resolve the repository key at the API boundary. Existing reviews keep the
 * key of their remote record, including records created before the lexicon
 * required TIDs. A new review must supply the valid client-generated TID that
 * identifies its write attempt; missing or malformed input fails closed.
 *
 * When a candidate is supplied for an existing review it is still validated,
 * even though the existing remote key wins. This keeps malformed request data
 * from being silently accepted.
 */
export function appReviewRkeyForWrite(
  existingRkey?: string | null,
  requestedRkey?: unknown,
): string | null {
  if (requestedRkey !== undefined && !isAppReviewRkey(requestedRkey)) {
    return null;
  }
  const existing = existingRkey?.trim();
  return existing || (isAppReviewRkey(requestedRkey) ? requestedRkey : null);
}
