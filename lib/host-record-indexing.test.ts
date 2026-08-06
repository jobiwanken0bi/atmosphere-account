import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseHostProfileRecord,
  parseHostServiceRecord,
  upsertHostProtocolRecordWithClient,
} from "./host-record-indexing.ts";
import type { DbClient } from "./db.ts";
import {
  HOST_IMAGE_PURPOSE_AVATAR,
  HOST_LINK_ROLE_HOMEPAGE,
  HOST_LINK_ROLE_SUPPORT,
} from "./host-records.ts";
import { HOST_PROFILE_NSID, HOST_SERVICE_NSID } from "./lexicons.ts";

Deno.test("parseHostServiceRecord normalizes host service records", () => {
  const parsed = parseHostServiceRecord({
    uri: "at://did:plc:host/account.atmosphere.host.service/example.com",
    cid: "bafyservice",
    collection: HOST_SERVICE_NSID,
    repoDid: "did:plc:host",
    rkey: "example.com",
    authorHandle: "host.example",
    value: {
      host: "Example.COM",
      displayName: "Example Host",
      description: "A friendly PDS host.",
      regions: ["Europe"],
      serviceEndpoint: "https://pds.example.com/",
      hostPatterns: ["example.com", "*.example.net"],
      signup: {
        status: "account.atmosphere.host.defs#signupInviteOnly",
        url: "https://example.com/signup",
      },
      links: [
        { role: HOST_LINK_ROLE_HOMEPAGE, url: "https://example.com/" },
        { role: HOST_LINK_ROLE_SUPPORT, url: "https://example.com/help" },
      ],
      dashboardManifestUrl:
        "https://example.com/.well-known/atmosphere-host-dashboard.json",
      createdAt: "2026-06-01T00:00:00.000Z",
    },
  });

  assertEquals(parsed?.kind, "service");
  assertEquals(parsed?.host, "example.com");
  assertEquals(parsed?.dataLocation, "Europe");
  assertEquals(parsed?.serviceEndpoint, "https://pds.example.com");
  assertEquals(parsed?.accountManagementUrl, null);
  assertEquals(parsed?.homepageUrl, "https://example.com/");
  assertEquals(parsed?.signupUrl, "https://example.com/signup");
  assertEquals(parsed?.supportUrl, "https://example.com/help");
  assertEquals(parsed?.signupStatus, "invite_required");
  assertEquals(parsed?.matchPatterns, ["example.com", "*.example.net"]);
});

Deno.test("parseHostProfileRecord reads profile brand fields and PDS blobs", () => {
  const parsed = parseHostProfileRecord({
    uri: "at://did:plc:host/account.atmosphere.host.profile/self",
    cid: "bafyprofile",
    collection: HOST_PROFILE_NSID,
    repoDid: "did:plc:host",
    rkey: "self",
    authorHandle: "host.example",
    value: {
      name: "Example Host",
      description: "Community-run hosting.",
      links: [{ role: HOST_LINK_ROLE_HOMEPAGE, url: "https://example.com/" }],
      images: [{
        purpose: HOST_IMAGE_PURPOSE_AVATAR,
        image: {
          $type: "blob",
          ref: { $link: "bafyavatar" },
          mimeType: "image/png",
          size: 1234,
        },
      }],
      serviceRefs: [{
        uri: "at://did:plc:host/account.atmosphere.host.service/example.com",
        host: "example.com",
      }],
      contact: { url: "https://example.com/support" },
      createdAt: "2026-06-01T00:00:00.000Z",
    },
  });

  assertEquals(parsed?.kind, "profile");
  assertEquals(parsed?.name, "Example Host");
  assertEquals(parsed?.homepageUrl, "https://example.com/");
  assertEquals(parsed?.supportUrl, "https://example.com/support");
  assertEquals(
    parsed?.avatarUrl,
    "/api/atproto/blob?did=did%3Aplc%3Ahost&cid=bafyavatar",
  );
  assertEquals(parsed?.serviceRefs, [{
    uri: "at://did:plc:host/account.atmosphere.host.service/example.com",
    host: "example.com",
  }]);
});

Deno.test("unverified host records never populate claim authority columns", async () => {
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const client: DbClient = {
    execute(query, positionalArgs) {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string"
        ? positionalArgs ?? []
        : query.args ?? [];
      queries.push({ sql, args });
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };

  await upsertHostProtocolRecordWithClient(client, {
    uri: "at://did:plc:unverified/account.atmosphere.host.service/example.com",
    cid: "bafyservice",
    collection: HOST_SERVICE_NSID,
    repoDid: "did:plc:unverified",
    rkey: "example.com",
    authorHandle: "attacker.example",
    value: {
      host: "example.com",
      displayName: "Example Host",
      serviceEndpoint: "https://pds.example.com",
      createdAt: "2026-06-01T00:00:00.000Z",
    },
  }, 1_800_000_000_000);

  const serviceProjection = queries.find((query) =>
    /INSERT INTO account_host/i.test(query.sql)
  );
  if (!serviceProjection) throw new Error("missing account_host projection");
  assertEquals(/claim_handle|claim_did/i.test(serviceProjection.sql), false);
  assertEquals(
    serviceProjection.sql.includes(
      "account_host_claim.claimant_did = excluded.profile_did",
    ),
    true,
  );
  assertEquals(
    /verification_status = 'observed'[\s\S]+AND NOT EXISTS \([\s\S]+FROM account_host_claim/i
      .test(serviceProjection.sql),
    true,
  );
  assertEquals(
    serviceProjection.sql.match(/\?/g)?.length ?? 0,
    serviceProjection.args.length,
  );

  queries.length = 0;
  await upsertHostProtocolRecordWithClient(client, {
    uri: "at://did:plc:unverified/account.atmosphere.host.profile/self",
    cid: "bafyprofile",
    collection: HOST_PROFILE_NSID,
    repoDid: "did:plc:unverified",
    rkey: "self",
    authorHandle: "attacker.example",
    value: {
      name: "Example Host",
      serviceRefs: [{
        uri:
          "at://did:plc:unverified/account.atmosphere.host.service/example.com",
        host: "example.com",
      }],
      createdAt: "2026-06-01T00:00:00.000Z",
    },
  }, 1_800_000_000_001);

  const profileProjection = queries.find((query) =>
    /UPDATE account_host/i.test(query.sql)
  );
  if (!profileProjection) throw new Error("missing profile projection");
  assertEquals(/claim_handle|claim_did/i.test(profileProjection.sql), false);
  assertEquals(
    /verification_status = 'observed'[\s\S]+AND NOT EXISTS \([\s\S]+FROM account_host_claim/i
      .test(profileProjection.sql),
    true,
  );
  assertEquals(
    /OR \(source = 'seeded' AND \? = 1\)/i.test(
      profileProjection.sql,
    ),
    true,
  );
  assertEquals(
    profileProjection.sql.match(/\?/g)?.length ?? 0,
    profileProjection.args.length,
  );
  assertEquals(
    queries.some((query) =>
      /WHERE profile_did = \? OR claim_did/i.test(
        query.sql,
      )
    ),
    false,
  );
});

Deno.test("seeded service projection requires its live pinned owner", async () => {
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const resolvedHandles: string[] = [];
  const client: DbClient = {
    execute(query, positionalArgs) {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string"
        ? positionalArgs ?? []
        : query.args ?? [];
      queries.push({ sql, args });
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };

  await upsertHostProtocolRecordWithClient(
    client,
    {
      uri: "at://did:plc:attacker/account.atmosphere.host.service/pckt.cafe",
      cid: "bafyseedattack",
      collection: HOST_SERVICE_NSID,
      repoDid: "did:plc:attacker",
      rkey: "pckt.cafe",
      authorHandle: "attacker.example",
      value: {
        host: "pckt.cafe",
        displayName: "Poisoned Pckt",
        serviceEndpoint: "https://evil.example",
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    },
    1_800_000_000_000,
    {
      resolveIdentity(handle) {
        resolvedHandles.push(handle);
        return Promise.resolve({
          handle: "pckt.blog",
          did: "did:plc:pinned-owner",
        });
      },
    },
  );

  assertEquals(resolvedHandles, ["pckt.blog"]);
  assertEquals(
    queries.some((query) => /INSERT INTO account_host\s*\(/i.test(query.sql)),
    false,
  );
  // Keep the raw source record for audit/reprocessing, but do not project it.
  assertEquals(
    queries.some((query) => /INSERT INTO host_record\s*\(/i.test(query.sql)),
    true,
  );
});

Deno.test("seeded service projection fails closed when live authority is unavailable", async () => {
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const client: DbClient = {
    execute(query, positionalArgs) {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string"
        ? positionalArgs ?? []
        : query.args ?? [];
      queries.push({ sql, args });
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };

  await upsertHostProtocolRecordWithClient(
    client,
    {
      uri:
        "at://did:plc:pinned-owner/account.atmosphere.host.service/pckt.cafe",
      cid: "bafyseedunavailable",
      collection: HOST_SERVICE_NSID,
      repoDid: "did:plc:pinned-owner",
      rkey: "pckt.cafe",
      authorHandle: "pckt.blog",
      value: {
        host: "pckt.cafe",
        displayName: "Pckt",
        serviceEndpoint: "https://pckt.cafe",
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    },
    1_800_000_000_000,
    {
      resolveIdentity: () => Promise.reject(new Error("resolver unavailable")),
    },
  );

  assertEquals(
    queries.some((query) => /INSERT INTO account_host\s*\(/i.test(query.sql)),
    false,
  );
});

Deno.test("contact-email owner supersedes a seeded social DID for record projection", async () => {
  async function projectsAccountHost(repoDid: string): Promise<boolean> {
    const queries: string[] = [];
    const client: DbClient = {
      execute(query) {
        const sql = typeof query === "string" ? query : query.sql;
        queries.push(sql);
        if (/SELECT claimant_did, method FROM account_host_claim/i.test(sql)) {
          return Promise.resolve({
            rows: [{
              claimant_did: "did:plc:email-operator",
              method: "pds_contact_email",
            }],
            rowsAffected: 0,
          });
        }
        return Promise.resolve({ rows: [], rowsAffected: 1 });
      },
    };

    await upsertHostProtocolRecordWithClient(
      client,
      {
        uri: `at://${repoDid}/account.atmosphere.host.service/pckt.cafe`,
        cid: `bafy-${repoDid}`,
        collection: HOST_SERVICE_NSID,
        repoDid,
        rkey: "pckt.cafe",
        authorHandle: repoDid === "did:plc:email-operator"
          ? "operator.example"
          : "pckt.blog",
        value: {
          host: "pckt.cafe",
          displayName: "Pckt",
          serviceEndpoint: "https://pckt.cafe",
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      },
      1_800_000_000_000,
      {
        resolveIdentity: () =>
          Promise.resolve({
            handle: "pckt.blog",
            did: "did:plc:pinned-social",
          }),
      },
    );
    return queries.some((sql) => /INSERT INTO account_host\s*\(/i.test(sql));
  }

  assertEquals(await projectsAccountHost("did:plc:email-operator"), true);
  assertEquals(await projectsAccountHost("did:plc:pinned-social"), false);
});

Deno.test("poisoned legacy claims cannot project seeded profile metadata", async () => {
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const client: DbClient = {
    execute(query, positionalArgs) {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string"
        ? positionalArgs ?? []
        : query.args ?? [];
      queries.push({ sql, args });
      if (/SELECT host FROM account_host\s+WHERE \(/i.test(sql)) {
        // Simulate an old poisoned account_host_claim that associates the
        // attacker's DID with this curated host.
        return Promise.resolve({
          rows: [{ host: "pckt.cafe" }],
          rowsAffected: 0,
        });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };

  await upsertHostProtocolRecordWithClient(
    client,
    {
      uri: "at://did:plc:attacker/account.atmosphere.host.profile/self",
      cid: "bafylegacypoison",
      collection: HOST_PROFILE_NSID,
      repoDid: "did:plc:attacker",
      rkey: "self",
      authorHandle: "attacker.example",
      value: {
        name: "Poisoned Pckt",
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    },
    1_800_000_000_000,
    {
      resolveIdentity: () =>
        Promise.resolve({
          handle: "pckt.blog",
          did: "did:plc:pinned-owner",
        }),
    },
  );

  assertEquals(
    queries.some((query) => /UPDATE account_host\s+SET/i.test(query.sql)),
    false,
  );
});

Deno.test("live pinned owner can repair seeded metadata despite a poisoned legacy claim", async () => {
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const client: DbClient = {
    execute(query, positionalArgs) {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string"
        ? positionalArgs ?? []
        : query.args ?? [];
      queries.push({ sql, args });
      if (/SELECT host FROM account_host\s+WHERE \(/i.test(sql)) {
        return Promise.resolve({
          rows: [{ host: "pckt.cafe" }],
          rowsAffected: 0,
        });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    },
  };

  await upsertHostProtocolRecordWithClient(
    client,
    {
      uri: "at://did:plc:pinned-owner/account.atmosphere.host.profile/self",
      cid: "bafypinnedrepair",
      collection: HOST_PROFILE_NSID,
      repoDid: "did:plc:pinned-owner",
      rkey: "self",
      authorHandle: "pckt.blog",
      value: {
        name: "Pckt",
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    },
    1_800_000_000_000,
    {
      resolveIdentity: () =>
        Promise.resolve({
          handle: "pckt.blog",
          did: "did:plc:pinned-owner",
        }),
    },
  );

  const projection = queries.find((query) =>
    /UPDATE account_host\s+SET/i.test(query.sql)
  );
  if (!projection) throw new Error("missing authorized seeded projection");
  assertEquals(
    /source = 'seeded' AND \? = 1/i.test(projection.sql),
    true,
  );
  assertEquals(projection.args.at(-1), 1);
  assertEquals(
    projection.sql.match(/\?/g)?.length ?? 0,
    projection.args.length,
  );
});
