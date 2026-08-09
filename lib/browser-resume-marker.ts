const BROWSER_RESUME_MARKER_TTL_MS = 30 * 60 * 1_000;

/**
 * Create the non-secret, same-tab half of a browser action resume handoff.
 *
 * The caller's sessionStorage key carries the account/resource binding. The
 * stored value deliberately contains only freshness information, so no DID,
 * repository locator, draft key, or reusable authorization material is
 * persisted in clear text.
 */
export function browserResumeMarkerValue(savedAt = Date.now()): string {
  return JSON.stringify({ savedAt });
}

/** Accept only a fresh marker in the intentionally minimal wire format. */
export function isFreshBrowserResumeMarker(
  value: string | null,
  now = Date.now(),
): boolean {
  if (!value) return false;
  try {
    const marker = JSON.parse(value) as unknown;
    if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
      return false;
    }
    const record = marker as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || !("savedAt" in record)) {
      return false;
    }
    return typeof record.savedAt === "number" &&
      Number.isFinite(record.savedAt) &&
      record.savedAt <= now &&
      now - record.savedAt <= BROWSER_RESUME_MARKER_TTL_MS;
  } catch {
    return false;
  }
}
