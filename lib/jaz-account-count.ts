import {
  ACCOUNT_COUNT_REFRESH_MS,
  type AccountCountSnapshot,
  isAccountCountSnapshot,
} from "./atmosphere-account-count.ts";
import { readResponseTextWithLimit } from "./security.ts";

export const JAZ_ACCOUNT_COUNT_URL = "https://bsky-search.jazco.io/stats";
const MAX_SOURCE_AGE_MS = 24 * 60 * 60 * 1000;

/** Coalesce visitors into one source request per minute, including retries.
 * Keep the last verified count through brief tracker outages. */
export function createJazAccountCounter(
  { request = fetch, now = Date.now, timeoutMs = 2_000 }: {
    request?: typeof fetch;
    now?: () => number;
    timeoutMs?: number;
  } = {},
) {
  let snapshot: AccountCountSnapshot | null = null;
  let pending: Promise<AccountCountSnapshot | null> | null = null;
  let refreshAt = 0;

  async function refresh(): Promise<AccountCountSnapshot | null> {
    try {
      const response = await request(JAZ_ACCOUNT_COUNT_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
      if (!response.ok) throw new Error("Account count unavailable");
      // The stats endpoint also includes historical series (~250 KB today).
      const body = await readResponseTextWithLimit(response, 1_048_576);
      if (!body.ok) throw new Error("Invalid account count response");
      const data = JSON.parse(body.text);
      const at = now();
      const updatedAt = typeof data?.updated_at === "string"
        ? Date.parse(data.updated_at)
        : NaN;
      const next: AccountCountSnapshot = {
        count: data?.total_users,
        updatedAt: Number.isFinite(updatedAt)
          ? new Date(updatedAt).toISOString()
          : "",
        checkedAt: new Date(at).toISOString(),
      };
      if (
        !isAccountCountSnapshot(next, at) ||
        at - updatedAt > MAX_SOURCE_AGE_MS
      ) throw new Error("Invalid account count");
      // Allow genuine count decreases, but never regress to an older snapshot.
      if (!snapshot || updatedAt >= Date.parse(snapshot.updatedAt)) {
        snapshot = next;
      }
    } catch {
      // The invitation remains usable even if the tracker is unavailable.
    } finally {
      refreshAt = now() + ACCOUNT_COUNT_REFRESH_MS;
    }
    return isAccountCountSnapshot(snapshot, now()) ? snapshot : null;
  }

  return function getAccountCount(): Promise<AccountCountSnapshot | null> {
    if (pending) return pending;
    if (now() < refreshAt) {
      return Promise.resolve(
        isAccountCountSnapshot(snapshot, now()) ? snapshot : null,
      );
    }
    pending = refresh().finally(() => {
      pending = null;
    });
    return pending;
  };
}

export const getJazAccountCount = createJazAccountCounter();
