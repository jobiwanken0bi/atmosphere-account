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
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error("Account count unavailable");
      }
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

  return function getAccountCount(
    { waitForInitial = true }: { waitForInitial?: boolean } = {},
  ): Promise<AccountCountSnapshot | null> {
    const cached = isAccountCountSnapshot(snapshot, now()) ? snapshot : null;
    if (!pending && now() >= refreshAt) {
      pending = refresh().finally(() => {
        pending = null;
      });
    }
    // A warm page never waits on the tracker, even during a hanging refresh.
    // Pages can also skip the cold wait; the island's API request waits for it.
    if (cached || !waitForInitial) return Promise.resolve(cached);
    return pending ?? Promise.resolve(null);
  };
}

export const getJazAccountCount = createJazAccountCounter();
