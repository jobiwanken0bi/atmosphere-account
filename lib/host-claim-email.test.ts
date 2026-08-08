import {
  consumeHostContactEmailChallenge,
  createComailHostContactEmailDelivery,
  getHostContactEmailAvailability,
  type HostContactEmailChallengeRecord,
  type HostContactEmailChallengeStore,
  hostContactEmailVerificationFailureMessage,
  inspectHostContactEmailChallenge,
  isHostContactEmailVerificationFailureReason,
  maskEmail,
  normalizeEmail,
  prepareHostContactEmailChallenge,
  requestHostContactEmailChallenge,
  reserveHostContactEmailChallenge,
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

async function assertRejects(
  fn: () => Promise<unknown>,
  expected: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) {
      throw new Error(`Expected error including ${expected}, got ${message}`);
    }
    return;
  }
  throw new Error("Expected promise to reject");
}

function memoryStore(): HostContactEmailChallengeStore & {
  records: Map<string, HostContactEmailChallengeRecord>;
} {
  const records = new Map<string, HostContactEmailChallengeRecord>();
  return {
    records,
    reserve(record, limits) {
      const recent = [...records.values()].filter((candidate) =>
        candidate.createdAt >= limits.since
      );
      if (
        recent.filter((candidate) => candidate.host === record.host).length >=
          limits.host ||
        recent.filter((candidate) =>
            candidate.claimantDid === record.claimantDid
          ).length >= limits.claimant ||
        recent.filter((candidate) =>
            candidate.emailFingerprint === record.emailFingerprint
          ).length >= limits.email
      ) return Promise.resolve(false);
      records.set(record.tokenHash, { ...record });
      return Promise.resolve(true);
    },
    remove(tokenHash) {
      records.delete(tokenHash);
      return Promise.resolve();
    },
    read(tokenHash) {
      const record = records.get(tokenHash);
      return Promise.resolve(record ? { ...record } : null);
    },
    consume(input) {
      const record = records.get(input.tokenHash);
      if (!record || record.host !== input.host) {
        return Promise.resolve({ ok: false, reason: "invalid" as const });
      }
      if (record.claimantDid !== input.claimantDid) {
        return Promise.resolve({
          ok: false,
          reason: "account_mismatch" as const,
        });
      }
      if (record.consumedAt !== null) {
        return Promise.resolve({
          ok: false,
          reason: "already_used" as const,
        });
      }
      if (record.expiresAt < input.consumedAt) {
        return Promise.resolve({ ok: false, reason: "expired" as const });
      }
      records.set(input.tokenHash, {
        ...record,
        consumedAt: input.consumedAt,
      });
      return Promise.resolve({ ok: true });
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
      new Response(
        JSON.stringify({
          did: "did:web:pds.example.social",
          availableUserDomains: ["example.social"],
          contact: { email },
        }),
        { headers: { "content-type": "application/json" } },
      ),
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

Deno.test("concurrent contact-email requests cannot overrun one rate-limit slot", async () => {
  const store = memoryStore();
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      requestHostContactEmailChallenge(
        target,
        user,
        "https://atmosphere.example",
        "/hosts/pds.example.social/claim",
        {
          now: 5_000,
          store,
          fetchImpl: describeServerFetch(),
          fingerprintSecret: "test-secret",
          delivery: { send: () => Promise.resolve() },
        },
      )),
  );
  assertEquals(results.filter((result) => result.ok).length, 5);
  assertEquals(
    results.filter((result) => !result.ok && result.reason === "rate_limited")
      .length,
    1,
  );
  assertEquals(store.records.size, 5);
});

Deno.test("database challenge reservations lock, count, and insert in one unit", async () => {
  const statements: string[] = [];
  const reserved = await reserveHostContactEmailChallenge(
    {
      execute(query) {
        const sql = typeof query === "string" ? query : query.sql;
        statements.push(sql);
        if (sql.includes("SUM(CASE WHEN host")) {
          return Promise.resolve({
            rows: [{ host_count: 4, claimant_count: 4, email_count: 4 }],
            rowsAffected: 0,
          });
        }
        return Promise.resolve({ rows: [], rowsAffected: 1 });
      },
    },
    {
      tokenHash: "reserved-token",
      host: target.host,
      claimantDid: user.did,
      claimantHandle: user.handle,
      emailFingerprint: "fingerprint",
      createdAt: 5_000,
      expiresAt: 6_000,
      consumedAt: null,
    },
    { since: 0, host: 5, claimant: 10, email: 5 },
    { postgresBackend: true },
  );
  assertEquals(reserved, true);
  assert(statements[0].includes("pg_advisory_xact_lock"));
  assert(statements[1].startsWith("DELETE FROM"));
  assert(statements[2].includes("SUM(CASE WHEN host"));
  assert(statements[3].includes("INSERT INTO account_host_claim_challenge"));
});

Deno.test("failed contact-email delivery releases its reserved slot", async () => {
  const store = memoryStore();
  const result = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphere.example",
    "/hosts/pds.example.social/claim",
    {
      now: 6_000,
      store,
      fetchImpl: describeServerFetch(),
      fingerprintSecret: "test-secret",
      delivery: {
        send: () => Promise.reject(new Error("mailbox unavailable")),
      },
    },
  );
  assertEquals(result, { ok: false, reason: "delivery_failed" });
  assertEquals(store.records.size, 0);
});

Deno.test("contact-email setup sees a newly announced address immediately", async () => {
  let email: string | null = null;
  let calls = 0;
  const fetchImpl = ((_input: URL | Request | string, _init?: RequestInit) => {
    calls += 1;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          did: "did:web:pds.example.social",
          contact: email ? { email } : {},
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
  }) as typeof fetch;

  assertEquals(
    await getHostContactEmailAvailability(target, { fetchImpl }),
    {
      available: false,
      maskedEmail: null,
      deliveryConfigured: true,
    },
  );
  email = "ops@example.social";
  const refreshed = await getHostContactEmailAvailability(target, {
    fetchImpl,
  });
  assertEquals(refreshed.available, true);
  assertEquals(refreshed.maskedEmail, "op•••@example.social");
  assertEquals(calls, 2);
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

Deno.test("prepared PDS contact verification stays unconsumed until the caller's transaction", async () => {
  const store = memoryStore();
  let token = "";
  await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphere.example",
    "/hosts/pds.example.social/claim",
    {
      now: 3_000,
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

  const prepared = await prepareHostContactEmailChallenge(
    target,
    user,
    token,
    {
      now: 3_100,
      store,
      fetchImpl: describeServerFetch(),
      fingerprintSecret: "test-secret",
    },
  );
  assert(prepared.ok);
  assertEquals(store.records.get(prepared.tokenHash)?.consumedAt, null);

  let transactionToken = "";
  const consumed = await consumeHostContactEmailChallenge(
    {
      execute(query) {
        assert(typeof query !== "string");
        transactionToken = String(query.args?.[1] ?? "");
        return Promise.resolve({ rows: [], rowsAffected: 1 });
      },
    },
    {
      tokenHash: prepared.tokenHash,
      host: prepared.host,
      claimantDid: prepared.claimantDid,
      consumedAt: 3_200,
    },
  );
  assertEquals(consumed, { ok: true });
  assertEquals(transactionToken, prepared.tokenHash);
});

Deno.test("PDS contact email inspection distinguishes invalid and expired links", async () => {
  const store = memoryStore();
  assertEquals(
    await inspectHostContactEmailChallenge(target, user, "not-a-token", {
      store,
    }),
    { ok: false, reason: "invalid" },
  );

  let token = "";
  await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphere.example",
    "/hosts/pds.example.social/claim",
    {
      now: 4_000,
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
    await inspectHostContactEmailChallenge(target, user, token, {
      now: 4_000 + 20 * 60_000 + 1,
      store,
    }),
    { ok: false, reason: "expired" },
  );
});

Deno.test("PDS contact email failures have distinct actionable feedback", () => {
  const reasons = [
    "invalid",
    "expired",
    "already_used",
    "account_mismatch",
    "contact_changed",
  ] as const;
  const messages = reasons.map((reason) =>
    hostContactEmailVerificationFailureMessage(reason)
  );
  assertEquals(new Set(messages).size, reasons.length);
  assert(messages[0].includes("invalid"));
  assert(messages[1].includes("expired"));
  assert(messages[2].includes("already been used"));
  assert(messages[3].includes("different Atmosphere account"));
  assert(messages[4].includes("contact email changed"));
  for (const reason of reasons) {
    assert(isHostContactEmailVerificationFailureReason(reason));
  }
  assert(!isHostContactEmailVerificationFailureReason("not_authorized"));
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

Deno.test("a compiled umbrella host can use only its exact bound PDS origin", async () => {
  for (
    const { serviceEndpoint, ok } of [
      { serviceEndpoint: "https://bsky.social", ok: true },
      { serviceEndpoint: "https://bsky.social/", ok: true },
      { serviceEndpoint: "https://bsky.social:8443", ok: false },
      { serviceEndpoint: "https://bsky.social.example", ok: false },
      { serviceEndpoint: "https://other.example", ok: false },
    ]
  ) {
    const requested = await requestHostContactEmailChallenge(
      {
        host: "bsky.network",
        displayName: "Bluesky",
        serviceEndpoint,
      },
      user,
      "https://atmosphere.example",
      "/hosts/bsky.network/claim",
      {
        store: memoryStore(),
        fetchImpl: describeServerFetch("ops@bsky.social"),
        fingerprintSecret: "test-secret",
        delivery: { send: () => Promise.resolve() },
      },
    );
    assertEquals(requested.ok, ok);
    if (!ok) {
      assertEquals(requested, {
        ok: false,
        reason: "contact_unavailable",
      });
    }
  }
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

Deno.test("Comail delivery rejects a 200 response that did not accept the intended recipient", async () => {
  for (
    const responseBody of [
      {
        accepted: [{ recipient: "different@example.social", messageId: 1 }],
        rejected: [],
      },
      {
        accepted: [],
        rejected: [{ recipient: "ops@example.social", reason: "suppressed" }],
      },
      {
        accepted: [{ recipient: "ops@example.social", messageId: 1 }],
        rejected: "invalid",
      },
    ]
  ) {
    const delivery = createComailHostContactEmailDelivery({
      apiKey: "atmos_test_key",
      senderDid: "did:plc:atmosphere",
      from: "claims@atmosphere.example",
      fetchImpl: (() =>
        Promise.resolve(
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )) as typeof fetch,
    });

    await assertRejects(
      () =>
        delivery.send({
          to: "ops@example.social",
          host: "pds.example.social",
          displayName: "Example Social",
          claimantHandle: "operator.example",
          verificationUrl: "https://atmosphere.example/verify?token=secret",
        }),
      "without accepting the intended recipient",
    );
  }
});

Deno.test("Comail delivery accepts the live success shape with omitted rejections", async () => {
  const delivery = createComailHostContactEmailDelivery({
    apiKey: "atmos_test_key",
    senderDid: "did:plc:atmosphere",
    from: "claims@atmosphere.example",
    fetchImpl: (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            accepted: [{
              recipient: "ops@example.social",
              messageId: 448,
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )) as typeof fetch,
  });

  await delivery.send({
    to: "ops@example.social",
    host: "pds.example.social",
    displayName: "Example Social",
    claimantHandle: "operator.example",
    verificationUrl: "https://atmosphere.example/verify?token=secret",
  });
});

Deno.test("Comail delivery rejects malformed and oversized 200 responses", async () => {
  for (
    const { response, expected } of [
      {
        response: new Response("not json", { status: 200 }),
        expected: "without accepting the intended recipient",
      },
      {
        response: new Response("{}", {
          status: 200,
          headers: { "content-length": "16001" },
        }),
        expected: "unreadable success response: response too large",
      },
    ]
  ) {
    const delivery = createComailHostContactEmailDelivery({
      apiKey: "atmos_test_key",
      senderDid: "did:plc:atmosphere",
      from: "claims@atmosphere.example",
      fetchImpl: (() => Promise.resolve(response)) as typeof fetch,
    });

    await assertRejects(
      () =>
        delivery.send({
          to: "ops@example.social",
          host: "pds.example.social",
          displayName: "Example Social",
          claimantHandle: "operator.example",
          verificationUrl: "https://atmosphere.example/verify?token=secret",
        }),
      expected,
    );
  }
});
