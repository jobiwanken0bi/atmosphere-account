import {
  type HostDnsTxtResolver,
  inspectHostDnsChallenge,
  prepareHostDnsChallenge,
  requestHostDnsChallenge,
  verifyHostDnsChallenge,
} from "./host-claim-dns.ts";
import {
  type HostClaimChallengeRecord,
  type HostClaimChallengeStore,
} from "./host-claim-challenge.ts";
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

function memoryStore(): HostClaimChallengeStore & {
  records: Map<string, HostClaimChallengeRecord>;
} {
  const records = new Map<string, HostClaimChallengeRecord>();
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

const target = { host: "pds.example.social" };
const user = { did: "did:plc:operator", handle: "operator.example" };

function staticResolver(
  answers: readonly (readonly string[])[],
): HostDnsTxtResolver {
  return { resolve: () => Promise.resolve(answers) };
}

Deno.test("DNS challenge is account-bound and persists only a token hash", async () => {
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
  assertEquals(requested.expiresAt, 24 * 60 * 60_000 + 1_000);
  const tokenHash = await sha256B64u(requested.verificationToken);
  const record = store.records.get(tokenHash);
  assert(record);
  assert(record.methodFingerprint.startsWith("dns-v1:"));
  assertEquals(record.methodBinding, null);
  assertEquals(
    JSON.stringify(record).includes(requested.verificationToken),
    false,
  );
});

Deno.test("DNS proof accepts one exact split TXT record and is single-use", async () => {
  const store = memoryStore();
  const requested = await requestHostDnsChallenge(target, user, {
    now: 2_000,
    store,
  });
  assert(requested.ok);
  const resolver = staticResolver([
    ["unrelated=value"],
    ["atmosphere-account-verification=", requested.verificationToken],
  ]);
  assert(
    (await inspectHostDnsChallenge(target, user, requested.verificationToken, {
      now: 2_050,
      store,
    })).ok,
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

Deno.test("DNS proof rejects padded, expired, and cross-method values before lookup", async () => {
  const store = memoryStore();
  const requested = await requestHostDnsChallenge(target, user, {
    now: 3_000,
    store,
  });
  assert(requested.ok);
  assertEquals(
    await prepareHostDnsChallenge(target, user, requested.verificationToken, {
      now: 3_100,
      store,
      resolver: staticResolver([[` ${requested.recordValue}`]]),
    }),
    { ok: false, reason: "record_not_found" },
  );

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
    methodFingerprint: "retired-proof-method",
  });
  assertEquals(
    await prepareHostDnsChallenge(target, user, requested.verificationToken, {
      now: 3_200,
      store,
      resolver,
    }),
    { ok: false, reason: "invalid" },
  );
  assertEquals(lookups, 0);
});

Deno.test("DNS proof rejects unsafe hosts and bounds resolver behavior", async () => {
  const store = memoryStore();
  for (const host of ["localhost", "127.0.0.1", "host.test", "bad host"]) {
    assertEquals(
      await requestHostDnsChallenge({ host }, user, { now: 4_000, store }),
      { ok: false, reason: "invalid_host" },
    );
  }
  const requested = await requestHostDnsChallenge(target, user, {
    now: 4_100,
    store,
  });
  assert(requested.ok);
  assertEquals(
    await prepareHostDnsChallenge(target, user, requested.verificationToken, {
      now: 4_200,
      store,
      lookupTimeoutMs: 1,
      resolver: { resolve: () => new Promise(() => {}) },
    }),
    { ok: false, reason: "dns_unavailable" },
  );
  assertEquals(
    await prepareHostDnsChallenge(target, user, requested.verificationToken, {
      now: 4_300,
      store,
      resolver: staticResolver(Array.from({ length: 33 }, () => ["x"])),
    }),
    { ok: false, reason: "dns_unavailable" },
  );
});
