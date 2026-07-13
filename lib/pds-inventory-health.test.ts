import {
  calculatePdsInventoryFreshness,
  DEFAULT_PDS_INVENTORY_MAX_AGE_MS,
  type PdsInventoryScanRecord,
} from "./pds-inventory-health.ts";

function scan(
  overrides: Partial<PdsInventoryScanRecord> = {},
): PdsInventoryScanRecord {
  return {
    scanId: "scan-1",
    relayUrl: "https://bsky.network",
    status: "succeeded",
    complete: true,
    pages: 6,
    instanceCount: 5_513,
    startedAt: 1_000,
    completedAt: 2_000,
    error: null,
    ...overrides,
  };
}

Deno.test("PDS inventory freshness only trusts successful complete scans", () => {
  const result = calculatePdsInventoryFreshness({
    complete: null,
    latest: scan({ status: "succeeded", complete: false }),
    now: 3_000,
    maxAgeMs: DEFAULT_PDS_INVENTORY_MAX_AGE_MS,
  });
  if (result.present || result.fresh) {
    throw new Error("partial scan must not satisfy inventory freshness");
  }
  if (result.latestAttempt?.complete !== false) {
    throw new Error("latest partial attempt should remain visible");
  }
});

Deno.test("PDS inventory freshness expires after the configured window", () => {
  const completedAt = 10_000;
  const fresh = calculatePdsInventoryFreshness({
    complete: scan({ completedAt }),
    latest: scan({ completedAt }),
    now: completedAt + DEFAULT_PDS_INVENTORY_MAX_AGE_MS,
    maxAgeMs: DEFAULT_PDS_INVENTORY_MAX_AGE_MS,
  });
  if (!fresh.fresh || fresh.instanceCount !== 5_513) {
    throw new Error("scan at the freshness boundary should be healthy");
  }

  const stale = calculatePdsInventoryFreshness({
    complete: scan({ completedAt }),
    latest: scan({ completedAt }),
    now: completedAt + DEFAULT_PDS_INVENTORY_MAX_AGE_MS + 1,
    maxAgeMs: DEFAULT_PDS_INVENTORY_MAX_AGE_MS,
  });
  if (stale.fresh || stale.ageMs == null) {
    throw new Error("scan beyond the freshness window should be stale");
  }
});
