import type { AppListing } from "./app-directory.ts";
import {
  bindAppHostLinkIntent,
  createAppHostLinkIntent,
  readAppHostLinkIntent,
  resolveAppHostLinkSelectorIntent,
  resolveBoundAppHostLinkIntent,
} from "./app-host-link-intent.ts";

function assert(condition: unknown, message = "Assertion failed"): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const now = 1_800_000_000_000;
const signingSecret = "app-host-link-intent-test-secret";

function appWithOwner(ownerDid: string): AppListing {
  return {
    id: "app-123",
    productDid: ownerDid,
    profileDid: null,
    legacyProfileDid: null,
  } as AppListing;
}

Deno.test("unbound app-host selectors only open for the current app owner", async () => {
  const token = await createAppHostLinkIntent(
    {
      appListingId: "app-123",
      relationship: "same_operator",
      appOwnerDid: "did:plc:app-owner",
    },
    {
      now,
      signingSecret,
      randomJti: () => "A".repeat(32),
    },
  );
  const options = {
    now: now + 10_000,
    signingSecret,
    loadApp: () => Promise.resolve(appWithOwner("did:plc:app-owner")),
  };
  const resolved = await resolveAppHostLinkSelectorIntent(
    token,
    "did:plc:app-owner",
    options,
  );
  assert(resolved.ok);
  if (!resolved.ok) return;
  assertEquals(resolved.value.intent, {
    appListingId: "app-123",
    relationship: "same_operator",
    appOwnerDid: "did:plc:app-owner",
    jti: "A".repeat(32),
    issuedAt: now,
    expiresAt: now + 60 * 60_000,
    kind: "selector",
    host: null,
  });
  assertEquals(
    await resolveAppHostLinkSelectorIntent(
      token,
      "did:plc:different-account",
      options,
    ),
    { ok: false, reason: "account_mismatch" },
  );
});

Deno.test("app-host intent ids are high-entropy and unique by default", async () => {
  const input = {
    appListingId: "app-123",
    relationship: "same_product" as const,
    appOwnerDid: "did:plc:app-owner",
  };
  const first = await readAppHostLinkIntent(
    await createAppHostLinkIntent(input, { now, signingSecret }),
    { now, signingSecret },
  );
  const second = await readAppHostLinkIntent(
    await createAppHostLinkIntent(input, { now, signingSecret }),
    { now, signingSecret },
  );
  assert(first.ok && second.ok);
  if (!first.ok || !second.ok) return;
  assert(/^[A-Za-z0-9_-]{32}$/.test(first.value.intent.jti));
  assert(first.value.intent.jti !== second.value.intent.jti);
});

Deno.test("binding creates a fresh one-host jti without extending expiry", async () => {
  const selector = await createAppHostLinkIntent(
    {
      appListingId: "app-123",
      relationship: "same_product",
      appOwnerDid: "did:plc:app-owner",
    },
    {
      now,
      ttlMs: 30 * 60_000,
      signingSecret,
      randomJti: () => "S".repeat(32),
    },
  );
  const bound = await bindAppHostLinkIntent(
    selector,
    "PDS.Example.",
    "did:plc:app-owner",
    {
      now: now + 60_000,
      signingSecret,
      randomJti: () => "B".repeat(32),
      loadApp: () => Promise.resolve(appWithOwner("did:plc:app-owner")),
    },
  );
  assert(bound.ok);
  if (!bound.ok) return;
  assertEquals(bound.value.intent.host, "pds.example");
  assertEquals(bound.value.intent.jti, "B".repeat(32));
  assertEquals(bound.value.intent.expiresAt, now + 30 * 60_000);
  assertEquals(
    await resolveBoundAppHostLinkIntent(bound.value.token, "other.example", {
      now: now + 60_000,
      signingSecret,
      loadApp: () => Promise.resolve(appWithOwner("did:plc:app-owner")),
    }),
    { ok: false, reason: "host_mismatch" },
  );
  assertEquals(
    await resolveBoundAppHostLinkIntent(selector, "pds.example", {
      now: now + 60_000,
      signingSecret,
      loadApp: () => Promise.resolve(appWithOwner("did:plc:app-owner")),
    }),
    { ok: false, reason: "wrong_stage" },
  );
});

Deno.test("app-host link intents reject forgery and expiry", async () => {
  const token = await createAppHostLinkIntent(
    {
      appListingId: "app-123",
      relationship: "same_product",
      appOwnerDid: "did:plc:app-owner",
    },
    {
      now,
      ttlMs: 1_000,
      signingSecret,
      randomJti: () => "A".repeat(32),
    },
  );
  const forged = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assertEquals(
    await readAppHostLinkIntent(forged, { now, signingSecret }),
    { ok: false, reason: "invalid" },
  );
  assertEquals(
    await readAppHostLinkIntent(token, {
      now: now + 1_000,
      signingSecret,
    }),
    { ok: false, reason: "expired" },
  );
});

Deno.test("app-host link intents fail closed when current app ownership changes", async () => {
  const token = await createAppHostLinkIntent(
    {
      appListingId: "app-123",
      relationship: "same_product",
      appOwnerDid: "did:plc:old-owner",
    },
    {
      now,
      signingSecret,
      randomJti: () => "A".repeat(32),
    },
  );
  const result = await resolveAppHostLinkSelectorIntent(
    token,
    "did:plc:old-owner",
    {
      now: now + 10_000,
      signingSecret,
      loadApp: () => Promise.resolve(appWithOwner("did:plc:new-owner")),
    },
  );
  assertEquals(result, { ok: false, reason: "owner_changed" });
});
