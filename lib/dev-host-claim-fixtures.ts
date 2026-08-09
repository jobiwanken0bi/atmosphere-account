import { setAppUserType } from "./account-types.ts";
import { type DbClient, withDb } from "./db.ts";
import { IS_DEV } from "./env.ts";
import { generateEs256KeyPair } from "./jose.ts";
import { HOST_SERVICE_NSID } from "./lexicons.ts";
import {
  addRememberedAccountCookies,
  readRememberedAccounts,
  type RememberedAccount,
} from "./remembered-accounts.ts";
import { scopeForCapabilities } from "./oauth-scopes.ts";
import { buildSessionCookie, createSession } from "./session.ts";

export const DEV_HOST_CLAIM_ACCOUNTS = {
  regular: {
    did: "did:plc:localdevclaimperson",
    handle: "claim-person.test",
    displayName: "Claim Test Person",
    accountType: "user",
    capabilities: ["host", "media"],
  },
  app: {
    did: "did:plc:localdevfieldnotesapp",
    handle: "field-notes.test",
    displayName: "Field Notes",
    accountType: "project",
    capabilities: ["app", "host", "media"],
  },
  host: {
    did: "did:plc:localdevharborhost",
    handle: "harbor-host.test",
    displayName: "Harbor Host",
    accountType: "user",
    capabilities: ["host", "media"],
  },
} as const;

export type DevHostClaimAccountKey = keyof typeof DEV_HOST_CLAIM_ACCOUNTS;

export const DEV_HOST_CLAIM_HOSTS = {
  localUnclaimed: {
    host: "claim-lab.test",
    displayName: "Claim Lab",
    description:
      "A resettable local PDS for testing a first host claim with a regular account.",
    accountCount: 24,
  },
  appUnclaimed: {
    host: "field-notes-pds.test",
    displayName: "Field Notes PDS",
    description:
      "A resettable local PDS for testing a host claim by an existing app account.",
    accountCount: 36,
  },
  appLinked: {
    host: "field-notes-linked-pds.test",
    displayName: "Field Notes Linked PDS",
    description:
      "A resettable local PDS for testing claim-and-connect from an app profile.",
    accountCount: 18,
  },
  localClaimed: {
    host: "harbor-host.test",
    displayName: "Harbor Host",
    description:
      "An existing host profile managed by the seeded Harbor Host account.",
    accountCount: 128,
    owner: "host",
    method: "local_dev_fixture",
    dataLocation: "United States",
    bskyProfileVisible: false,
  },
  detectedDns: {
    host: "dns-claim-preview.atmosphereaccount.com",
    displayName: "DNS Claim Preview",
    description:
      "A production-shaped local fixture for viewing the DNS TXT claim steps.",
    accountCount: 42,
  },
  transferClaimed: {
    host: "transfer-lab.atmosphereaccount.com",
    displayName: "Transfer Lab",
    description:
      "A production-shaped claimed host for previewing a DNS-gated manager change.",
    accountCount: 64,
    owner: "host",
    method: "dns_txt",
    dataLocation: "United States",
    bskyProfileVisible: false,
  },
} as const;

type DevHostClaimFixtureHost =
  (typeof DEV_HOST_CLAIM_HOSTS)[keyof typeof DEV_HOST_CLAIM_HOSTS];

const RESETTABLE_HOSTS = [
  DEV_HOST_CLAIM_HOSTS.localUnclaimed.host,
  DEV_HOST_CLAIM_HOSTS.appUnclaimed.host,
  DEV_HOST_CLAIM_HOSTS.appLinked.host,
  DEV_HOST_CLAIM_HOSTS.localClaimed.host,
  DEV_HOST_CLAIM_HOSTS.detectedDns.host,
  DEV_HOST_CLAIM_HOSTS.transferClaimed.host,
] as const;

const DEV_OAUTH_SESSION_TTL_MS = 12 * 60 * 60_000;

/**
 * Ensure the deterministic host-claim lab exists without undoing progress.
 * This helper refuses every hosted or non-file database configuration.
 */
export async function prepareDevHostClaimFixtures(): Promise<void> {
  assertSafeDevFixtureDatabase();
  const now = Date.now();

  for (const account of Object.values(DEV_HOST_CLAIM_ACCOUNTS)) {
    await setAppUserType({
      did: account.did,
      handle: account.handle,
      displayName: account.displayName,
      accountType: account.accountType,
    });
  }

  await withDb(async (client) => {
    for (const fixture of Object.values(DEV_HOST_CLAIM_HOSTS)) {
      await upsertFixtureHost(client, fixture, now);
    }
    await ensureFixtureClaim(
      client,
      DEV_HOST_CLAIM_HOSTS.localClaimed,
      now,
    );
    await ensureFixtureClaim(
      client,
      DEV_HOST_CLAIM_HOSTS.transferClaimed,
      now,
    );
  });

  for (const [key, account] of Object.entries(DEV_HOST_CLAIM_ACCOUNTS)) {
    const dpop = await generateEs256KeyPair();
    const expiresAt = now + DEV_OAUTH_SESSION_TTL_MS;
    const session = {
      did: account.did,
      handle: account.handle,
      // Empty by design: these local grants prove route capability handling
      // without causing owner pages to make a fake remote PDS request.
      pdsUrl: "",
      asIssuer: "https://dev-auth.invalid",
      accessToken: `dev-only-${key}-access`,
      refreshToken: `dev-only-${key}-refresh`,
      expiresAt,
      dpopPrivateJwk: dpop.privateJwk,
      dpopPublicJwk: dpop.publicJwk,
      identityCheckedAt: now,
      scope: scopeForCapabilities(account.capabilities),
    };
    await withDb(async (client) => {
      await client.execute({
        sql: `INSERT INTO oauth_session (did, value, expires_at)
          VALUES (?, ?, ?)
          ON CONFLICT(did) DO UPDATE SET
            value = excluded.value,
            expires_at = excluded.expires_at`,
        args: [account.did, JSON.stringify(session), expiresAt],
      });
    });
  }
}

/** Reset only the named QA hosts, then restore their deterministic baseline. */
export async function resetDevHostClaimFixtures(): Promise<void> {
  assertSafeDevFixtureDatabase();
  const placeholders = RESETTABLE_HOSTS.map(() => "?").join(", ");
  await withDb(async (client) => {
    for (
      const table of [
        "account_host_claim_challenge",
        "account_host_owner_transfer",
        "directory_entity_link",
        "app_host_link_intent_consumption",
      ]
    ) {
      await client.execute({
        sql: `DELETE FROM ${table} WHERE host IN (${placeholders})`,
        args: [...RESETTABLE_HOSTS],
      });
    }
    await client.execute({
      sql: `DELETE FROM account_host_claim
        WHERE host IN (${placeholders})`,
      args: [...RESETTABLE_HOSTS],
    });
    await client.execute({
      sql: `UPDATE account_host SET
          claim_handle = NULL,
          claim_did = NULL,
          profile_handle = NULL,
          profile_did = NULL,
          avatar_url = NULL,
          data_location = NULL,
          service_record_uri = NULL,
          service_record_cid = NULL,
          service_observed_at = NULL,
          bsky_profile_visible = 1,
          verification_status = 'observed',
          operator_listing_opt_in = NULL,
          operator_listing_opted_at = NULL,
          updated_at = ?
        WHERE host IN (${placeholders})`,
      args: [Date.now(), ...RESETTABLE_HOSTS],
    });
    await client.execute({
      sql: `DELETE FROM rate_limit_bucket
        WHERE bucket_key LIKE 'host-claim:%'
          OR bucket_key LIKE 'host-claim-update:%'
          OR bucket_key LIKE 'host-claim-dns-check:%'
          OR bucket_key LIKE 'detected-host-claim-search:%'
          OR bucket_key LIKE 'host-registration:%'`,
      args: [],
    });
  });
  await prepareDevHostClaimFixtures();
}

export async function activateDevHostClaimAccount(
  request: Request,
  key: DevHostClaimAccountKey,
): Promise<{ sessionCookie: string; rememberedCookies: string[] }> {
  await prepareDevHostClaimFixtures();
  const account = DEV_HOST_CLAIM_ACCOUNTS[key];
  const existing = await readRememberedAccounts(request).catch(() => []);
  const fixtures: RememberedAccount[] = Object.values(
    DEV_HOST_CLAIM_ACCOUNTS,
  ).map((item) => ({
    did: item.did,
    handle: item.handle,
  }));
  const remembered = uniqueAccounts([
    ...fixtures.filter((item) => item.did !== account.did),
    ...existing,
  ]);
  const sessionValue = await createSession({
    did: account.did,
    handle: account.handle,
  });
  return {
    sessionCookie: buildSessionCookie(sessionValue),
    rememberedCookies: await addRememberedAccountCookies(remembered, {
      did: account.did,
      handle: account.handle,
    }),
  };
}

function assertSafeDevFixtureDatabase(): void {
  const backend = Deno.env.get("ATMOSPHERE_DB_BACKEND")?.trim().toLowerCase();
  const databaseUrl = Deno.env.get("TURSO_DATABASE_URL")?.trim() ?? "";
  if (!IS_DEV || backend !== "turso" || !databaseUrl.startsWith("file:")) {
    throw new Error(
      "Host-claim fixtures are restricted to a local file database in dev.",
    );
  }
}

export function isSafeDevHostClaimFixtureDatabaseForTest(
  input: { isDev: boolean; backend: string | null; databaseUrl: string | null },
): boolean {
  return input.isDev && input.backend?.trim().toLowerCase() === "turso" &&
    !!input.databaseUrl?.trim().startsWith("file:");
}

async function upsertFixtureHost(
  client: DbClient,
  fixture: DevHostClaimFixtureHost,
  now: number,
): Promise<void> {
  const owner = "owner" in fixture
    ? DEV_HOST_CLAIM_ACCOUNTS[fixture.owner]
    : null;
  const dataLocation = "dataLocation" in fixture ? fixture.dataLocation : null;
  const bskyProfileVisible = "bskyProfileVisible" in fixture
    ? fixture.bskyProfileVisible
    : true;
  const serviceRecordUri = owner
    ? `at://${owner.did}/${HOST_SERVICE_NSID}/${fixture.host}`
    : null;
  const serviceRecordCid = owner ? `dev-${fixture.host}-service` : null;
  await client.execute({
    sql: `INSERT INTO account_host (
        host, display_name, description, data_location, homepage_url, signup_url,
        service_endpoint, account_management_url, support_url,
        profile_handle, profile_did, bsky_profile_visible,
        claim_handle, claim_did, service_record_uri, service_record_cid,
        service_observed_at,
        signup_status, verification_status, source,
        public_intent_status, public_intent_source,
        public_intent_checked_at, observed_account_count,
        observed_active_account_count, last_active_at,
        last_indexed_account_at, last_observed_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        'open', ?, 'observed',
        'detected', 'dev_host_claim_lab', ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(host) DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        data_location = COALESCE(account_host.data_location, excluded.data_location),
        homepage_url = excluded.homepage_url,
        signup_url = excluded.signup_url,
        service_endpoint = excluded.service_endpoint,
        account_management_url = excluded.account_management_url,
        support_url = excluded.support_url,
        observed_account_count = excluded.observed_account_count,
        observed_active_account_count = excluded.observed_active_account_count,
        last_active_at = excluded.last_active_at,
        last_indexed_account_at = excluded.last_indexed_account_at,
        last_observed_at = excluded.last_observed_at,
        updated_at = excluded.updated_at`,
    args: [
      fixture.host,
      fixture.displayName,
      fixture.description,
      dataLocation,
      `https://${fixture.host}`,
      `https://${fixture.host}/join`,
      `https://${fixture.host}`,
      `https://${fixture.host}/account`,
      `https://${fixture.host}/support`,
      owner?.handle ?? null,
      owner?.did ?? null,
      bskyProfileVisible ? 1 : 0,
      owner?.handle ?? null,
      owner?.did ?? null,
      serviceRecordUri,
      serviceRecordCid,
      owner ? now : null,
      owner ? "claimed" : "observed",
      now,
      fixture.accountCount,
      fixture.accountCount,
      now,
      now,
      now,
      now,
      now,
    ],
  });
}

async function ensureFixtureClaim(
  client: DbClient,
  fixture: Extract<DevHostClaimFixtureHost, { owner: "host" }>,
  now: number,
): Promise<void> {
  const owner = DEV_HOST_CLAIM_ACCOUNTS[fixture.owner];
  await client.execute({
    sql: `INSERT INTO account_host_claim (
        host, claimant_did, claimant_handle, method,
        claimed_at, verified_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host) DO NOTHING`,
    args: [
      fixture.host,
      owner.did,
      owner.handle,
      fixture.method,
      now,
      now,
      now,
    ],
  });
  await client.execute({
    sql: `UPDATE account_host SET
        claim_handle = ?, claim_did = ?,
        profile_handle = ?, profile_did = ?, bsky_profile_visible = ?,
        service_record_uri = ?, service_record_cid = ?,
        service_observed_at = COALESCE(service_observed_at, ?),
        verification_status = 'claimed',
        operator_listing_opt_in = COALESCE(operator_listing_opt_in, 1),
        operator_listing_opted_at = COALESCE(operator_listing_opted_at, ?),
        updated_at = ?
      WHERE host = ? AND EXISTS (
        SELECT 1 FROM account_host_claim claim
        WHERE claim.host = account_host.host AND claim.claimant_did = ?
      )`,
    args: [
      owner.handle,
      owner.did,
      owner.handle,
      owner.did,
      fixture.bskyProfileVisible ? 1 : 0,
      `at://${owner.did}/${HOST_SERVICE_NSID}/${fixture.host}`,
      `dev-${fixture.host}-service`,
      now,
      now,
      now,
      fixture.host,
      owner.did,
    ],
  });
}

function uniqueAccounts(accounts: RememberedAccount[]): RememberedAccount[] {
  const seen = new Set<string>();
  return accounts.filter((account) => {
    if (seen.has(account.did)) return false;
    seen.add(account.did);
    return true;
  });
}
