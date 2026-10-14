/** Shared by the server cache and the landing-page counter. */
export interface AccountCountSnapshot {
  count: number;
  updatedAt: string;
  checkedAt: string;
}

export const ACCOUNT_COUNT_REFRESH_MS = 60_000;
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isAccountCountSnapshot(
  value: unknown,
  now = Date.now(),
): value is AccountCountSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return Number.isSafeInteger(snapshot.count) &&
    Number(snapshot.count) >= 1_000_000 &&
    Number(snapshot.count) <= 10_000_000_000 &&
    [snapshot.updatedAt, snapshot.checkedAt].every((date) =>
      typeof date === "string" && Number.isFinite(Date.parse(date)) &&
      Date.parse(date) <= now + 60_000 &&
      now - Date.parse(date) <= MAX_SNAPSHOT_AGE_MS
    );
}
