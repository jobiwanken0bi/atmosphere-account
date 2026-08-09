import {
  clearPendingBrowserResumeMarkersForOtherOwner,
  isPendingBrowserActionFresh,
  PENDING_BROWSER_ACTION_TTL_MS,
  pendingBrowserActionKeysForOtherOwner,
  pendingBrowserResumeMarkerKeysForOtherOwner,
  pendingBrowserSessionDraftKeysForOtherOwner,
} from "./pending-browser-action.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("pending browser actions expire after the OAuth handoff window", () => {
  const now = 10_000_000;
  assertEquals(isPendingBrowserActionFresh(now, now), true);
  assertEquals(
    isPendingBrowserActionFresh(
      now - PENDING_BROWSER_ACTION_TTL_MS,
      now,
    ),
    true,
  );
  assertEquals(
    isPendingBrowserActionFresh(
      now - PENDING_BROWSER_ACTION_TTL_MS - 1,
      now,
    ),
    false,
  );
});

Deno.test("account switches discard another account's private browser drafts", () => {
  const entries = [
    [
      "atmosphere:review-draft:did%3Aplc%3Aalice:grain",
      JSON.stringify({ ownerDid: "did:plc:alice", body: "private" }),
    ],
    [
      "atmosphere:review-response-draft:did%3Aplc%3Abob:42",
      JSON.stringify({ ownerDid: "did:plc:bob", body: "keep" }),
    ],
    ["atmosphere:review-report-draft:42", "legacy plaintext"],
    ["unrelated", JSON.stringify({ ownerDid: "did:plc:alice" })],
  ] as const;
  assertEquals(
    JSON.stringify(
      pendingBrowserSessionDraftKeysForOtherOwner(entries, "did:plc:bob"),
    ),
    JSON.stringify([
      "atmosphere:review-draft:did%3Aplc%3Aalice:grain",
      "atmosphere:review-report-draft:42",
    ]),
  );
});

Deno.test("pending browser actions reject invalid or future timestamps", () => {
  const now = 10_000_000;
  assertEquals(isPendingBrowserActionFresh(undefined, now), false);
  assertEquals(isPendingBrowserActionFresh(Number.NaN, now), false);
  assertEquals(isPendingBrowserActionFresh(now + 1, now), false);
  assertEquals(isPendingBrowserActionFresh(now, now, -1), false);
});

Deno.test("account switches select only pending writes owned by another DID", () => {
  const stale = pendingBrowserActionKeysForOtherOwner([
    { key: "app:alice", ownerDid: "did:plc:alice" },
    { key: "app:bob", ownerDid: "did:plc:bob" },
    { key: "legacy-unowned" },
    { key: 42, ownerDid: "did:plc:alice" },
  ], "did:plc:bob");
  assertEquals(JSON.stringify(stale), JSON.stringify(["app:alice"]));
});

Deno.test("account switches consume DID-valued resume markers synchronously", () => {
  const entries = [
    ["atmosphere:resume-user-profile:alice", "did:plc:alice"],
    ["atmosphere:resume-profile-update:bob", "did:plc:bob"],
    ["unrelated", "did:plc:alice"],
  ] as const;
  assertEquals(
    JSON.stringify(
      pendingBrowserResumeMarkerKeysForOtherOwner(entries, "did:plc:bob"),
    ),
    JSON.stringify(["atmosphere:resume-user-profile:alice"]),
  );

  const values = new Map<string, string | null>(entries);
  const storage = {
    get length() {
      return values.size;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
  clearPendingBrowserResumeMarkersForOtherOwner(
    "did:plc:bob",
    storage,
  );
  assertEquals(values.has("atmosphere:resume-user-profile:alice"), false);
  assertEquals(values.has("atmosphere:resume-profile-update:bob"), true);
  assertEquals(values.has("unrelated"), true);
});
