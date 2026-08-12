import {
  createComailHostContactEmailDelivery,
  getHostContactEmailAvailability,
  hashHostContactEmailToken,
  type HostContactEmailDelivery,
  inspectHostContactEmailChallenge,
  maskEmail,
  normalizeEmail,
  notifyHostContactEmailOfDnsRecovery,
  prepareHostContactEmailChallenge,
  requestHostContactEmailChallenge,
  verifyHostContactEmailChallenge,
} from "./host-claim-email.ts";
import {
  type HostClaimChallengeRecord,
  type HostClaimChallengeStore,
} from "./host-claim-challenge.ts";
import { b64uDecode } from "./jose.ts";

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

function memoryStore(): HostClaimChallengeStore & {
  records: Map<string, HostClaimChallengeRecord>;
  consumes: number;
} {
  const records = new Map<string, HostClaimChallengeRecord>();
  return {
    records,
    consumes: 0,
    reserve(record, limits) {
      const recent = [...records.values()].filter((candidate) =>
        candidate.createdAt >= limits.since
      );
      if (
        limits.cooldownSince !== undefined &&
        recent.some((candidate) =>
          candidate.createdAt >= limits.cooldownSince! &&
          candidate.host === record.host &&
          candidate.claimantDid === record.claimantDid &&
          candidate.methodFingerprint === record.methodFingerprint
        )
      ) return Promise.resolve(false);
      if (
        recent.filter((candidate) => candidate.host === record.host).length >=
          limits.host ||
        recent.filter((candidate) =>
            candidate.claimantDid === record.claimantDid
          ).length >= limits.claimant ||
        recent.filter((candidate) =>
            candidate.methodFingerprint === record.methodFingerprint
          ).length >= limits.method
      ) return Promise.resolve(false);
      records.set(record.tokenHash, { ...record });
      return Promise.resolve(true);
    },
    remove(tokenHash) {
      records.delete(tokenHash);
      return Promise.resolve();
    },
    recordDelivery(tokenHash, deliveryId) {
      const record = records.get(tokenHash);
      if (record) records.set(tokenHash, { ...record, deliveryId });
      return Promise.resolve();
    },
    read(tokenHash) {
      const record = records.get(tokenHash);
      return Promise.resolve(record ? { ...record } : null);
    },
    consume(input) {
      this.consumes++;
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
      records.set(input.tokenHash, { ...record, consumedAt: input.consumedAt });
      return Promise.resolve({ ok: true });
    },
  };
}

const target = {
  host: "PDS.Example.Social.",
  displayName: "Example PDS",
  serviceEndpoint: "https://attacker.example.net",
};
const user = {
  did: "did:plc:claimant123",
  handle: "operator.example.social",
};

function describeFetch(
  input: {
    did?: string | null;
    email?: string | null;
    status?: number;
    onRequest?: (url: string, init: RequestInit | undefined) => void;
  } = {},
): typeof fetch {
  return ((request: string | URL | Request, init?: RequestInit) => {
    input.onRequest?.(String(request), init);
    const status = input.status ?? 200;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          did: input.did === undefined
            ? "did:web:pds.example.social"
            : input.did,
          contact: input.email === null ? undefined : {
            email: input.email === undefined
              ? "security@Example.Social"
              : input.email,
          },
        }),
        {
          status,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  }) as typeof fetch;
}

function captureDelivery(): HostContactEmailDelivery & {
  inputs: unknown[];
} {
  const inputs: unknown[] = [];
  return {
    inputs,
    send(input) {
      inputs.push(input);
      return Promise.resolve({ deliveryId: "delivery-123" });
    },
  };
}

function tokenFromDelivery(
  delivery: ReturnType<typeof captureDelivery>,
): string {
  const input = delivery.inputs[0] as { verificationUrl: string };
  return new URL(input.verificationUrl).searchParams.get("email_token") ?? "";
}

Deno.test("availability is fresh, exact-origin, masked, and distinguishes no contact from lookup failure", async () => {
  const seen: string[] = [];
  const redirects: Array<RequestRedirect | undefined> = [];
  const fetchImpl = describeFetch({
    onRequest(url, init) {
      seen.push(url);
      redirects.push(init?.redirect);
    },
  });
  const first = await getHostContactEmailAvailability(target, { fetchImpl });
  const second = await getHostContactEmailAvailability(target, { fetchImpl });
  assertEquals(first.status, "available");
  assertEquals(first.maskedEmail, "se••••••@example.social");
  assertEquals(second.status, "available");
  assertEquals(seen, [
    "https://pds.example.social/xrpc/com.atproto.server.describeServer",
    "https://pds.example.social/xrpc/com.atproto.server.describeServer",
  ]);
  assertEquals(redirects, ["manual", "manual"]);

  const none = await getHostContactEmailAvailability(target, {
    fetchImpl: describeFetch({ email: null }),
  });
  assertEquals(none.status, "unavailable");

  const network = await getHostContactEmailAvailability(target, {
    fetchImpl: describeFetch({ status: 503 }),
  });
  assertEquals(network.status, "lookup_error");
  const badDid = await getHostContactEmailAvailability(target, {
    fetchImpl: describeFetch({ did: "not-a-did" }),
  });
  assertEquals(badDid.status, "lookup_error");
});

Deno.test("request persists only opaque 32-byte proof values and emits email_token", async () => {
  const store = memoryStore();
  const delivery = captureDelivery();
  const requested = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/hosts/pds.example.social/claim?from=email",
    {
      now: 10_000,
      store,
      delivery,
      fetchImpl: describeFetch(),
      fingerprintSecret: "test-secret-at-least-32-bytes-long",
    },
  );
  assert(requested.ok);
  assertEquals(requested.expiresAt, 10_000 + 20 * 60_000);
  assertEquals(requested.deliveryId, "delivery-123");
  assertEquals(requested.maskedEmail, "se••••••@example.social");

  const token = tokenFromDelivery(delivery);
  assertEquals(token.length, 43);
  assertEquals(b64uDecode(token).byteLength, 32);
  const url = new URL(
    (delivery.inputs[0] as { verificationUrl: string }).verificationUrl,
  );
  assertEquals(url.searchParams.has("token"), false);
  assertEquals(url.searchParams.get("from"), "email");

  const tokenHash = await hashHostContactEmailToken(token);
  assert(tokenHash);
  assertEquals(tokenHash.length, 43);
  assertEquals(b64uDecode(tokenHash).byteLength, 32);
  const record = store.records.get(tokenHash);
  assert(record);
  assertEquals(record.host, "pds.example.social");
  assertEquals(record.methodFingerprint.length, 43);
  assert(record.methodBinding?.startsWith("pds-contact-email-v2."));
  assertEquals(record.deliveryId, "delivery-123");
  assertEquals(record.methodBinding?.includes("security"), false);
  assertEquals(JSON.stringify(record).includes(token), false);
  assertEquals(JSON.stringify(record).includes("@Example.Social"), false);
  assertEquals(
    JSON.stringify(record).includes("security@example.social"),
    false,
  );
  assertEquals(
    JSON.stringify(record).includes("did:web:pds.example.social"),
    false,
  );
  const deliveryPayload = JSON.stringify(delivery.inputs[0]);
  assertEquals(deliveryPayload.includes(user.did), false);
  assertEquals(deliveryPayload.includes("claimantDidFingerprint"), true);
});

Deno.test("inspection is read-only; prepare rechecks live PDS DID and email", async () => {
  const store = memoryStore();
  const delivery = captureDelivery();
  let fetches = 0;
  let did = "did:web:pds.example.social";
  let email = "security@example.social";
  const mutableFetch =
    ((request: string | URL | Request, init?: RequestInit) => {
      fetches++;
      return describeFetch({ did, email })(request, init);
    }) as typeof fetch;
  const requested = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/hosts/pds.example.social/claim",
    {
      now: 20_000,
      store,
      delivery,
      fetchImpl: mutableFetch,
      fingerprintSecret: "test-secret-at-least-32-bytes-long",
    },
  );
  assert(requested.ok);
  const token = tokenFromDelivery(delivery);
  assertEquals(fetches, 1);

  assertEquals(
    await inspectHostContactEmailChallenge(target, user, token, {
      now: 21_000,
      store,
    }),
    { ok: true },
  );
  assertEquals(fetches, 1);
  assertEquals(store.consumes, 0);

  const prepared = await prepareHostContactEmailChallenge(
    target,
    user,
    token,
    {
      now: 21_000,
      store,
      fetchImpl: mutableFetch,
      fingerprintSecret: "test-secret-at-least-32-bytes-long",
    },
  );
  assert(prepared.ok);
  assertEquals(prepared.endpointOrigin, "https://pds.example.social");
  assertEquals(prepared.pdsDid, "did:web:pds.example.social");
  assert(prepared.methodBinding.startsWith("pds-contact-email-v2."));
  assertEquals(prepared.requestedAt, 20_000);
  assertEquals(prepared.deliveryId, "delivery-123");
  assertEquals(store.consumes, 0);
  assertEquals(fetches, 2);

  did = "did:web:replacement.example.social";
  assertEquals(
    await prepareHostContactEmailChallenge(target, user, token, {
      now: 22_000,
      store,
      fetchImpl: mutableFetch,
      fingerprintSecret: "test-secret-at-least-32-bytes-long",
    }),
    { ok: false, reason: "contact_changed" },
  );
  did = "did:web:pds.example.social";
  email = "new-contact@example.social";
  assertEquals(
    await prepareHostContactEmailChallenge(target, user, token, {
      now: 23_000,
      store,
      fetchImpl: mutableFetch,
      fingerprintSecret: "test-secret-at-least-32-bytes-long",
    }),
    { ok: false, reason: "contact_changed" },
  );
});

Deno.test("verification is account-bound, expiring, and single-use", async () => {
  const store = memoryStore();
  const delivery = captureDelivery();
  const options = {
    now: 30_000,
    store,
    delivery,
    fetchImpl: describeFetch(),
    fingerprintSecret: "test-secret-at-least-32-bytes-long",
  };
  const requested = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/hosts/pds.example.social/claim",
    options,
  );
  assert(requested.ok);
  const token = tokenFromDelivery(delivery);
  assertEquals(
    await inspectHostContactEmailChallenge(
      target,
      { ...user, did: "did:plc:someoneelse" },
      token,
      { ...options, now: 31_000 },
    ),
    { ok: false, reason: "account_mismatch" },
  );
  assertEquals(
    await verifyHostContactEmailChallenge(target, user, token, {
      ...options,
      now: 31_000,
    }),
    { ok: true },
  );
  assertEquals(
    await inspectHostContactEmailChallenge(target, user, token, {
      ...options,
      now: 32_000,
    }),
    { ok: false, reason: "already_used" },
  );

  const secondDelivery = captureDelivery();
  const second = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/hosts/pds.example.social/claim",
    { ...options, now: 91_001, delivery: secondDelivery },
  );
  assert(second.ok);
  assertEquals(
    await inspectHostContactEmailChallenge(
      target,
      user,
      tokenFromDelivery(secondDelivery),
      { ...options, now: second.expiresAt + 1 },
    ),
    { ok: false, reason: "expired" },
  );
});

Deno.test("request separates lookup errors and retains failed attempts for rate limiting", async () => {
  const store = memoryStore();
  const lookup = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/claim",
    {
      store,
      delivery: captureDelivery(),
      fetchImpl: describeFetch({ status: 502 }),
    },
  );
  assertEquals(lookup, { ok: false, reason: "lookup_error" });

  const unavailable = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/claim",
    {
      store,
      delivery: captureDelivery(),
      fetchImpl: describeFetch({ email: null }),
    },
  );
  assertEquals(unavailable, { ok: false, reason: "contact_unavailable" });

  const failingDelivery: HostContactEmailDelivery = {
    send() {
      return Promise.reject(new Error("provider response with private data"));
    },
  };
  const failed = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/claim",
    {
      now: 100,
      store,
      delivery: failingDelivery,
      fetchImpl: describeFetch(),
      fingerprintSecret: "test-secret-at-least-32-bytes-long",
    },
  );
  assertEquals(failed, { ok: false, reason: "delivery_failed" });
  assertEquals(store.records.size, 1);
});

Deno.test("request enforces a 60-second resend cooldown in addition to hourly limits", async () => {
  const store = memoryStore();
  const options = {
    store,
    fetchImpl: describeFetch(),
    fingerprintSecret: "test-secret-at-least-32-bytes-long",
  };
  const first = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/claim",
    { ...options, now: 1_000_000, delivery: captureDelivery() },
  );
  assert(first.ok);
  const immediate = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/claim",
    { ...options, now: 1_000_001, delivery: captureDelivery() },
  );
  assertEquals(immediate, { ok: false, reason: "rate_limited" });
  const afterCooldown = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/claim",
    { ...options, now: 1_060_000, delivery: captureDelivery() },
  );
  assert(afterCooldown.ok);
});

Deno.test("hourly mailbox limit cannot be bypassed by varying host and claimant", async () => {
  const store = memoryStore();
  const options = {
    store,
    fetchImpl: describeFetch({ email: "shared@example.social" }),
    fingerprintSecret: "test-secret-at-least-32-bytes-long",
  };
  for (let index = 0; index < 5; index++) {
    const requested = await requestHostContactEmailChallenge(
      {
        host: `pds-${index}.example.social`,
        displayName: `PDS ${index}`,
        serviceEndpoint: "https://ignored.example.net",
      },
      {
        did: `did:plc:claimant${index}`,
        handle: `claimant-${index}.example.social`,
      },
      "https://atmosphereaccount.com",
      "/claim",
      { ...options, now: 2_000_000 + index, delivery: captureDelivery() },
    );
    assert(requested.ok);
  }
  const sixth = await requestHostContactEmailChallenge(
    {
      host: "pds-5.example.social",
      displayName: "PDS 5",
      serviceEndpoint: null,
    },
    {
      did: "did:plc:claimant5",
      handle: "claimant-5.example.social",
    },
    "https://atmosphereaccount.com",
    "/claim",
    { ...options, now: 2_000_005, delivery: captureDelivery() },
  );
  assertEquals(sixth, { ok: false, reason: "rate_limited" });
});

Deno.test("DNS recovery notification discovers fresh exact-host contact and sends only a DID fingerprint", async () => {
  const fingerprintSecret = "test-secret-at-least-32-bytes-long";
  const requested = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/claim",
    {
      store: memoryStore(),
      delivery: captureDelivery(),
      fetchImpl: describeFetch(),
      fingerprintSecret,
      now: 1_000,
    },
  );
  assert(requested.ok);
  const proofDelivery = captureDelivery();
  const proofStore = memoryStore();
  const proofRequest = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/claim",
    {
      store: proofStore,
      delivery: proofDelivery,
      fetchImpl: describeFetch(),
      fingerprintSecret,
      now: 2_000,
    },
  );
  assert(proofRequest.ok);
  const prepared = await prepareHostContactEmailChallenge(
    target,
    user,
    tokenFromDelivery(proofDelivery),
    {
      store: proofStore,
      fetchImpl: describeFetch(),
      fingerprintSecret,
      now: 2_000,
    },
  );
  assert(prepared.ok);
  const delivery = captureDelivery();
  const result = await notifyHostContactEmailOfDnsRecovery(
    target,
    {
      currentClaimantHandle: "current.example",
      requestingHandle: "requester.example",
      requestingDid: "did:plc:requestersecret",
      eligibleAt: Date.UTC(2026, 7, 15),
    },
    prepared.emailFingerprint,
    {
      delivery,
      fetchImpl: describeFetch(),
      fingerprintSecret,
    },
  );
  assert(result.ok);
  assertEquals(result.maskedEmail, "se••••••@example.social");
  assertEquals(result.deliveryId, "delivery-123");
  assertEquals(result.emailFingerprint.length, 43);
  const delivered = JSON.stringify(delivery.inputs[0]);
  assertEquals(delivered.includes("did:plc:requestersecret"), false);
  assert(delivered.includes(result.requestingDidFingerprint.slice(0, 12)));
  assertEquals(delivered.includes(result.requestingDidFingerprint), false);
  assert(delivered.includes("current.example"));
  assert(delivered.includes("requester.example"));
});

Deno.test("DNS recovery warning never sends to a changed PDS contact", async () => {
  const fingerprintSecret = "test-secret-at-least-32-bytes-long";
  const proofDelivery = captureDelivery();
  const proofStore = memoryStore();
  const requested = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/claim",
    {
      store: proofStore,
      delivery: proofDelivery,
      fetchImpl: describeFetch(),
      fingerprintSecret,
      now: 2_000,
    },
  );
  assert(requested.ok);
  const prepared = await prepareHostContactEmailChallenge(
    target,
    user,
    tokenFromDelivery(proofDelivery),
    {
      store: proofStore,
      fetchImpl: describeFetch(),
      fingerprintSecret,
      now: 2_000,
    },
  );
  assert(prepared.ok);
  const attackerDelivery = captureDelivery();
  const result = await notifyHostContactEmailOfDnsRecovery(
    target,
    {
      currentClaimantHandle: "current.example",
      requestingHandle: "requester.example",
      requestingDid: "did:plc:requester",
      eligibleAt: Date.UTC(2026, 7, 15),
    },
    prepared.emailFingerprint,
    {
      delivery: attackerDelivery,
      fetchImpl: describeFetch({ email: "attacker@example.social" }),
      fingerprintSecret,
    },
  );
  assertEquals(result, { ok: false, reason: "contact_changed" });
  assertEquals(attackerDelivery.inputs.length, 0);
});

Deno.test("Comail delivery validates acceptance and keeps errors free of response bodies", async () => {
  let sent: Record<string, unknown> | null = null;
  const delivery = createComailHostContactEmailDelivery({
    apiKey: "api-key",
    senderDid: "did:plc:sender",
    from: "claims@example.social",
    fetchImpl: ((_request, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            accepted: [{
              recipient: "security@example.social",
              messageId: 12345,
            }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    }) as typeof fetch,
  });
  const receipt = await delivery.send({
    kind: "dns_recovery",
    to: "security@example.social",
    host: "pds.example.social",
    currentClaimantHandle: "current.example",
    requestingHandle: "requester.example",
    requestingDidFingerprint: "opaque-fingerprint",
    eligibleAt: Date.UTC(2026, 7, 15),
  });
  assertEquals(receipt, { deliveryId: "12345" });
  const sentMessage = sent as Record<string, unknown> | null;
  assertEquals(Object.hasOwn(sentMessage ?? {}, "category"), false);
  assertEquals(String(sentMessage?.text).includes("opaque-fingerprint"), true);

  await delivery.send({
    kind: "verification",
    to: "security@example.social",
    host: "pds.example.social",
    displayName: "Example",
    claimantHandle: "operator.example",
    claimantDidFingerprint: "opaque-did12",
    verificationUrl: "https://atmosphereaccount.com/claim?email_token=secret",
  });
  const verificationMessage = sent as Record<string, unknown> | null;
  assertEquals(verificationMessage?.category, "verification");
  assertEquals(
    String(verificationMessage?.text).includes(
      "Review and confirm this request",
    ),
    true,
  );
  assertEquals(
    String(verificationMessage?.text).includes("opaque-did12"),
    true,
  );

  const rejected = createComailHostContactEmailDelivery({
    apiKey: "api-key",
    senderDid: "did:plc:sender",
    from: "claims@example.social",
    fetchImpl: (() =>
      Promise.resolve(
        new Response("private provider body", { status: 500 }),
      )) as typeof fetch,
  });
  let message = "";
  try {
    await rejected.send({
      kind: "verification",
      to: "security@example.social",
      host: "pds.example.social",
      displayName: "Example",
      claimantHandle: "operator.example",
      claimantDidFingerprint: "opaque-did12",
      verificationUrl: "https://atmosphereaccount.com/claim?email_token=secret",
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message.includes("private provider body"), false);
  assertEquals(message.includes("security@example.social"), false);
  assertEquals(message.includes("email_token"), false);
});

Deno.test("Comail payload categories match the provider contract", async () => {
  const payloads: Record<string, unknown>[] = [];
  const delivery = createComailHostContactEmailDelivery({
    apiKey: "api-key",
    senderDid: "did:plc:sender",
    from: "claims@example.social",
    fetchImpl: ((_request, init) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      payloads.push(payload);
      return Promise.resolve(Response.json({
        accepted: [{ recipient: payload.to, messageId: payloads.length }],
        rejected: [],
      }));
    }) as typeof fetch,
  });

  await delivery.send({
    kind: "verification",
    to: "operator@example.social",
    host: "pds.example.social",
    displayName: "Example",
    claimantHandle: "operator.example",
    claimantDidFingerprint: "opaque-did12",
    verificationUrl: "https://atmosphereaccount.com/claim?email_token=secret",
  });
  await delivery.send({
    kind: "dns_recovery",
    to: "operator@example.social",
    host: "pds.example.social",
    currentClaimantHandle: "current.example",
    requestingHandle: "requester.example",
    requestingDidFingerprint: "opaque-fingerprint",
    eligibleAt: Date.UTC(2026, 7, 15),
  });

  assertEquals(payloads[0]?.category, "verification");
  assertEquals(Object.hasOwn(payloads[1] ?? {}, "category"), false);
});

Deno.test("Comail delivery rejects malformed sender configuration before fetch", () => {
  let calls = 0;
  for (
    const config of [
      {
        apiKey: "",
        senderDid: "did:plc:sender",
        from: "claims@example.social",
      },
      { apiKey: "key", senderDid: "not-a-did", from: "claims@example.social" },
      { apiKey: "key", senderDid: "did:plc:sender", from: "not-an-email" },
    ]
  ) {
    let threw = false;
    try {
      createComailHostContactEmailDelivery({
        ...config,
        fetchImpl: (() => {
          calls++;
          return Promise.reject(new Error("must not fetch"));
        }) as typeof fetch,
      });
    } catch {
      threw = true;
    }
    assert(threw);
  }
  assertEquals(calls, 0);
});

Deno.test("email normalization and masking never reveal an invalid address", () => {
  assertEquals(normalizeEmail(" User@EXAMPLE.COM "), "User@example.com");
  assertEquals(normalizeEmail("a@b"), null);
  assertEquals(normalizeEmail("a@example.com\nBcc:x@evil.example"), null);
  assertEquals(maskEmail("User@example.com"), "Us•••@example.com");
  assertEquals(maskEmail("invalid"), "the PDS contact address");
});

Deno.test("email proof preserves mailbox local-part case", async () => {
  const options = {
    fingerprintSecret: "test-secret-at-least-32-bytes-long",
  };
  const upperStore = memoryStore();
  const upperDelivery = captureDelivery();
  const upper = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/claim",
    {
      ...options,
      now: 1,
      store: upperStore,
      delivery: upperDelivery,
      fetchImpl: describeFetch({ email: "Security@example.social" }),
    },
  );
  const lowerStore = memoryStore();
  const lowerDelivery = captureDelivery();
  const lower = await requestHostContactEmailChallenge(
    target,
    user,
    "https://atmosphereaccount.com",
    "/claim",
    {
      ...options,
      now: 1,
      store: lowerStore,
      delivery: lowerDelivery,
      fetchImpl: describeFetch({ email: "security@example.social" }),
    },
  );
  assert(upper.ok && lower.ok);
  const upperHash = await hashHostContactEmailToken(
    tokenFromDelivery(upperDelivery),
  );
  const lowerHash = await hashHostContactEmailToken(
    tokenFromDelivery(lowerDelivery),
  );
  assert(upperHash && lowerHash);
  assert(
    upperStore.records.get(upperHash)?.methodFingerprint !==
      lowerStore.records.get(lowerHash)?.methodFingerprint,
  );
});
