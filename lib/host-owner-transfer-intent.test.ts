import {
  createHostOwnerTransferIntent,
  type HostOwnerTransferClaimLoader,
  readHostOwnerTransferIntent,
  resolveHostOwnerTransferIntent,
} from "./host-owner-transfer-intent.ts";
import { b64uEncode, hmacSign } from "./jose.ts";

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

function claimLoader(claimantDid: string | null): HostOwnerTransferClaimLoader {
  return () =>
    Promise.resolve(
      claimantDid === null ? null : {
        host: "pds.example",
        claimantDid,
        method: "dns_txt",
        updatedAt: now - 5_000,
      },
    );
}

Deno.test("host transfer intents are minted only for the authenticated current owner", async () => {
  const loadedHosts: string[] = [];
  const created = await createHostOwnerTransferIntent(
    { host: "PDS.Example.", authenticatedOwnerDid: ownerDid },
    {
      now,
      ttlMs: 60 * 60_000,
      signingSecret: secret,
      randomJti: () => "A".repeat(32),
      loadClaim: (host) => {
        loadedHosts.push(host);
        return Promise.resolve({
          host,
          claimantDid: ownerDid,
          method: "dns_txt",
          updatedAt: now - 5_000,
        });
      },
    },
  );
  assert(created.ok);
  assertEquals(loadedHosts, ["pds.example"]);
  assertEquals(created.value.intent, {
    host: "pds.example",
    previousOwnerDid: ownerDid,
    previousOwnerUpdatedAt: now - 5_000,
    jti: "A".repeat(32),
    issuedAt: now,
    expiresAt: now + 60 * 60_000,
  });

  assertEquals(
    await createHostOwnerTransferIntent(
      { host: "pds.example", authenticatedOwnerDid: otherDid },
      { now, signingSecret: secret, loadClaim: claimLoader(ownerDid) },
    ),
    { ok: false, reason: "not_owner" },
  );
  assertEquals(
    await createHostOwnerTransferIntent(
      { host: "https://pds.example/path", authenticatedOwnerDid: ownerDid },
      { now, signingSecret: secret, loadClaim: claimLoader(ownerDid) },
    ),
    { ok: false, reason: "invalid" },
  );
});

Deno.test("host transfer resolution rechecks the current claim and exact host", async () => {
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

  const resolved = await resolveHostOwnerTransferIntent(
    created.value.token,
    "PDS.Example.",
    {
      now: now + 1_000,
      signingSecret: secret,
      loadClaim: claimLoader(ownerDid),
    },
  );
  assert(resolved.ok);
  assertEquals(resolved.value.intent.previousOwnerDid, ownerDid);
  assertEquals(resolved.value.intent.previousOwnerUpdatedAt, now - 5_000);
  assertEquals(
    await resolveHostOwnerTransferIntent(
      created.value.token,
      "other.example",
      {
        now: now + 1_000,
        signingSecret: secret,
        loadClaim: () => {
          throw new Error("host mismatch must fail before loading a claim");
        },
      },
    ),
    { ok: false, reason: "host_mismatch" },
  );
  assertEquals(
    await resolveHostOwnerTransferIntent(
      created.value.token,
      "pds.example",
      {
        now: now + 1_000,
        signingSecret: secret,
        loadClaim: claimLoader(otherDid),
      },
    ),
    { ok: false, reason: "owner_changed" },
  );
  assertEquals(
    await resolveHostOwnerTransferIntent(
      created.value.token,
      "pds.example",
      {
        now: now + 1_000,
        signingSecret: secret,
        loadClaim: () =>
          Promise.resolve({
            host: "pds.example",
            claimantDid: ownerDid,
            method: "dns_txt",
            updatedAt: now + 500,
          }),
      },
    ),
    { ok: false, reason: "owner_changed" },
  );
});

Deno.test("grandfathered email managers can initiate a DNS-gated transfer", async () => {
  const emailClaim: HostOwnerTransferClaimLoader = () =>
    Promise.resolve({
      host: "pds.example",
      claimantDid: ownerDid,
      method: "pds_contact_email",
      updatedAt: now - 5_000,
    });
  const created = await createHostOwnerTransferIntent(
    { host: "pds.example", authenticatedOwnerDid: ownerDid },
    {
      now,
      signingSecret: secret,
      randomJti: () => "F".repeat(32),
      loadClaim: emailClaim,
    },
  );
  assert(created.ok);
  const resolved = await resolveHostOwnerTransferIntent(
    created.value.token,
    "pds.example",
    {
      now: now + 1,
      signingSecret: secret,
      loadClaim: emailClaim,
    },
  );
  assert(resolved.ok);
});

Deno.test("host transfer intent parsing rejects expiry, tampering, and malformed tokens", async () => {
  const created = await createHostOwnerTransferIntent(
    { host: "pds.example", authenticatedOwnerDid: ownerDid },
    {
      now,
      ttlMs: 10_000,
      signingSecret: secret,
      randomJti: () => "C".repeat(32),
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
    await readHostOwnerTransferIntent(
      `v2.${"A".repeat(20)}.${"B".repeat(43)}`,
      {
        now,
        signingSecret: secret,
      },
    ),
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

Deno.test("host transfer intent shape and lifetime are strict even with a valid signature", async () => {
  const extraFieldIntent = {
    host: "pds.example",
    previousOwnerDid: ownerDid,
    previousOwnerUpdatedAt: now - 5_000,
    jti: "D".repeat(32),
    issuedAt: now,
    expiresAt: now + 1_000,
    targetDid: otherDid,
  };
  const payload = b64uEncode(JSON.stringify(extraFieldIntent));
  const body = `v1.${payload}`;
  const signature = await hmacSign(
    secret,
    `atmosphere-account:host-owner-transfer-intent\n${body}`,
  );
  assertEquals(
    await readHostOwnerTransferIntent(`${body}.${signature}`, {
      now,
      signingSecret: secret,
    }),
    { ok: false, reason: "invalid" },
  );

  const overlongIntent = {
    host: "pds.example",
    previousOwnerDid: ownerDid,
    previousOwnerUpdatedAt: now - 5_000,
    jti: "E".repeat(32),
    issuedAt: now,
    expiresAt: now + 24 * 60 * 60_000 + 1,
  };
  const overlongPayload = b64uEncode(JSON.stringify(overlongIntent));
  const overlongBody = `v1.${overlongPayload}`;
  const overlongSignature = await hmacSign(
    secret,
    `atmosphere-account:host-owner-transfer-intent\n${overlongBody}`,
  );
  assertEquals(
    await readHostOwnerTransferIntent(
      `${overlongBody}.${overlongSignature}`,
      { now, signingSecret: secret },
    ),
    { ok: false, reason: "invalid" },
  );
});

Deno.test("host transfer intents use independent high-entropy ids", async () => {
  const options = {
    now,
    signingSecret: secret,
    loadClaim: claimLoader(ownerDid),
  };
  const first = await createHostOwnerTransferIntent(
    { host: "pds.example", authenticatedOwnerDid: ownerDid },
    options,
  );
  const second = await createHostOwnerTransferIntent(
    { host: "pds.example", authenticatedOwnerDid: ownerDid },
    options,
  );
  assert(first.ok && second.ok);
  assert(/^[A-Za-z0-9_-]{32}$/.test(first.value.intent.jti));
  assert(first.value.intent.jti !== second.value.intent.jti);
});
