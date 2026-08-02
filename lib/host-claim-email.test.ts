import {
  createComailHostContactEmailDelivery,
  type HostContactEmailChallengeRecord,
  type HostContactEmailChallengeStore,
  inspectHostContactEmailChallenge,
  maskEmail,
  normalizeEmail,
  requestHostContactEmailChallenge,
  verifyHostContactEmailChallenge,
} from "./host-claim-email.ts";
import { sha256B64u } from "./jose.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

function memoryStore(): HostContactEmailChallengeStore & {
  records: Map<string, HostContactEmailChallengeRecord>;
} {
  const records = new Map<string, HostContactEmailChallengeRecord>();
  return {
    records,
    save(record) {
      records.set(record.tokenHash, { ...record });
      return Promise.resolve();
    },
    remove(tokenHash) {
      records.delete(tokenHash);
      return Promise.resolve();
    },
    read(tokenHash) {
      const record = records.get(tokenHash);
      return Promise.resolve(record ? { ...record } : null);
    },
    consume(tokenHash, consumedAt) {
      const record = records.get(tokenHash);
      if (
        !record || record.consumedAt !== null || record.expiresAt < consumedAt
      ) {
        return Promise.resolve(false);
      }
      records.set(tokenHash, { ...record, consumedAt });
      return Promise.resolve(true);
    },
    recentCounts(input) {
      const recent = [...records.values()].filter((record) =>
        record.createdAt >= input.since
      );
      return Promise.resolve({
        host: recent.filter((record) => record.host === input.host).length,
        claimant: recent.filter((record) =>
          record.claimantDid === input.claimantDid
        )
          .length,
        email: recent.filter((record) =>
          record.emailFingerprint === input.emailFingerprint
        ).length,
      });
    },
  };
}

const target = {
  host: "pds.example.social",
  displayName: "Example Social",
  serviceEndpoint: "https://pds.example.social",
};
const user = { did: "did:plc:operator", handle: "operator.example" };

function describeServerFetch(email = "Ops@Example.Social"): typeof fetch {
  return ((_input: URL | Request | string, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify({
        did: "did:web:pds.example.social",
        availableUserDomains: ["example.social"],
        contact: { email },
      })),
    )) as typeof fetch;
}

Deno.test("PDS contact email claims are DID-bound, live-rechecked, and single use", async () => {
  const store = memoryStore();
  let verificationUrl = "";
  const requested = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphere.example",
    "/hosts/pds.example.social/claim?app=example",
    {
      now: 1_000,
      store,
      fetchImpl: describeServerFetch(),
      fingerprintSecret: "test-secret",
      delivery: {
        send(input) {
          verificationUrl = input.verificationUrl;
          return Promise.resolve();
        },
      },
    },
  );
  assert(requested.ok);
  const url = new URL(verificationUrl);
  const token = url.searchParams.get("token") ?? "";
  assertEquals(url.searchParams.get("app"), "example");
  assertEquals(requested.maskedEmail, "Op•••@example.social");

  assertEquals(
    await inspectHostContactEmailChallenge(
      target,
      {
        ...user,
        did: "did:plc:different",
      },
      token,
      { now: 1_100, store },
    ),
    { ok: false, reason: "account_mismatch" },
  );
  assertEquals(
    await verifyHostContactEmailChallenge(target, user, token, {
      now: 1_200,
      store,
      fetchImpl: describeServerFetch("ops@example.social"),
      fingerprintSecret: "test-secret",
    }),
    { ok: true },
  );
  assertEquals(
    await verifyHostContactEmailChallenge(target, user, token, {
      now: 1_300,
      store,
      fetchImpl: describeServerFetch(),
      fingerprintSecret: "test-secret",
    }),
    { ok: false, reason: "already_used" },
  );
});

Deno.test("PDS contact email verification fails when the live address changes", async () => {
  const store = memoryStore();
  let token = "";
  await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphere.example",
    "/hosts/pds.example.social/claim",
    {
      now: 2_000,
      store,
      fetchImpl: describeServerFetch(),
      fingerprintSecret: "test-secret",
      delivery: {
        send(input) {
          token = new URL(input.verificationUrl).searchParams.get("token") ??
            "";
          return Promise.resolve();
        },
      },
    },
  );
  assertEquals(
    await verifyHostContactEmailChallenge(target, user, token, {
      now: 2_100,
      store,
      fetchImpl: describeServerFetch("new@example.social"),
      fingerprintSecret: "test-secret",
    }),
    { ok: false, reason: "contact_changed" },
  );
  assertEquals(store.records.get(await sha256B64u(token))?.consumedAt, null);
});

Deno.test("a tenant PDS contact cannot claim a different umbrella hostname", async () => {
  const requested = await requestHostContactEmailChallenge(
    {
      host: "provider.example",
      displayName: "Provider",
      serviceEndpoint: "https://tenant.provider.example",
    },
    user,
    "https://atmosphere.example",
    "/hosts/provider.example/claim",
    {
      store: memoryStore(),
      fetchImpl: describeServerFetch(),
      fingerprintSecret: "test-secret",
      delivery: { send: () => Promise.resolve() },
    },
  );
  assertEquals(requested, { ok: false, reason: "contact_unavailable" });
});

Deno.test("contact email normalization and masking do not expose the mailbox", () => {
  assertEquals(normalizeEmail(" Admin@Example.COM "), "Admin@example.com");
  assertEquals(normalizeEmail("not-an-email"), null);
  assertEquals(maskEmail("a@example.com"), "a•••@example.com");
  assertEquals(maskEmail("support@example.com"), "su•••••@example.com");
});

Deno.test("Comail delivery uses DID authentication and verification semantics", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const delivery = createComailHostContactEmailDelivery({
    apiKey: "atmos_test_key",
    senderDid: "did:plc:atmosphere",
    from: "claims@atmosphere.example",
    fetchImpl: ((input: URL | Request | string, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            accepted: [{
              recipient: "ops@example.social",
              messageId: "message-1",
            }],
            rejected: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch,
  });

  await delivery.send({
    to: "ops@example.social",
    host: "pds.example.social",
    displayName: "Example Social",
    claimantHandle: "operator.example",
    verificationUrl: "https://atmosphere.example/verify?token=secret",
  });

  assertEquals(requestUrl, "https://smtp.atmos.email/v1/send");
  assertEquals(requestInit?.method, "POST");
  const headers = new Headers(requestInit?.headers);
  assertEquals(headers.get("authorization"), "Bearer atmos_test_key");
  assertEquals(headers.get("x-atmos-did"), "did:plc:atmosphere");
  const body = JSON.parse(String(requestInit?.body));
  assertEquals(body.from, "claims@atmosphere.example");
  assertEquals(body.to, "ops@example.social");
  assertEquals(body.subject, "Verify management of pds.example.social");
  assertEquals(body.category, "verification");
  assert(String(body.text).includes("expires in 20 minutes"));
  assert(String(body.html).includes("Verify this request"));
});
