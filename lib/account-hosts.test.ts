import {
  accountHostAvailability,
  accountHostClaimAuthorityMatchesUser,
  accountHostClaimUpdateQueryForTest,
  accountHostDashboardSettingsUpdateQueryForTest,
  DEFAULT_ACCOUNT_HOST_SORT,
  fetchHostProfileForTest,
  isAccountHostPubliclyListable,
  listSeededAccountHostFallback,
  lookupAccountHostHint,
  managedAccountHostsQueryForTest,
  normalizeAccountHostPublicHttpsUrl,
  normalizeAccountHostPublicServiceEndpoint,
  pinnedSeededAccountHostClaimHandle,
  profileHandleCandidatesForHost,
  resolveAccountHostClaimAuthority,
  sortAccountHostsForDirectory,
  upsertAccountHostClaimForOwnerForTest,
  validateAccountHostRegistrationInput,
  verifiedAccountHostOwnerDid,
  writeContactEmailClaimTransactionForTest,
} from "./account-hosts.ts";
import { convertQuestionParameters } from "./neon.ts";
import { runPostgresTransactionForTest } from "./postgres.ts";

function assert(condition: unknown, message = "Assertion failed"): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("fixed Bluesky profile fetch refuses redirects and non-JSON bodies", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let mode: "redirect" | "wrong-type" = "redirect";
    globalThis.fetch =
      ((_input: string | URL | Request, init?: RequestInit) => {
        assertEquals(init?.redirect, "manual");
        return Promise.resolve(
          mode === "redirect"
            ? new Response(null, { status: 302 })
            : new Response("<html></html>", {
              headers: { "content-type": "text/html" },
            }),
        );
      }) as typeof fetch;
    for (const next of ["redirect", "wrong-type"] as const) {
      mode = next;
      let rejected = false;
      try {
        await fetchHostProfileForTest("host.example");
      } catch {
        rejected = true;
      }
      assert(rejected, `expected ${next} response rejection`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OAuth host claims preserve an omitted directory preference on Postgres", () => {
  const query = accountHostClaimUpdateQueryForTest({
    host: "pds.example",
    claimHandle: "operator.example",
    claimDid: "did:plc:operator",
    timestamp: 1_800_000_000_000,
  });
  const postgresSql = convertQuestionParameters(query.sql);

  assert(!postgresSql.includes("operator_listing_opt_in"));
  assert(!postgresSql.includes("IS NULL"));
  assert(postgresSql.includes("WHEN source = 'seeded' THEN claim_handle"));
  assert(postgresSql.includes("WHEN source = 'seeded' THEN claim_did"));
  assertEquals(
    postgresSql.match(/\$\d+/g),
    ["$1", "$2", "$3", "$4"],
  );
  assertEquals(query.args, [
    "operator.example",
    "did:plc:operator",
    1_800_000_000_000,
    "pds.example",
  ]);
});

Deno.test("dashboard service observation flag has an explicit Postgres type context", () => {
  const query = accountHostDashboardSettingsUpdateQueryForTest(
    "pds.example",
    {
      serviceEndpoint: "https://pds.example",
      serviceRecordUri:
        "at://did:plc:operator/account.atmosphere.host.service/pds.example",
      serviceRecordCid: "bafyservice",
    },
    1_800_000_000_000,
    "did:plc:operator",
  );
  const postgresSql = convertQuestionParameters(query.sql);

  assert(postgresSql.includes("CASE WHEN $9 = 1 THEN $10"));
  assert(!postgresSql.includes("$9 IS NOT NULL"));
  assertEquals(query.args[8], 1);
  assertEquals(query.args[9], 1_800_000_000_000);
  assertEquals(
    postgresSql.match(/\$\d+/g)?.length,
    query.args.length,
  );

  const withoutRecord = accountHostDashboardSettingsUpdateQueryForTest(
    "pds.example",
    {},
    1_800_000_000_000,
    "did:plc:operator",
  );
  assertEquals(withoutRecord.args[8], 0);
});

Deno.test("unresolved prebound handles never authorize a matching session handle", () => {
  const user = { did: "did:plc:operator", handle: "operator.example" };
  assertEquals(
    accountHostClaimAuthorityMatchesUser(
      { handle: "operator.example", did: null },
      user,
    ),
    false,
  );
  assert(
    accountHostClaimAuthorityMatchesUser(
      { handle: "operator.example", did: user.did },
      user,
    ),
  );
});

Deno.test("managed-host discovery requires an operational ownership claim", () => {
  const query = managedAccountHostsQueryForTest("did:plc:operator");
  assert(query.sql.includes("INNER JOIN account_host_claim c"));
  assert(query.sql.includes("WHERE c.claimant_did = ?"));
  assert(!query.sql.includes("profile_did = ?"));
  assert(!query.sql.includes("h.claim_did = ?"));
  assertEquals(query.args, ["did:plc:operator"]);
});

Deno.test("seeded claim handles are pinned to code rather than mutable row values", () => {
  const seeded = listSeededAccountHostFallback().find((host) =>
    host.host === "pckt.cafe"
  );
  if (!seeded) throw new Error("expected pckt.cafe seed");
  assertEquals(
    pinnedSeededAccountHostClaimHandle({
      host: seeded.host,
      source: "seeded",
    }),
    "pckt.blog",
  );
  assertEquals(
    pinnedSeededAccountHostClaimHandle({
      host: seeded.host,
      source: "observed",
    }),
    null,
  );
});

Deno.test("prebound authority ignores a cached DID when live resolution fails", async () => {
  const seeded = listSeededAccountHostFallback().find((host) =>
    host.host === "pckt.cafe"
  );
  if (!seeded) throw new Error("expected pckt.cafe seed");
  const authority = await resolveAccountHostClaimAuthority(
    {
      ...seeded,
      claimHandle: "pckt.blog",
      claimDid: "did:plc:poisoned-cache",
    },
    {
      resolveIdentity: () =>
        Promise.reject(new Error("identity resolver unavailable")),
    },
  );
  assertEquals(authority, { handle: "pckt.blog", did: null });
});

Deno.test("privileged seeded-host ownership requires the pinned live DID", async () => {
  const seeded = listSeededAccountHostFallback().find((host) =>
    host.host === "pckt.cafe"
  );
  if (!seeded) throw new Error("expected pckt.cafe seed");
  const claim = {
    host: seeded.host,
    claimantDid: "did:plc:operator",
    claimantHandle: "pckt.blog",
    method: "oauth_atproto_account" as const,
    claimedAt: 1,
    verifiedAt: 1,
    updatedAt: 1,
  };
  const resolver = () =>
    Promise.resolve({
      did: "did:plc:operator",
      handle: "pckt.blog",
    });

  assertEquals(
    await verifiedAccountHostOwnerDid(seeded, claim, {
      resolveIdentity: resolver,
    }),
    claim.claimantDid,
  );
  assertEquals(
    await verifiedAccountHostOwnerDid(
      { ...seeded, source: "manual" },
      { ...claim, claimantDid: "did:plc:poisoned" },
      { resolveIdentity: resolver },
    ),
    null,
  );
  assertEquals(
    await verifiedAccountHostOwnerDid(seeded, claim, {
      resolveIdentity: () => Promise.reject(new Error("resolver offline")),
    }),
    null,
  );
});

Deno.test("contact-email ownership does not require the curated social DID", async () => {
  const seeded = listSeededAccountHostFallback().find((host) =>
    host.host === "pckt.cafe"
  );
  if (!seeded) throw new Error("expected pckt.cafe seed");
  const claim = {
    host: seeded.host,
    claimantDid: "did:plc:pds-operator",
    claimantHandle: "operator.example",
    method: "pds_contact_email" as const,
    claimedAt: 1,
    verifiedAt: 1,
    updatedAt: 1,
  };
  let resolved = false;
  assertEquals(
    await verifiedAccountHostOwnerDid(seeded, claim, {
      resolveIdentity: () => {
        resolved = true;
        return Promise.reject(new Error("curated social identity unavailable"));
      },
    }),
    claim.claimantDid,
  );
  assertEquals(resolved, false);
});

Deno.test("ordinary claimed hosts use their guarded claim owner", async () => {
  const host = {
    ...listSeededAccountHostFallback()[0],
    host: "ordinary.example",
    source: "manual" as const,
  };
  const claim = {
    host: host.host,
    claimantDid: "did:plc:operator",
    claimantHandle: "operator.example",
    method: "oauth_atproto_account" as const,
    claimedAt: 1,
    verifiedAt: 1,
    updatedAt: 1,
  };
  assertEquals(
    await verifiedAccountHostOwnerDid(host, claim),
    claim.claimantDid,
  );
});

Deno.test("contact-email host claims write an explicit directory preference on Postgres", () => {
  const query = accountHostClaimUpdateQueryForTest({
    host: "tranquil.example",
    claimHandle: "owner.example",
    claimDid: "did:plc:owner",
    operatorListingOptIn: false,
    timestamp: 1_800_000_000_000,
  });
  const postgresSql = convertQuestionParameters(query.sql);

  assert(postgresSql.includes("operator_listing_opt_in = $3"));
  assert(postgresSql.includes("operator_listing_opted_at = $4"));
  assert(!postgresSql.includes("IS NULL"));
  assertEquals(
    postgresSql.match(/\$\d+/g),
    ["$1", "$2", "$3", "$4", "$5", "$6"],
  );
  assertEquals(query.args, [
    "owner.example",
    "did:plc:owner",
    0,
    1_800_000_000_000,
    1_800_000_000_000,
    "tranquil.example",
  ]);
});

Deno.test("contact-email completion consumes the token and writes both ownership rows on one client", async () => {
  const statements: string[] = [];
  const client = {
    execute(
      query: string | { sql: string; args?: unknown[] },
    ) {
      statements.push(typeof query === "string" ? query : query.sql);
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };

  await writeContactEmailClaimTransactionForTest(client, {
    tokenHash: "token-hash",
    claim: {
      host: "pds.example",
      claimantDid: "did:plc:operator",
      claimantHandle: "operator.example",
      method: "pds_contact_email",
      claimedAt: 1_800_000_000_000,
      verifiedAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_000,
    },
    claimHandle: "operator.example",
    claimDid: "did:plc:operator",
    operatorListingOptIn: true,
    timestamp: 1_800_000_000_000,
  });

  assertEquals(
    statements.map((sql) =>
      sql.includes("account_host_claim_challenge")
        ? "consume"
        : sql.includes("INSERT INTO account_host_claim")
        ? "claim"
        : sql.includes("UPDATE account_host")
        ? "host"
        : "unexpected"
    ),
    ["consume", "claim", "host"],
  );
});

Deno.test("claim ownership upserts are idempotent only for the same DID", async () => {
  let captured = { sql: "", args: [] as unknown[] };
  const claim = {
    host: "pds.example",
    claimantDid: "did:plc:operator",
    claimantHandle: "operator.example",
    method: "oauth_atproto_account" as const,
    claimedAt: 1_800_000_000_000,
    verifiedAt: 1_800_000_000_000,
    updatedAt: 1_800_000_000_000,
  };
  const accepted = await upsertAccountHostClaimForOwnerForTest({
    execute(query, positionalArgs) {
      captured = typeof query === "string"
        ? { sql: query, args: positionalArgs ?? [] }
        : { sql: query.sql, args: query.args ?? [] };
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  }, claim);
  assert(accepted);
  assert(
    captured.sql.includes(
      "WHERE account_host_claim.claimant_did = excluded.claimant_did",
    ),
  );
  assertEquals(captured.args[0], claim.host);
  assertEquals(captured.args[1], claim.claimantDid);

  const rejected = await upsertAccountHostClaimForOwnerForTest({
    execute() {
      return Promise.resolve({ rows: [], rowsAffected: 0 });
    },
  }, claim);
  assertEquals(rejected, false);
});

Deno.test("contact-email completion stops before ownership writes when its token was used", async () => {
  const statements: string[] = [];
  const client = {
    execute(
      query: string | { sql: string; args?: unknown[] },
    ) {
      const sql = typeof query === "string" ? query : query.sql;
      statements.push(sql);
      if (/SELECT host, claimant_did, expires_at, consumed_at/.test(sql)) {
        return Promise.resolve({
          rows: [{
            host: "pds.example",
            claimant_did: "did:plc:operator",
            expires_at: 1_800_000_100_000,
            consumed_at: 1_800_000_000_000,
          }],
          rowsAffected: 0,
        });
      }
      return Promise.resolve({ rows: [], rowsAffected: 0 });
    },
  };
  let message = "";
  try {
    await writeContactEmailClaimTransactionForTest(client, {
      tokenHash: "used-token-hash",
      claim: {
        host: "pds.example",
        claimantDid: "did:plc:operator",
        claimantHandle: "operator.example",
        method: "pds_contact_email",
        claimedAt: 1_800_000_000_000,
        verifiedAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000,
      },
      claimHandle: "operator.example",
      claimDid: "did:plc:operator",
      timestamp: 1_800_000_000_000,
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message, "already_used");
  assertEquals(statements.length, 2);
  assert(statements[0].includes("account_host_claim_challenge"));
  assert(statements[1].includes("account_host_claim_challenge"));
});

Deno.test("a failed contact-email ownership write rolls token consumption back", async () => {
  const statements: string[] = [];
  const writeFailure = new Error("account_host write failed");
  const pool = {
    connect: () =>
      Promise.resolve({
        query(statement: string) {
          statements.push(statement);
          if (
            statement.includes("UPDATE account_host\n") &&
            !statement.includes("account_host_claim_challenge")
          ) {
            return Promise.reject(writeFailure);
          }
          return Promise.resolve({ rows: [], rowCount: 1 });
        },
        release() {},
      }),
  };

  let caught: unknown = null;
  try {
    await runPostgresTransactionForTest(
      pool,
      (transaction) =>
        writeContactEmailClaimTransactionForTest(transaction, {
          tokenHash: "retryable-token-hash",
          claim: {
            host: "pds.example",
            claimantDid: "did:plc:operator",
            claimantHandle: "operator.example",
            method: "pds_contact_email",
            claimedAt: 1_800_000_000_000,
            verifiedAt: 1_800_000_000_000,
            updatedAt: 1_800_000_000_000,
          },
          claimHandle: "operator.example",
          claimDid: "did:plc:operator",
          timestamp: 1_800_000_000_000,
        }),
    );
  } catch (error) {
    caught = error;
  }

  assert(caught === writeFailure);
  assertEquals(statements[0], "BEGIN");
  assert(statements[1].includes("account_host_claim_challenge"));
  assert(statements[2].includes("INSERT INTO account_host_claim"));
  assert(statements[3].includes("UPDATE account_host\n"));
  assertEquals(statements.at(-1), "ROLLBACK");
});

Deno.test("seeded account host fallback includes known public hosts", () => {
  const hosts = listSeededAccountHostFallback();
  assert(hosts.length >= 14);
  assert(hosts.some((host) => host.host === "bsky.network"));
  assert(hosts.some((host) => host.host === "blacksky.community"));
  assert(hosts.some((host) => host.host === "pckt.cafe"));
  assertEquals(
    hosts.find((host) => host.host === "atproto.brid.gy")?.profileHandle,
    "ap.brid.gy",
  );
  assertEquals(
    hosts.find((host) => host.host === "pds.wsocial.network")?.profileHandle,
    "wsocial.eu",
  );
  assertEquals(
    hosts.find((host) => host.host === "roomy.chat")?.profileHandle,
    "roomy.space",
  );
  assertEquals(
    hosts.find((host) => host.host === "northsky.social")?.profileHandle,
    "transrights.northsky.social",
  );
  assertEquals(
    hosts.find((host) => host.host === "bookhive.social")?.profileHandle,
    "bookhive.buzz",
  );
});

Deno.test("seeded social identities preserve their separate PDS domains", () => {
  const hosts = listSeededAccountHostFallback();
  const bridgy = hosts.find((host) => host.host === "atproto.brid.gy");
  const wsocial = hosts.find((host) => host.host === "pds.wsocial.network");
  assertEquals(bridgy?.serviceEndpoint, "https://atproto.brid.gy");
  assertEquals(wsocial?.serviceEndpoint, "https://pds.wsocial.network");
  assertEquals(wsocial?.signupStatus, "invite_required");
});

Deno.test("seeded account host fallback searches friendly host fields", () => {
  assertEquals(
    listSeededAccountHostFallback({ query: "blacksky" }).map((host) =>
      host.host
    ),
    ["blacksky.community"],
  );
  assertEquals(
    listSeededAccountHostFallback({ query: "pckt.blog" }).map((host) =>
      host.host
    ),
    ["pckt.cafe"],
  );
  assertEquals(
    listSeededAccountHostFallback({ query: "Europe" }).map((host) => host.host),
    ["eurosky.social"],
  );
});

Deno.test("seeded account host fallback preserves real empty search states", () => {
  assertEquals(listSeededAccountHostFallback({ query: "zzzz-no-host" }), []);
});

Deno.test("host directory sorts providers by total accounts", () => {
  const [first, second, third] = listSeededAccountHostFallback().slice(0, 3);
  assert(first && second && third, "expected seeded hosts");
  const hosts = [
    { ...first, observedAccountCount: 20, observedActiveAccountCount: 4 },
    { ...second, observedAccountCount: 5, observedActiveAccountCount: 5 },
    { ...third, observedAccountCount: 40, observedActiveAccountCount: 1 },
  ];
  assertEquals(
    sortAccountHostsForDirectory(hosts, "accounts").map((host) => host.host),
    [third.host, first.host, second.host],
  );
});

Deno.test("default host sort prioritizes account count before claims", () => {
  const [first, second, third, fourth] = listSeededAccountHostFallback().slice(
    0,
    4,
  );
  assert(first && second && third && fourth, "expected seeded hosts");
  const observedActive = {
    ...first,
    verificationStatus: "observed" as const,
    observedAccountCount: 10_000,
    observedActiveAccountCount: 10_000,
  };
  const claimedInactive = {
    ...second,
    verificationStatus: "claimed" as const,
    observedAccountCount: 100,
    observedActiveAccountCount: 0,
  };
  const claimedActiveSmall = {
    ...third,
    verificationStatus: "claimed" as const,
    observedAccountCount: 5,
    observedActiveAccountCount: 5,
  };
  const verifiedActiveLarge = {
    ...fourth,
    verificationStatus: "verified" as const,
    observedAccountCount: 50,
    observedActiveAccountCount: 10,
  };

  assertEquals(
    sortAccountHostsForDirectory([
      observedActive,
      claimedInactive,
      claimedActiveSmall,
      verifiedActiveLarge,
    ], DEFAULT_ACCOUNT_HOST_SORT).map((host) => host.host),
    [
      observedActive.host,
      claimedInactive.host,
      verifiedActiveLarge.host,
      claimedActiveSmall.host,
    ],
  );

  assertEquals(
    sortAccountHostsForDirectory([
      { ...observedActive, observedAccountCount: 100 },
      { ...claimedInactive, observedAccountCount: 100 },
      { ...claimedActiveSmall, observedAccountCount: 100 },
    ], DEFAULT_ACCOUNT_HOST_SORT).map((host) => host.host),
    [
      claimedInactive.host,
      claimedActiveSmall.host,
      observedActive.host,
    ],
  );
});

Deno.test("public host policy requires recent reachability and public intent", () => {
  const now = 1_000_000_000;
  const base = {
    ...listSeededAccountHostFallback()[0],
    source: "observed" as const,
    verificationStatus: "observed" as const,
    signupUrl: null,
    serviceRecordUri: null,
    observedActiveAccountCount: 1,
    lastIndexedAccountAt: now,
    lastActiveAt: now,
  };
  assertEquals(isAccountHostPubliclyListable(base, now), false);
  assertEquals(
    isAccountHostPubliclyListable(
      { ...base, serviceRecordUri: "at://host" },
      now,
    ),
    false,
  );
  assertEquals(
    isAccountHostPubliclyListable({
      ...base,
      signupUrl: "https://host.example.com/signup",
    }, now),
    true,
  );
  assertEquals(
    isAccountHostPubliclyListable({
      ...base,
      serviceRecordUri: "at://host",
      lastIndexedAccountAt: 0,
    }, now),
    false,
  );
  assertEquals(
    isAccountHostPubliclyListable({
      ...base,
      publicIntentStatus: "detected",
      publicIntentSource: "pds_open_signup",
      publicIntentCheckedAt: now,
    }, now),
    true,
  );
  assertEquals(
    isAccountHostPubliclyListable({
      ...base,
      publicIntentStatus: "detected",
      publicIntentSource: "pds_open_signup",
      publicIntentCheckedAt: 0,
    }, now),
    false,
  );
});

Deno.test("claimed hosts receive a short inactivity grace period", () => {
  const now = 1_000_000_000;
  const base = {
    ...listSeededAccountHostFallback()[0],
    source: "manual" as const,
    verificationStatus: "claimed" as const,
    observedActiveAccountCount: 0,
    lastIndexedAccountAt: now,
    lastActiveAt: now - 60 * 60 * 1000,
  };
  assertEquals(isAccountHostPubliclyListable(base, now), true);
  assertEquals(
    isAccountHostPubliclyListable({ ...base, lastActiveAt: 0 }, now),
    false,
  );
  assertEquals(
    isAccountHostPubliclyListable({
      ...base,
      lastActiveAt: 0,
      conformanceStatus: "passed",
      conformanceExpiresAt: now + 1,
    }, now),
    true,
  );
  assertEquals(
    isAccountHostPubliclyListable({
      ...base,
      operatorListingOptIn: false,
    }, now),
    false,
  );
  assertEquals(
    isAccountHostPubliclyListable({
      ...base,
      operatorListingOptIn: true,
    }, now),
    true,
  );
});

Deno.test("host availability distinguishes directory baseline from grace exceptions", () => {
  const now = 1_000_000_000;
  const host = {
    ...listSeededAccountHostFallback()[0],
    verificationStatus: "claimed" as const,
    observedActiveAccountCount: 4,
    lastIndexedAccountAt: now,
    lastActiveAt: now,
  };
  assertEquals(accountHostAvailability(host, now), "relay_active");
  assertEquals(
    accountHostAvailability({
      ...host,
      observedActiveAccountCount: 0,
      conformanceStatus: "passed",
      conformanceExpiresAt: now + 1,
    }, now),
    "reachable",
  );
  assertEquals(
    accountHostAvailability({
      ...host,
      observedActiveAccountCount: 0,
    }, now),
    "grace",
  );
});

Deno.test("account host hints resolve known Bluesky endpoints without DB hydration", () => {
  assertEquals(lookupAccountHostHint("https://bsky.social"), {
    host: "bsky.network",
    displayName: "Bluesky",
    endpoint: "https://bsky.social",
    verificationStatus: "observed",
  });
  assertEquals(
    lookupAccountHostHint("https://shimeji.us-east.host.bsky.network"),
    {
      host: "bsky.network",
      displayName: "Bluesky",
      endpoint: "https://shimeji.us-east.host.bsky.network",
      verificationStatus: "observed",
    },
  );
});

Deno.test("account host hints aggregate known provider PDS aliases", () => {
  assertEquals(lookupAccountHostHint("https://blacksky.app"), {
    host: "blacksky.community",
    displayName: "Blacksky",
    endpoint: "https://blacksky.app",
    verificationStatus: "observed",
  });
  assertEquals(lookupAccountHostHint("https://tngl.sh"), {
    host: "tangled.org",
    displayName: "Tangled",
    endpoint: "https://tngl.sh",
    verificationStatus: "observed",
  });
});

Deno.test("account host hints fall back to observed endpoint names", () => {
  assertEquals(lookupAccountHostHint("https://pds.example.com"), {
    host: "pds.example.com",
    displayName: "pds.example.com",
    endpoint: "https://pds.example.com",
    verificationStatus: "observed",
  });
  assertEquals(lookupAccountHostHint(null), null);
});

Deno.test("host profile refresh checks the host-domain handle before the configured social handle", () => {
  assertEquals(
    profileHandleCandidatesForHost({
      host: "pckt.cafe",
      profileHandle: "pckt.blog",
    }),
    ["pckt.cafe", "pckt.blog"],
  );
  assertEquals(
    profileHandleCandidatesForHost({
      host: "sprk.so",
      profileHandle: "sprk.so",
    }),
    ["sprk.so"],
  );
});

Deno.test("account host public URL normalizer rejects unsafe account links", () => {
  assertEquals(
    normalizeAccountHostPublicHttpsUrl("https://example.host/account#settings"),
    "https://example.host/account",
  );
  for (
    const unsafe of [
      "/account",
      "http://example.host/account",
      "https://user:pass@example.host/account",
      "https://localhost/account",
      "https://127.0.0.1/account",
      "https://10.0.0.8/account",
      "https://[::1]/account",
    ]
  ) {
    assertEquals(normalizeAccountHostPublicHttpsUrl(unsafe), null);
  }
});

Deno.test("account host service endpoint normalizer rejects unsafe origins", () => {
  assertEquals(
    normalizeAccountHostPublicServiceEndpoint("https://pds.example.host/"),
    "https://pds.example.host",
  );
  for (
    const unsafe of [
      "http://pds.example.host",
      "https://user:pass@pds.example.host",
      "https://localhost",
      "https://192.168.1.10",
      "https://[fd00::1]",
    ]
  ) {
    assertEquals(normalizeAccountHostPublicServiceEndpoint(unsafe), null);
  }
});

Deno.test("account host registration validation rejects unsafe fields before publish", () => {
  const user = { did: "did:plc:host", handle: "pckt.cafe" };
  assertEquals(
    validateAccountHostRegistrationInput({
      host: "pckt.cafe",
      displayName: "Pckt",
      serviceEndpoint: "https://127.0.0.1",
      signupStatus: "open",
    }, user),
    {
      ok: false,
      reason: "invalid_service_endpoint",
      message: "Enter the HTTPS origin for the host PDS service endpoint.",
    },
  );
  assertEquals(
    validateAccountHostRegistrationInput({
      host: "pckt.cafe",
      displayName: "Pckt",
      signupStatus: "open",
    }, user),
    {
      ok: false,
      reason: "invalid_service_endpoint",
      message: "Enter the HTTPS origin for the host PDS service endpoint.",
    },
  );
  assertEquals(
    validateAccountHostRegistrationInput({
      host: "pckt.cafe",
      displayName: "Pckt",
      signupUrl: "https://127.0.0.1/signup",
      serviceEndpoint: "https://pds.pckt.cafe",
      signupStatus: "open",
    }, user),
    {
      ok: false,
      reason: "invalid_signup_url",
      message: "Use an HTTPS URL for the host signup flow.",
    },
  );
  assertEquals(
    validateAccountHostRegistrationInput({
      host: "pckt.cafe",
      displayName: "Pckt",
      serviceEndpoint: "https://pds.pckt.cafe",
      accountManagementUrl: "/account",
      signupStatus: "open",
    }, user),
    {
      ok: false,
      reason: "invalid_account_management_url",
      message: "Use an HTTPS URL for the host account management page.",
    },
  );
});
