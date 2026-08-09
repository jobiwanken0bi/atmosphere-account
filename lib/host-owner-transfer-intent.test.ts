import {
  createHostOwnerTransferIntent,
  type HostOwnerTransferClaimLoader,
  readHostOwnerTransferIntent,
  resolveHostOwnerTransferIntent,
} from "./host-owner-transfer-intent.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
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
const secret = "host-owner-transfer-intent-test-secret";
const ownerDid = "did:plc:current-owner";
const otherDid = "did:plc:other-owner";

function claimLoader(
  claimantDid: string | null,
  method: "dns_txt" | "pds_contact_email" = "dns_txt",
): HostOwnerTransferClaimLoader {
  return () =>
    Promise.resolve(
      claimantDid === null ? null : {
        host: "pds.example",
        claimantDid,
        method,
        updatedAt: now - 5_000,
      },
    );
}

Deno.test("transfer intents are minted only for the verified current owner", async () => {
  const created = await createHostOwnerTransferIntent(
    { host: "PDS.Example.", authenticatedOwnerDid: ownerDid },
    {
      now,
      signingSecret: secret,
      randomJti: () => "A".repeat(32),
      loadClaim: claimLoader(ownerDid),
    },
  );
  assert(created.ok);
  assertEquals(created.value.intent.host, "pds.example");
  assertEquals(created.value.intent.previousOwnerDid, ownerDid);
  assertEquals(
    await createHostOwnerTransferIntent(
      { host: "pds.example", authenticatedOwnerDid: otherDid },
      { now, signingSecret: secret, loadClaim: claimLoader(ownerDid) },
    ),
    { ok: false, reason: "not_owner" },
  );
});

Deno.test("transfer resolution rechecks exact host, owner, and claim version", async () => {
  const created = await createHostOwnerTransferIntent(
    { host: "pds.example", authenticatedOwnerDid: ownerDid },
    {
      now,
      signingSecret: secret,
      randomJti: () => "B".repeat(32),
      loadClaim: claimLoader(ownerDid),
    },
  );
  assert(created.ok);
  assert(
    (await resolveHostOwnerTransferIntent(
      created.value.token,
      "pds.example",
      {
        now: now + 1,
        signingSecret: secret,
        loadClaim: claimLoader(ownerDid),
      },
    )).ok,
  );
  assertEquals(
    await resolveHostOwnerTransferIntent(created.value.token, "other.example", {
      now: now + 1,
      signingSecret: secret,
      loadClaim: claimLoader(ownerDid),
    }),
    { ok: false, reason: "host_mismatch" },
  );
  assertEquals(
    await resolveHostOwnerTransferIntent(created.value.token, "pds.example", {
      now: now + 1,
      signingSecret: secret,
      loadClaim: claimLoader(otherDid),
    }),
    { ok: false, reason: "owner_changed" },
  );
  assertEquals(
    await resolveHostOwnerTransferIntent(created.value.token, "pds.example", {
      now: now + 1,
      signingSecret: secret,
      loadClaim: () =>
        Promise.resolve({
          host: "pds.example",
          claimantDid: ownerDid,
          method: "dns_txt",
          updatedAt: now + 500,
        }),
    }),
    { ok: false, reason: "owner_changed" },
  );
});

Deno.test("grandfathered contact-email managers can start a DNS transfer", async () => {
  const created = await createHostOwnerTransferIntent(
    { host: "pds.example", authenticatedOwnerDid: ownerDid },
    {
      now,
      signingSecret: secret,
      randomJti: () => "C".repeat(32),
      loadClaim: claimLoader(ownerDid, "pds_contact_email"),
    },
  );
  assert(created.ok);
  assert(
    (await resolveHostOwnerTransferIntent(
      created.value.token,
      "pds.example",
      {
        now: now + 1,
        signingSecret: secret,
        loadClaim: claimLoader(ownerDid, "pds_contact_email"),
      },
    )).ok,
  );
});

Deno.test("transfer tokens reject expiry, tampering, and oversized input", async () => {
  const created = await createHostOwnerTransferIntent(
    { host: "pds.example", authenticatedOwnerDid: ownerDid },
    {
      now,
      ttlMs: 10_000,
      signingSecret: secret,
      randomJti: () => "D".repeat(32),
      loadClaim: claimLoader(ownerDid),
    },
  );
  assert(created.ok);
  assertEquals(
    await readHostOwnerTransferIntent(created.value.token, {
      now: now + 10_000,
      signingSecret: secret,
    }),
    { ok: false, reason: "expired" },
  );
  const tampered = `${created.value.token.slice(0, -1)}${
    created.value.token.endsWith("A") ? "B" : "A"
  }`;
  assertEquals(
    await readHostOwnerTransferIntent(tampered, {
      now: now + 1,
      signingSecret: secret,
    }),
    { ok: false, reason: "invalid" },
  );
  assertEquals(
    await readHostOwnerTransferIntent("x".repeat(2_049), {
      now,
      signingSecret: secret,
    }),
    { ok: false, reason: "invalid" },
  );
});
