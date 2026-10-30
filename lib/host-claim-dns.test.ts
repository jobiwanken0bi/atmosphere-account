import {
  hostDnsChallengeRecordName,
  hostDnsChallengeRecordValue,
  hostDnsChallengeVerificationFailureMessage,
  type HostDnsTxtResolver,
  inspectHostDnsChallenge,
  isHostDnsChallengeVerificationFailureReason,
  prepareHostDnsChallenge,
  requestHostDnsChallenge,
  verifyHostDnsChallenge,
} from "./host-claim-dns.ts";
import {
  type HostContactEmailChallengeRecord,
  type HostContactEmailChallengeStore,
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

const target = { host: "pds.example.social" };
const user = { did: "did:plc:operator", handle: "operator.example" };

function staticResolver(
  answers: readonly (readonly string[])[],
): HostDnsTxtResolver {
  return { resolve: () => Promise.resolve(answers) };
}

Deno.test("DNS ownership challenges publish a bounded account-specific TXT value and persist only its hash", async () => {
  const store = memoryStore();
  const requested = await requestHostDnsChallenge(
    { host: "@PDS.Example.Social." },
    user,
    { now: 1_000, store },
  );
  assert(requested.ok);
  assertEquals(requested.host, target.host);
  assertEquals(requested.recordName, "_atmosphere-account.pds.example.social");
  assertEquals(
    requested.recordValue,
    `atmosphere-account-verification=${requested.verificationToken}`,
  );
  assertEquals(requested.verificationToken.length, 43);
  assertEquals(requested.expiresAt, 86_401_000);
  assertEquals(
    hostDnsChallengeRecordName("PDS.Example.Social."),
    requested.recordName,
  );
  assertEquals(
    hostDnsChallengeRecordValue(requested.verificationToken),
    requested.recordValue,
  );

  const tokenHash = await sha256B64u(requested.verificationToken);
  const record = store.records.get(tokenHash);
  assert(record);
  assertEquals(record.host, target.host);
  assertEquals(record.claimantDid, user.did);
  assert(record.emailFingerprint.startsWith("dns-v1:"));
  assertEquals(
    JSON.stringify(record).includes(requested.verificationToken),
    false,
  );
});

Deno.test("DNS proof accepts an exact split TXT record and is DID-bound and single use", async () => {
  const store = memoryStore();
  const requested = await requestHostDnsChallenge(target, user, {
    now: 2_000,
    store,
  });
  assert(requested.ok);
  const prefix = "atmosphere-account-verification=";
  const resolver = staticResolver([
    ["unrelated=value"],
    [prefix, requested.verificationToken],
  ]);

  assertEquals(
    await inspectHostDnsChallenge(
      target,
      user,
      requested.verificationToken,
      { now: 2_050, store },
    ),
    {
      ok: true,
      host: target.host,
      recordName: requested.recordName,
      recordValue: requested.recordValue,
      verificationToken: requested.verificationToken,
      expiresAt: requested.expiresAt,
    },
  );

  assertEquals(
    await prepareHostDnsChallenge(
      target,
      { ...user, did: "did:plc:different" },
      requested.verificationToken,
      { now: 2_100, store, resolver },
    ),
    { ok: false, reason: "account_mismatch" },
  );
  const prepared = await prepareHostDnsChallenge(
    target,
    user,
    requested.verificationToken,
    { now: 2_150, store, resolver },
  );
  assert(prepared.ok);
  assertEquals(store.records.get(prepared.tokenHash)?.consumedAt, null);
  assertEquals(
    await verifyHostDnsChallenge(target, user, requested.verificationToken, {
      now: 2_200,
      store,
      resolver,
    }),
    { ok: true },
  );
  assertEquals(
    await verifyHostDnsChallenge(target, user, requested.verificationToken, {
      now: 2_300,
      store,
      resolver,
    }),
    { ok: false, reason: "already_used" },
  );
});

Deno.test("DNS proof requires the complete TXT value rather than a substring or padded value", async () => {
  for (
    const answer of [
      ["prefix-atmosphere-account-verification="],
      [" atmosphere-account-verification="],
      ["atmosphere-account-verification=", "-suffix"],
    ]
  ) {
    const store = memoryStore();
    const requested = await requestHostDnsChallenge(target, user, {
      now: 3_000,
      store,
    });
    assert(requested.ok);
    const chunks = answer.map((chunk) =>
      chunk.includes("verification=")
        ? `${chunk}${requested.verificationToken}`
        : chunk
    );
    assertEquals(
      await prepareHostDnsChallenge(
        target,
        user,
        requested.verificationToken,
        { now: 3_100, store, resolver: staticResolver([chunks]) },
      ),
      { ok: false, reason: "record_not_found" },
    );
  }
});

Deno.test("DNS proof rejects expired and cross-method tokens before doing a lookup", async () => {
  const store = memoryStore();
  const requested = await requestHostDnsChallenge(target, user, {
    now: 4_000,
    store,
  });
  assert(requested.ok);
  let lookups = 0;
  const resolver: HostDnsTxtResolver = {
    resolve() {
      lookups += 1;
      return Promise.resolve([[requested.recordValue]]);
    },
  };
  assertEquals(
    await prepareHostDnsChallenge(target, user, requested.verificationToken, {
      now: requested.expiresAt + 1,
      store,
      resolver,
    }),
    { ok: false, reason: "expired" },
  );
  assertEquals(lookups, 0);

  const tokenHash = await sha256B64u(requested.verificationToken);
  const record = store.records.get(tokenHash);
  assert(record);
  store.records.set(tokenHash, {
    ...record,
    emailFingerprint: "an-email-fingerprint",
    expiresAt: requested.expiresAt + 10_000,
  });
  assertEquals(
    await prepareHostDnsChallenge(target, user, requested.verificationToken, {
      now: 4_100,
      store,
      resolver,
    }),
    { ok: false, reason: "invalid" },
  );
  assertEquals(lookups, 0);
});

Deno.test("DNS proof rejects unsafe names before persistence or network access", async () => {
  for (
    const host of [
      "localhost",
      "fixture.test",
      "pds.internal",
      "pds.example.com/path",
      "127.0.0.1",
      "bad_name.example",
      `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${
        "d".repeat(48)
      }.com`,
    ]
  ) {
    const store = memoryStore();
    assertEquals(
      await requestHostDnsChallenge({ host }, user, { now: 5_000, store }),
      { ok: false, reason: "invalid_host" },
    );
    assertEquals(store.records.size, 0);
  }
});

Deno.test("DNS proof bounds lookup time and answer size without exposing resolver errors", async () => {
  const store = memoryStore();
  const requested = await requestHostDnsChallenge(target, user, {
    now: 6_000,
    store,
  });
  assert(requested.ok);

  const timedOut = await prepareHostDnsChallenge(
    target,
    user,
    requested.verificationToken,
    {
      now: 6_100,
      store,
      lookupTimeoutMs: 5,
      resolver: { resolve: () => new Promise(() => {}) },
    },
  );
  assertEquals(timedOut, { ok: false, reason: "dns_unavailable" });

  assertEquals(
    await prepareHostDnsChallenge(
      target,
      user,
      requested.verificationToken,
      {
        now: 6_150,
        store,
        resolver: {
          resolve: () => Promise.reject(new Deno.errors.NotFound()),
        },
      },
    ),
    { ok: false, reason: "record_not_found" },
  );

  const secret = `resolver-secret-${requested.verificationToken}`;
  assertEquals(
    await prepareHostDnsChallenge(
      target,
      user,
      requested.verificationToken,
      {
        now: 6_200,
        store,
        resolver: {
          resolve: () => Promise.reject(new Error(secret)),
        },
      },
    ),
    { ok: false, reason: "dns_unavailable" },
  );
  assertEquals(
    await prepareHostDnsChallenge(
      target,
      user,
      requested.verificationToken,
      {
        now: 6_300,
        store,
        resolver: staticResolver([["x".repeat(2_049)]]),
      },
    ),
    { ok: false, reason: "dns_unavailable" },
  );
});

Deno.test("DNS verification failures have concise safe user messages", () => {
  assertEquals(isHostDnsChallengeVerificationFailureReason("expired"), true);
  assertEquals(
    isHostDnsChallengeVerificationFailureReason("rate_limited"),
    false,
  );
  assertEquals(
    hostDnsChallengeVerificationFailureMessage("record_not_found"),
    "The exact TXT value was not found yet. Check the record and try again after DNS has updated.",
  );
  assertEquals(
    hostDnsChallengeVerificationFailureMessage("dns_unavailable"),
    "DNS could not be checked right now. Try again in a moment.",
  );
});

Deno.test("DNS challenge reservations enforce the existing per-host rate limit", async () => {
  const store = memoryStore();
  const results = await Promise.all(
    Array.from(
      { length: 6 },
      () => requestHostDnsChallenge(target, user, { now: 7_000, store }),
    ),
  );
  assertEquals(results.filter((result) => result.ok).length, 5);
  assertEquals(
    results.filter((result) => !result.ok && result.reason === "rate_limited")
      .length,
    1,
  );
});
