import {
  accountHostAvailability,
  accountHostClaimAuthorityMatchesUser,
  accountHostClaimUpdateQueryForTest,
  accountHostDashboardSettingsUpdateQueryForTest,
  DEFAULT_ACCOUNT_HOST_SORT,
  fetchHostProfileForTest,
  finalizeEmailClaimRecoveryTransactionForTest,
  isAccountHostPubliclyListable,
  isCompletedDnsClaimReplayForTest,
  listSeededAccountHostFallback,
  lookupAccountHostHint,
  managedAccountHostsQueryForTest,
  normalizeAccountHostPublicHttpsUrl,
  normalizeAccountHostPublicServiceEndpoint,
  pinnedSeededAccountHostClaimHandle,
  profileHandleCandidatesForHost,
  recordHostClaimRecoveryNotificationTransactionForTest,
  reserveHostClaimRecoveryNotificationTransactionForTest,
  resolveAccountHostClaimAuthority,
  sortAccountHostsForDirectory,
  startEmailClaimRecoveryTransactionForTest,
  upsertAccountHostClaimForOwnerForTest,
  validateAccountHostRegistrationInput,
  verifiedAccountHostOwnerDid,
  writeContactEmailClaimTransactionForTest,
  writeDnsClaimTransactionForTest,
} from "./account-hosts.ts";
import { convertQuestionParameters } from "./neon.ts";
import type { ResolvedHostOwnerTransferContext } from "./host-owner-transfer-intent.ts";

function assert(condition: unknown, message = "Assertion failed"): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("fixed Bluesky profile fetch bounds and validates upstream responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let response = new Response(null, { status: 302 });
    globalThis.fetch =
      ((_input: string | URL | Request, init?: RequestInit) => {
        assertEquals(init?.redirect, "manual");
        return Promise.resolve(response);
      }) as typeof fetch;

    for (
      const malicious of [
        new Response(null, { status: 302 }),
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        }),
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(256 * 1024));
              controller.enqueue(new Uint8Array([0x20]));
              controller.close();
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ]
    ) {
      response = malicious;
      let rejected = false;
      try {
        await fetchHostProfileForTest("host.example");
      } catch {
        rejected = true;
      }
      assert(rejected, "expected malicious upstream response rejection");
    }

    for (
      const invalidIdentity of [
        { did: "not-a-did", handle: "host.example" },
        { did: "did:plc:host", handle: "not a handle" },
      ]
    ) {
      response = Response.json(invalidIdentity);
      assertEquals(await fetchHostProfileForTest("host.example"), null);
    }

    response = Response.json({
      did: "did:plc:host",
      handle: "HOST.EXAMPLE",
      displayName: " Host operator ",
      description: " Account hosting ",
      avatar: "http://127.0.0.1/avatar.png",
    });
    assertEquals(await fetchHostProfileForTest("host.example"), {
      did: "did:plc:host",
      handle: "host.example",
      displayName: "Host operator",
      description: "Account hosting",
      avatarUrl: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function resolvedTransferForTest(): ResolvedHostOwnerTransferContext {
  return {
    token: "v1.test.signature",
    intent: {
      host: "pds.example",
      previousOwnerDid: "did:plc:old-operator",
      previousOwnerUpdatedAt: 1_799_998_000_000,
      jti: "T".repeat(32),
      issuedAt: 1_799_999_000_000,
      expiresAt: 1_800_085_400_000,
    },
  } as unknown as ResolvedHostOwnerTransferContext;
}

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

Deno.test("historical contact-email ownership remains operational", async () => {
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

Deno.test("DNS ownership does not require the curated social DID", async () => {
  const seeded = listSeededAccountHostFallback().find((host) =>
    host.host === "pckt.cafe"
  );
  if (!seeded) throw new Error("expected pckt.cafe seed");
  const claim = {
    host: seeded.host,
    claimantDid: "did:plc:dns-operator",
    claimantHandle: "operator.example",
    method: "dns_txt" as const,
    claimedAt: 1,
    verifiedAt: 1,
    updatedAt: 1,
  };
  let resolved = false;
  assertEquals(
    await verifiedAccountHostOwnerDid(seeded, claim, {
      resolveIdentity: () => {
        resolved = true;
        return Promise.reject(new Error("resolver unavailable"));
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

Deno.test("local fixture ownership is invalid outside development", async () => {
  const host = {
    ...listSeededAccountHostFallback()[0],
    host: "fixture.test",
    source: "manual" as const,
  };
  const claim = {
    host: host.host,
    claimantDid: "did:plc:fixture",
    claimantHandle: "fixture.test",
    method: "local_dev_fixture" as const,
    claimedAt: 1,
    verifiedAt: 1,
    updatedAt: 1,
  };
  assertEquals(
    await verifiedAccountHostOwnerDid(host, claim, { isDev: true }),
    claim.claimantDid,
  );
  assertEquals(
    await verifiedAccountHostOwnerDid(host, claim, { isDev: false }),
    null,
  );
});

Deno.test("host claims write an explicit directory preference on Postgres", () => {
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

Deno.test("contact email completion consumes proof, creates ownership, and stores opaque evidence atomically", async () => {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const statement = typeof query === "string"
        ? { sql: query, args: [] }
        : { sql: query.sql, args: query.args ?? [] };
      statements.push(statement);
      if (
        statement.sql.includes("SELECT 1 FROM account_host_claim_challenge")
      ) {
        return Promise.resolve({ rows: [{ 1: 1 }], rowsAffected: 0 });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };
  const ts = 1_800_000_000_000;
  await writeContactEmailClaimTransactionForTest(client, {
    proof: {
      ok: true,
      tokenHash: "T".repeat(43),
      host: "pds.example",
      claimantDid: "did:plc:operator",
      endpointOrigin: "https://pds.example",
      pdsDid: "did:web:pds.example",
      emailFingerprint: "E".repeat(43),
      methodBinding: `pds-contact-email-v2.${"B".repeat(43)}`,
      requestedAt: ts - 1_000,
      expiresAt: ts + 1_000,
      deliveryId: null,
    },
    claim: {
      host: "pds.example",
      claimantDid: "did:plc:operator",
      claimantHandle: "operator.example",
      method: "pds_contact_email",
      claimedAt: ts,
      verifiedAt: ts,
      updatedAt: ts,
    },
    claimHandle: "operator.example",
    claimDid: "did:plc:operator",
    timestamp: ts,
  });

  assertEquals(statements.length, 5);
  assert(statements[0].sql.includes("account_host_claim_challenge"));
  assert(
    statements[0].sql.includes("method_binding LIKE 'pds-contact-email-v2.%'"),
  );
  assert(statements[1].sql.includes("account_host_claim_challenge"));
  assert(statements[2].sql.includes("ON CONFLICT(host) DO NOTHING"));
  assert(statements[3].sql.includes("account_host_claim_evidence"));
  assert(statements[4].sql.includes("UPDATE account_host"));
  const serialized = JSON.stringify(statements);
  assert(!serialized.includes("operator@example.com"));
  assert(serialized.includes("https://pds.example"));
  assert(serialized.includes("did:web:pds.example"));
});

Deno.test("contact email claim conflicts stop before evidence or host writes", async () => {
  const statements: string[] = [];
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const sql = typeof query === "string" ? query : query.sql;
      statements.push(sql);
      if (sql.includes("SELECT 1 FROM account_host_claim_challenge")) {
        return Promise.resolve({ rows: [{ 1: 1 }], rowsAffected: 0 });
      }
      return Promise.resolve({
        rows: [],
        rowsAffected: sql.includes("INSERT INTO account_host_claim (") ? 0 : 1,
      });
    },
  };
  let rejected = false;
  try {
    await writeContactEmailClaimTransactionForTest(client, {
      proof: {
        ok: true,
        tokenHash: "T".repeat(43),
        host: "pds.example",
        claimantDid: "did:plc:operator",
        endpointOrigin: "https://pds.example",
        pdsDid: "did:web:pds.example",
        emailFingerprint: "E".repeat(43),
        methodBinding: `pds-contact-email-v2.${"B".repeat(43)}`,
        requestedAt: 1,
        expiresAt: 3,
        deliveryId: null,
      },
      claim: {
        host: "pds.example",
        claimantDid: "did:plc:operator",
        claimantHandle: "operator.example",
        method: "pds_contact_email",
        claimedAt: 2,
        verifiedAt: 2,
        updatedAt: 2,
      },
      claimHandle: "operator.example",
      claimDid: "did:plc:operator",
      timestamp: 2,
    });
  } catch {
    rejected = true;
  }
  assert(rejected);
  assertEquals(statements.length, 3);
  assert(!statements.some((sql) => sql.includes("claim_evidence")));
});

Deno.test("contact email ownership rejects a differently classified challenge", async () => {
  const statements: string[] = [];
  let rejected = false;
  try {
    await writeContactEmailClaimTransactionForTest({
      execute(query) {
        const sql = typeof query === "string" ? query : query.sql;
        statements.push(sql);
        return Promise.resolve({ rows: [], rowsAffected: 0 });
      },
    }, {
      proof: {
        ok: true,
        tokenHash: "D".repeat(43),
        host: "pds.example",
        claimantDid: "did:plc:operator",
        endpointOrigin: "https://pds.example",
        pdsDid: "did:web:pds.example",
        emailFingerprint: "E".repeat(43),
        methodBinding: `pds-contact-email-v2.${"B".repeat(43)}`,
        requestedAt: 1,
        expiresAt: 3,
        deliveryId: null,
      },
      claim: {
        host: "pds.example",
        claimantDid: "did:plc:operator",
        claimantHandle: "operator.example",
        method: "pds_contact_email",
        claimedAt: 2,
        verifiedAt: 2,
        updatedAt: 2,
      },
      claimHandle: "operator.example",
      claimDid: "did:plc:operator",
      timestamp: 2,
    });
  } catch {
    rejected = true;
  }
  assert(rejected);
  assertEquals(statements.length, 1);
  assert(!statements.some((sql) => sql.includes("SET consumed_at")));
  assert(
    !statements.some((sql) => sql.includes("INSERT INTO account_host_claim (")),
  );
});

function emailOwnerRow(updatedAt = 1_800_000_000_000) {
  return {
    claimant_did: "did:plc:old-owner",
    claimant_handle: "old.example",
    method: "pds_contact_email",
    claimed_at: updatedAt - 10,
    verified_at: updatedAt - 10,
    updated_at: updatedAt,
  };
}

function pendingRecoveryRow(overrides: Record<string, unknown> = {}) {
  const requestedAt = 1_800_000_000_000;
  return {
    id: "dns-recovery:proof-hash",
    host: "pds.example",
    previous_owner_did: "did:plc:old-owner",
    previous_owner_handle: "old.example",
    previous_owner_updated_at: requestedAt,
    requester_did: "did:plc:new-owner",
    requester_handle: "new.example",
    proof_method: "dns_txt",
    proof_token_hash: "proof-hash",
    requested_at: requestedAt,
    eligible_at: requestedAt + 48 * 60 * 60 * 1000,
    expires_at: requestedAt + 9 * 24 * 60 * 60 * 1000,
    status: "pending",
    notification_status: "pending",
    notification_attempted_at: null,
    finalization_proof_token_hash: null,
    completed_at: null,
    ...overrides,
  };
}

function freshFinalDnsProof(overrides: Record<string, unknown> = {}) {
  const createdAt = 1_800_000_000_000 + 49 * 60 * 60 * 1000;
  return {
    ok: true as const,
    tokenHash: "final-proof-hash",
    host: "pds.example",
    claimantDid: "did:plc:new-owner",
    methodFingerprint: "dns-v1:final-proof",
    createdAt,
    expiresAt: createdAt + 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

Deno.test("DNS recovery consumes proof only after reserving an empty pending slot", async () => {
  const statements: string[] = [];
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const sql = typeof query === "string" ? query : query.sql;
      statements.push(sql);
      if (sql.includes("FROM account_host_claim WHERE")) {
        return Promise.resolve({ rows: [emailOwnerRow()], rowsAffected: 0 });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };
  const recovery = await startEmailClaimRecoveryTransactionForTest(client, {
    tokenHash: "proof-hash",
    host: "pds.example",
    previousClaim: {
      host: "pds.example",
      claimantDid: "did:plc:old-owner",
      claimantHandle: "old.example",
      method: "pds_contact_email",
      claimedAt: 1_799_999_999_990,
      verifiedAt: 1_799_999_999_990,
      updatedAt: 1_800_000_000_000,
    },
    requester: { did: "did:plc:new-owner", handle: "new.example" },
    requestedAt: 1_800_000_000_100,
  });

  const consumeIndex = statements.findIndex((sql) =>
    sql.includes("account_host_claim_challenge")
  );
  const pendingCheckIndex = statements.findIndex((sql) =>
    sql.includes("SELECT id FROM account_host_claim_recovery") &&
    sql.includes("LIMIT 1")
  );
  const insertIndex = statements.findIndex((sql) =>
    sql.includes("INSERT INTO account_host_claim_recovery (")
  );
  assert(pendingCheckIndex >= 0 && consumeIndex > pendingCheckIndex);
  assert(insertIndex > consumeIndex);
  assertEquals(recovery.status, "pending");
  assertEquals(recovery.currentOwnerDid, "did:plc:old-owner");
  assert(
    !statements.some((sql) => sql.includes("UPDATE account_host_claim SET")),
  );
});

Deno.test("competing DNS recovery leaves the second proof unconsumed", async () => {
  const statements: string[] = [];
  let pendingReads = 0;
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const sql = typeof query === "string" ? query : query.sql;
      statements.push(sql);
      if (sql.includes("FROM account_host_claim WHERE")) {
        return Promise.resolve({ rows: [emailOwnerRow()], rowsAffected: 0 });
      }
      if (
        sql.includes("FROM account_host_claim_recovery") &&
        sql.includes("status = 'pending'")
      ) {
        pendingReads++;
        return Promise.resolve({
          rows: pendingReads === 1 ? [] : [pendingRecoveryRow()],
          rowsAffected: 0,
        });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };
  let rejected = false;
  try {
    await startEmailClaimRecoveryTransactionForTest(client, {
      tokenHash: "second-proof-hash",
      host: "pds.example",
      previousClaim: {
        host: "pds.example",
        claimantDid: "did:plc:old-owner",
        claimantHandle: "old.example",
        method: "pds_contact_email",
        claimedAt: 1,
        verifiedAt: 1,
        updatedAt: 1_800_000_000_000,
      },
      requester: { did: "did:plc:competitor", handle: "competitor.example" },
      requestedAt: 1_800_000_000_100,
    });
  } catch {
    rejected = true;
  }
  assert(rejected);
  assert(
    !statements.some((sql) => sql.includes("account_host_claim_challenge")),
  );
});

Deno.test("cooled DNS recovery finalization uses owner and pending CAS then resets approvals", async () => {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const requestedAt = 1_800_000_000_000;
  const at = requestedAt + 49 * 60 * 60 * 1000;
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const statement = typeof query === "string"
        ? { sql: query, args: [] }
        : { sql: query.sql, args: query.args ?? [] };
      statements.push(statement);
      if (
        statement.sql.includes("FROM account_host_claim_recovery") &&
        statement.sql.includes("ORDER BY")
      ) {
        return Promise.resolve({
          rows: [pendingRecoveryRow({
            notification_attempted_at: 1_800_000_000_100,
          })],
          rowsAffected: 0,
        });
      }
      if (statement.sql.includes("FROM account_host_claim WHERE")) {
        return Promise.resolve({ rows: [emailOwnerRow()], rowsAffected: 0 });
      }
      if (statement.sql.includes("FROM account_host_claim_challenge")) {
        return Promise.resolve({ rows: [{ 1: 1 }], rowsAffected: 0 });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };
  const finalized = await finalizeEmailClaimRecoveryTransactionForTest(
    client,
    "pds.example",
    { did: "did:plc:new-owner", handle: "new.example" },
    freshFinalDnsProof(),
    at,
  );
  assert(finalized.ok);
  if (!finalized.ok) return;
  const ownerCas = statements.find((statement) =>
    statement.sql.includes("UPDATE account_host_claim SET")
  );
  assert(ownerCas?.sql.includes("method = 'pds_contact_email'"));
  assertEquals(ownerCas?.args.slice(-3), [
    "pds.example",
    "did:plc:old-owner",
    requestedAt,
  ]);
  const pendingCas = statements.find((statement) =>
    statement.sql.includes("status = 'completed'")
  );
  assert(pendingCas?.sql.includes("requester_did = ?"));
  assert(
    statements.some((statement) => statement.sql.includes("avatar_url = NULL")),
  );
  assert(
    statements.some((statement) =>
      statement.sql.includes("host_approved_at = NULL")
    ),
  );
  assert(
    statements.some((statement) =>
      statement.sql.includes("event") && statement.args.includes("finalized") &&
      statement.args.includes("final-proof-hash")
    ),
  );
  assertEquals(finalized.claim.method, "dns_txt");
  assertEquals(finalized.recovery.status, "completed");
});

Deno.test("completed DNS recovery finalization is one-shot idempotent", async () => {
  const statements: string[] = [];
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const sql = typeof query === "string" ? query : query.sql;
      statements.push(sql);
      if (sql.includes("FROM account_host_claim_recovery")) {
        return Promise.resolve({
          rows: [pendingRecoveryRow({
            status: "completed",
            finalization_proof_token_hash: "final-proof-hash",
            completed_at: 99,
          })],
          rowsAffected: 0,
        });
      }
      if (sql.includes("FROM account_host_claim WHERE")) {
        return Promise.resolve({
          rows: [{
            host: "pds.example",
            claimant_did: "did:plc:new-owner",
            claimant_handle: "new.example",
            method: "dns_txt",
            claimed_at: 99,
            verified_at: 99,
            updated_at: 99,
          }],
          rowsAffected: 0,
        });
      }
      throw new Error(`unexpected write: ${sql}`);
    },
  };
  const result = await finalizeEmailClaimRecoveryTransactionForTest(
    client,
    "pds.example",
    { did: "did:plc:new-owner", handle: "new.example" },
    freshFinalDnsProof(),
    100,
  );
  assert(result.ok);
  assertEquals(statements.length, 2);
});

Deno.test("initiating or expired DNS proof cannot finalize a cooled recovery", async () => {
  for (
    const [proof, expectedReason] of [
      [
        freshFinalDnsProof({ createdAt: 1_800_000_000_100 }),
        "fresh_dns_required",
      ],
      [
        freshFinalDnsProof({
          expiresAt: 1_800_000_000_000 + 49 * 60 * 60 * 1000 - 1,
        }),
        "fresh_dns_required",
      ],
    ] as const
  ) {
    const statements: string[] = [];
    const client = {
      execute(query: string | { sql: string; args?: unknown[] }) {
        const sql = typeof query === "string" ? query : query.sql;
        statements.push(sql);
        if (sql.includes("FROM account_host_claim_recovery")) {
          return Promise.resolve({
            rows: [pendingRecoveryRow()],
            rowsAffected: 0,
          });
        }
        if (sql.includes("FROM account_host_claim WHERE")) {
          return Promise.resolve({ rows: [emailOwnerRow()], rowsAffected: 0 });
        }
        return Promise.resolve({ rows: [], rowsAffected: 1 });
      },
    };
    const result = await finalizeEmailClaimRecoveryTransactionForTest(
      client,
      "pds.example",
      { did: "did:plc:new-owner", handle: "new.example" },
      proof,
      1_800_000_000_000 + 49 * 60 * 60 * 1000,
    );
    assert(!result.ok && result.reason === expectedReason);
    assert(
      !statements.some((sql) =>
        sql.includes("UPDATE account_host_claim_challenge SET consumed_at")
      ),
    );
    assert(
      !statements.some((sql) => sql.includes("UPDATE account_host_claim SET")),
    );
  }
});

Deno.test("owner race cannot consume the fresh recovery proof", async () => {
  const statements: string[] = [];
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const sql = typeof query === "string" ? query : query.sql;
      statements.push(sql);
      if (sql.includes("FROM account_host_claim_recovery")) {
        return Promise.resolve({
          rows: [pendingRecoveryRow()],
          rowsAffected: 0,
        });
      }
      if (sql.includes("FROM account_host_claim WHERE")) {
        return Promise.resolve({
          rows: [{
            host: "pds.example",
            claimant_did: "did:plc:defending-owner",
            claimant_handle: "defender.example",
            method: "dns_txt",
            claimed_at: 1,
            verified_at: 1,
            updated_at: 2,
          }],
          rowsAffected: 0,
        });
      }
      if (sql.includes("SELECT id FROM account_host_claim_recovery")) {
        return Promise.resolve({
          rows: [{ id: "dns-recovery:proof-hash" }],
          rowsAffected: 0,
        });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };
  const result = await finalizeEmailClaimRecoveryTransactionForTest(
    client,
    "pds.example",
    { did: "did:plc:new-owner", handle: "new.example" },
    freshFinalDnsProof(),
    1_800_000_000_000 + 49 * 60 * 60 * 1000,
  );
  assert(!result.ok && result.reason === "owner_changed");
  assert(
    !statements.some((sql) =>
      sql.includes("UPDATE account_host_claim_challenge SET consumed_at")
    ),
  );
});

Deno.test("owner changes invalidate pending email recovery before finalization", async () => {
  const statements: string[] = [];
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const sql = typeof query === "string" ? query : query.sql;
      statements.push(sql);
      if (
        sql.includes("FROM account_host_claim_recovery") &&
        sql.includes("ORDER BY")
      ) {
        return Promise.resolve({
          rows: [pendingRecoveryRow()],
          rowsAffected: 0,
        });
      }
      if (sql.includes("FROM account_host_claim WHERE")) {
        return Promise.resolve({
          rows: [{
            host: "pds.example",
            claimant_did: "did:plc:current-owner",
            claimant_handle: "current.example",
            method: "dns_txt",
            claimed_at: 1,
            verified_at: 1,
            updated_at: 2,
          }],
          rowsAffected: 0,
        });
      }
      if (sql.includes("SELECT id FROM account_host_claim_recovery")) {
        return Promise.resolve({
          rows: [{ id: "dns-recovery:proof-hash" }],
          rowsAffected: 0,
        });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };
  const result = await finalizeEmailClaimRecoveryTransactionForTest(
    client,
    "pds.example",
    { did: "did:plc:new-owner", handle: "new.example" },
    freshFinalDnsProof(),
    1_800_000_000_000 + 49 * 60 * 60 * 1000,
  );
  assert(!result.ok && result.reason === "owner_changed");
  assert(statements.some((sql) => sql.includes("status = 'invalidated'")));
  assert(
    !statements.some((sql) =>
      sql.includes("claimant_did = ?, claimant_handle")
    ),
  );
});

Deno.test("expired recovery transitions durably and releases the pending slot", async () => {
  const statements: string[] = [];
  const expiredAt = 1_800_000_000_000;
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const sql = typeof query === "string" ? query : query.sql;
      statements.push(sql);
      if (
        sql.includes("FROM account_host_claim_recovery") &&
        sql.includes("ORDER BY")
      ) {
        return Promise.resolve({
          rows: [pendingRecoveryRow({ expires_at: expiredAt })],
          rowsAffected: 0,
        });
      }
      if (sql.includes("FROM account_host_claim WHERE")) {
        return Promise.resolve({ rows: [emailOwnerRow()], rowsAffected: 0 });
      }
      if (sql.includes("SELECT id FROM account_host_claim_recovery")) {
        return Promise.resolve({
          rows: [{ id: "dns-recovery:proof-hash" }],
          rowsAffected: 0,
        });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };
  const result = await finalizeEmailClaimRecoveryTransactionForTest(
    client,
    "pds.example",
    { did: "did:plc:new-owner", handle: "new.example" },
    freshFinalDnsProof(),
    expiredAt,
  );
  assert(!result.ok && result.reason === "expired");
  assert(statements.some((sql) => sql.includes("status = 'expired'")));
  assert(
    statements.some((sql) => sql.includes("account_host_claim_recovery_audit")),
  );
});

Deno.test("recovery notification evidence is claimant-bound and audit-only", async () => {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const attemptedAt = 1_800_000_000_100;
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const statement = typeof query === "string"
        ? { sql: query, args: [] }
        : { sql: query.sql, args: query.args ?? [] };
      statements.push(statement);
      if (
        statement.sql.includes("FROM account_host_claim_recovery") &&
        !statement.sql.includes("expires_at <=")
      ) {
        return Promise.resolve({
          rows: [pendingRecoveryRow({
            notification_attempted_at: attemptedAt,
          })],
          rowsAffected: 0,
        });
      }
      if (statement.sql.includes("FROM account_host_claim WHERE")) {
        return Promise.resolve({ rows: [emailOwnerRow()], rowsAffected: 0 });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };
  const recorded = await recordHostClaimRecoveryNotificationTransactionForTest(
    client,
    "pds.example",
    "did:plc:new-owner",
    {
      status: "sent",
      deliveryId: "provider-message-id",
      emailFingerprint: "E".repeat(43),
      attemptedAt,
    },
  );
  assertEquals(recorded?.notificationStatus, "sent");
  assertEquals(recorded?.notificationAttemptedAt, attemptedAt);
  assertEquals("deliveryId" in (recorded ?? {}), false);
  const update = statements.find((statement) =>
    statement.sql.includes("notification_status = ?")
  );
  assert(update?.sql.includes("requester_did = ?"));
  assert(update?.sql.includes("status = 'pending'"));
  assert(update?.sql.includes("notification_attempted_at = ?"));
  assert(update?.args.includes("provider-message-id"));
  const audit = statements.find((statement) =>
    statement.sql.includes("account_host_claim_recovery_audit")
  );
  assert(audit?.args.includes("notification_sent"));
  assert(audit?.args.includes("E".repeat(43)));
});

Deno.test("a stale recovery notification sender cannot complete a newer lease", async () => {
  const leaseA = 1_800_000_000_100;
  const leaseB = leaseA + 300_001;
  const statements: string[] = [];
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const sql = typeof query === "string" ? query : query.sql;
      statements.push(sql);
      if (
        sql.includes("FROM account_host_claim_recovery") &&
        sql.includes("ORDER BY")
      ) {
        return Promise.resolve({
          rows: [pendingRecoveryRow({ notification_attempted_at: leaseB })],
          rowsAffected: 0,
        });
      }
      if (sql.includes("FROM account_host_claim WHERE")) {
        return Promise.resolve({ rows: [emailOwnerRow()], rowsAffected: 0 });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };
  const stale = await recordHostClaimRecoveryNotificationTransactionForTest(
    client,
    "pds.example",
    "did:plc:new-owner",
    {
      status: "sent",
      deliveryId: "stale-delivery",
      emailFingerprint: "E".repeat(43),
      attemptedAt: leaseA,
    },
  );
  assertEquals(stale?.notificationStatus, "pending");
  assertEquals(stale?.notificationAttemptedAt, leaseB);
  assert(!statements.some((sql) => sql.includes("notification_status = ?")));
  assert(!statements.some((sql) => sql.includes("recovery_audit")));
});

Deno.test("recovery notification reservation is a claimant-bound crash-retry lease", async () => {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const at = 1_800_000_000_100;
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const statement = typeof query === "string"
        ? { sql: query, args: [] }
        : { sql: query.sql, args: query.args ?? [] };
      statements.push(statement);
      if (
        statement.sql.includes("FROM account_host_claim_recovery") &&
        statement.sql.includes("ORDER BY")
      ) {
        return Promise.resolve({
          rows: [pendingRecoveryRow({ notification_attempted_at: at })],
          rowsAffected: 0,
        });
      }
      if (statement.sql.includes("FROM account_host_claim WHERE")) {
        return Promise.resolve({ rows: [emailOwnerRow()], rowsAffected: 0 });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };
  const reserved = await reserveHostClaimRecoveryNotificationTransactionForTest(
    client,
    "pds.example",
    "did:plc:new-owner",
    at,
    5 * 60 * 1000,
  );
  assertEquals(reserved?.recovery.notificationAttemptedAt, at);
  assertEquals(reserved?.expectedEmailFingerprint, null);
  const update = statements.find((statement) =>
    statement.sql.includes("SET notification_attempted_at = ?")
  );
  assert(update?.sql.includes("requester_did = ?"));
  assert(update?.sql.includes("notification_status = 'pending'"));
  assert(update?.sql.includes("notification_attempted_at IS NULL"));
  assertEquals(update?.args, [
    at,
    "pds.example",
    "did:plc:new-owner",
    Math.max(0, at - 5 * 60 * 1000),
  ]);
});

Deno.test("recovery warning recipient binds to the exact original claim evidence", async () => {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const fingerprint = "E".repeat(43);
  const at = 1_800_000_000_100;
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const statement = typeof query === "string"
        ? { sql: query, args: [] }
        : { sql: query.sql, args: query.args ?? [] };
      statements.push(statement);
      if (
        statement.sql.includes("FROM account_host_claim_recovery") &&
        statement.sql.includes("ORDER BY")
      ) {
        return Promise.resolve({
          rows: [pendingRecoveryRow({ notification_attempted_at: at })],
          rowsAffected: 0,
        });
      }
      if (statement.sql.includes("FROM account_host_claim WHERE")) {
        return Promise.resolve({ rows: [emailOwnerRow()], rowsAffected: 0 });
      }
      if (statement.sql.includes("FROM account_host_claim_evidence")) {
        return Promise.resolve({
          rows: [{ email_fingerprint: fingerprint }],
          rowsAffected: 0,
        });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };
  const reserved = await reserveHostClaimRecoveryNotificationTransactionForTest(
    client,
    "pds.example",
    "did:plc:new-owner",
    at,
    300_000,
  );
  assertEquals(reserved?.expectedEmailFingerprint, fingerprint);
  const evidence = statements.find((statement) =>
    statement.sql.includes("FROM account_host_claim_evidence")
  );
  assert(evidence?.sql.includes("method = 'pds_contact_email'"));
  assert(evidence?.sql.includes("claim_updated_at = ?"));
  assertEquals(evidence?.args, [
    "pds.example",
    "did:plc:old-owner",
    1_800_000_000_000,
  ]);
});

Deno.test("only the winner of a recovery notification CAS may send", async () => {
  let reservations = 0;
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("SET notification_attempted_at = ?")) {
        reservations++;
        return Promise.resolve({
          rows: [],
          rowsAffected: reservations === 1 ? 1 : 0,
        });
      }
      if (
        sql.includes("FROM account_host_claim_recovery") &&
        sql.includes("ORDER BY")
      ) {
        return Promise.resolve({
          rows: [pendingRecoveryRow()],
          rowsAffected: 0,
        });
      }
      if (sql.includes("FROM account_host_claim WHERE")) {
        return Promise.resolve({ rows: [emailOwnerRow()], rowsAffected: 0 });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };
  const first = await reserveHostClaimRecoveryNotificationTransactionForTest(
    client,
    "pds.example",
    "did:plc:new-owner",
    1_800_000_000_100,
    300_000,
  );
  const second = await reserveHostClaimRecoveryNotificationTransactionForTest(
    client,
    "pds.example",
    "did:plc:new-owner",
    1_800_000_000_101,
    300_000,
  );
  assert(first);
  assertEquals(second, null);
});

Deno.test("DNS completion consumes proof and writes ownership atomically", async () => {
  const statements: string[] = [];
  const client = {
    execute(
      query: string | { sql: string; args?: unknown[] },
    ) {
      statements.push(typeof query === "string" ? query : query.sql);
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };

  await writeDnsClaimTransactionForTest(client, {
    tokenHash: "dns-token-hash",
    claim: {
      host: "pds.example",
      claimantDid: "did:plc:operator",
      claimantHandle: "operator.example",
      method: "dns_txt",
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
        : sql.includes("account_host_claim_recovery")
        ? "recovery-check"
        : sql.includes("UPDATE account_host")
        ? "host"
        : "unexpected"
    ),
    ["consume", "claim", "recovery-check", "host"],
  );
});

Deno.test("DNS completion replay succeeds only for the current DNS owner", () => {
  const claim = {
    host: "pds.example",
    claimantDid: "did:plc:operator",
    claimantHandle: "operator.example",
    method: "dns_txt" as const,
    claimedAt: 1_800_000_000_000,
    verifiedAt: 1_800_000_000_000,
    updatedAt: 1_800_000_000_000,
  };
  assert(
    isCompletedDnsClaimReplayForTest(
      claim,
      "did:plc:operator",
      "did:plc:operator",
    ),
  );
  assert(
    !isCompletedDnsClaimReplayForTest(
      claim,
      "did:plc:another",
      "did:plc:operator",
    ),
  );
  assert(
    !isCompletedDnsClaimReplayForTest(
      { ...claim, method: "pds_contact_email" },
      "did:plc:operator",
      "did:plc:operator",
    ),
  );
});

Deno.test("current-manager DNS repair invalidates a cooling email recovery", async () => {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const statement = typeof query === "string"
        ? { sql: query, args: [] }
        : { sql: query.sql, args: query.args ?? [] };
      statements.push(statement);
      if (
        statement.sql.includes("SELECT id FROM account_host_claim_recovery")
      ) {
        return Promise.resolve({
          rows: [{ id: "dns-recovery:proof-hash" }],
          rowsAffected: 0,
        });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };
  await writeDnsClaimTransactionForTest(client, {
    tokenHash: "repair-token-hash",
    claim: {
      host: "pds.example",
      claimantDid: "did:plc:old-owner",
      claimantHandle: "old.example",
      method: "dns_txt",
      claimedAt: 1,
      verifiedAt: 2,
      updatedAt: 2,
    },
    claimHandle: "old.example",
    claimDid: "did:plc:old-owner",
    timestamp: 2,
  });
  assert(
    statements.some((statement) =>
      statement.sql.includes("status = 'invalidated'")
    ),
  );
  const audit = statements.find((statement) =>
    statement.sql.includes("account_host_claim_recovery_audit")
  );
  assert(audit?.args.includes("invalidated"));
  assert(audit?.args.includes("did:plc:old-owner"));
});

Deno.test("DNS manager transfer swaps exactly one owner and invalidates old host approvals", async () => {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      statements.push(
        typeof query === "string"
          ? { sql: query, args: [] }
          : { sql: query.sql, args: query.args ?? [] },
      );
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };

  await writeDnsClaimTransactionForTest(client, {
    tokenHash: "dns-transfer-token-hash",
    claim: {
      host: "pds.example",
      claimantDid: "did:plc:new-operator",
      claimantHandle: "new.example",
      method: "dns_txt",
      claimedAt: 1_800_000_000_000,
      verifiedAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_000,
    },
    claimHandle: "new.example",
    claimDid: "did:plc:new-operator",
    operatorListingOptIn: false,
    transfer: resolvedTransferForTest(),
    timestamp: 1_800_000_000_000,
  });

  assertEquals(statements.length, 7);
  assert(statements[1].sql.includes("WHERE host = ? AND claimant_did = ?"));
  assertEquals(
    statements[1].args.slice(-3),
    ["pds.example", "did:plc:old-operator", 1_799_998_000_000],
  );
  assert(statements[2].sql.includes("account_host_owner_transfer"));
  assert(
    !statements[4].sql.includes("operator_listing_opt_in"),
    "a manager change must preserve directory visibility",
  );
  assert(statements[5].sql.includes("avatar_url = NULL"));
  assert(statements[5].sql.includes("service_record_uri = NULL"));
  assert(statements[6].sql.includes("status = 'pending'"));
  assert(statements[6].sql.includes("host_approved_at = NULL"));
  assert(!statements[6].sql.includes("app_approved_at ="));
});

Deno.test("failed DNS manager transfer CAS stops before audit and cleanup", async () => {
  const statements: string[] = [];
  const client = {
    execute(query: string | { sql: string; args?: unknown[] }) {
      const sql = typeof query === "string" ? query : query.sql;
      statements.push(sql);
      return Promise.resolve({
        rows: [],
        rowsAffected: statements.length === 2 ? 0 : 1,
      });
    },
  };

  let rejected = false;
  try {
    await writeDnsClaimTransactionForTest(client, {
      tokenHash: "dns-transfer-token-hash",
      claim: {
        host: "pds.example",
        claimantDid: "did:plc:new-operator",
        claimantHandle: "new.example",
        method: "dns_txt",
        claimedAt: 1_800_000_000_000,
        verifiedAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000,
      },
      claimHandle: "new.example",
      claimDid: "did:plc:new-operator",
      transfer: resolvedTransferForTest(),
      timestamp: 1_800_000_000_000,
    });
  } catch {
    rejected = true;
  }
  assert(rejected);
  assertEquals(statements.length, 2);
});

Deno.test("claim ownership upserts are idempotent only for the same DID", async () => {
  let captured = { sql: "", args: [] as unknown[] };
  const claim = {
    host: "pds.example",
    claimantDid: "did:plc:operator",
    claimantHandle: "operator.example",
    method: "dns_txt" as const,
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

  const acceptedIdentity = await upsertAccountHostClaimForOwnerForTest({
    execute() {
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  }, { ...claim, method: "atproto_handle" });
  assertEquals(acceptedIdentity, true);

  const rejected = await upsertAccountHostClaimForOwnerForTest({
    execute() {
      return Promise.resolve({ rows: [], rowsAffected: 0 });
    },
  }, claim);
  assertEquals(rejected, false);

  let attemptedLegacyWrite = false;
  const rejectedLegacy = await upsertAccountHostClaimForOwnerForTest({
    execute() {
      attemptedLegacyWrite = true;
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  }, { ...claim, method: "pds_contact_email" });
  assertEquals(rejectedLegacy, false);
  assertEquals(attemptedLegacyWrite, false);
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
