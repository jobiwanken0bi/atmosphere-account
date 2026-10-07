import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createClient } from "@libsql/client";
import {
  type AccountHost,
  listSeededAccountHostFallback,
} from "./account-hosts.ts";
import { type DbClient } from "./db.ts";
import {
  discoverAccountCreationAuthServer,
  discoverAuthServer,
} from "./identity.ts";
import {
  accountCreationServiceEndpoint,
  currentHostOAuthCreationEvidence,
  type HostOAuthCreationEvidence,
  isAccountCreationDiscoveryCandidate,
  listAccountCreationCandidates,
  loadHostOAuthCreationEvidence,
  refreshHostOAuthCreationEvidence,
  refreshHostOAuthCreationForMaintenance,
} from "./host-oauth-creation.ts";
import {
  isCreateAccountHostEligible,
  loadDirectoryCandidates,
} from "./create-account-hosts.ts";

const now = Date.now();
function host(overrides: Partial<AccountHost> = {}): AccountHost {
  return {
    ...listSeededAccountHostFallback()[0],
    host: "host.example.com",
    serviceEndpoint: "https://host.example.com",
    signupStatus: "open",
    signupUrl: null,
    observedActiveAccountCount: 10,
    lastIndexedAccountAt: now,
    lastActiveAt: now,
    ...overrides,
  };
}
function evidence(
  overrides: Partial<HostOAuthCreationEvidence> = {},
): HostOAuthCreationEvidence {
  return {
    host: "host.example.com",
    serviceEndpoint: "https://host.example.com",
    supported: true,
    signupStatus: null,
    issuer: "https://host.example.com",
    checkedAt: now,
    expiresAt: now + 10000,
    ...overrides,
  };
}
function metadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    pushed_authorization_request_endpoint: `${origin}/oauth/par`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["ES256"],
    scopes_supported: ["atproto"],
    dpop_signing_alg_values_supported: ["ES256"],
    authorization_response_iss_parameter_supported: true,
    require_pushed_authorization_requests: true,
    client_id_metadata_document_supported: true,
    prompt_values_supported: ["create"],
  };
}
function fetchMetadata(
  options: {
    prStatus?: number;
    supported?: boolean;
    issuer?: string;
    malformed?: boolean;
  } = {},
): typeof fetch {
  return ((input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("oauth-protected-resource")) {
      if (options.prStatus) {
        return Promise.resolve(
          new Response(null, { status: options.prStatus }),
        );
      }
      return Promise.resolve(Response.json(
        options.malformed ? {} : {
          resource: url.origin,
          authorization_servers: [url.origin],
        },
      ));
    }
    if (url.pathname.includes("describeServer")) {
      return Promise.resolve(Response.json({
        availableUserDomains: [url.hostname],
        inviteCodeRequired: true,
      }));
    }
    return Promise.resolve(
      Response.json({
        ...metadata(url.origin),
        ...(options.issuer ? { issuer: options.issuer } : {}),
        ...(options.supported === false
          ? { prompt_values_supported: ["login"] }
          : {}),
      }),
    );
  }) as typeof fetch;
}

Deno.test("host signup discovery binds exact endpoints and curated Bluesky entryway", () => {
  assertEquals(
    accountCreationServiceEndpoint(host()),
    "https://host.example.com",
  );
  assertEquals(
    accountCreationServiceEndpoint(host({ serviceEndpoint: null })),
    "https://host.example.com",
  );
  for (
    const serviceEndpoint of [
      "http://host.example.com",
      "https://other.example.com",
      "https://host.example.com/path",
      "https://host.example.com/?x=1",
      "https://u:p@host.example.com",
    ]
  ) {
    assertEquals(
      accountCreationServiceEndpoint(host({ serviceEndpoint })),
      null,
    );
  }
  assertEquals(
    accountCreationServiceEndpoint(listSeededAccountHostFallback()[0]),
    "https://bsky.social",
  );
});

Deno.test("automatic signup requires fresh independent public intent, supported evidence and enrollment", () => {
  const observed = host({
    source: "observed",
    verificationStatus: "observed",
    publicIntentStatus: "detected",
    publicIntentCheckedAt: now,
  });
  assertEquals(isCreateAccountHostEligible(observed, now, evidence()), true);
  assertEquals(
    isCreateAccountHostEligible(
      host({ signupStatus: "unknown" }),
      now,
      evidence(),
    ),
    false,
  );
  assertEquals(
    isCreateAccountHostEligible(
      host({ signupStatus: "unknown" }),
      now,
      evidence({ signupStatus: "invite_required" }),
    ),
    true,
  );
  for (
    const change of [
      { signupStatus: "closed" as const },
      { operatorListingOptIn: false },
      { observedActiveAccountCount: 0 },
      { serviceEndpoint: "https://other.example.com" },
    ]
  ) {
    assertEquals(
      isCreateAccountHostEligible(host(change), now, evidence()),
      false,
    );
  }
  assertEquals(
    isAccountCreationDiscoveryCandidate({
      ...observed,
      publicIntentStatus: "unknown",
    }, now),
    false,
  );
  assertEquals(
    isAccountCreationDiscoveryCandidate({
      ...observed,
      publicIntentCheckedAt: 0,
    }, now),
    false,
  );
  for (
    const change of [{ supported: false }, { expiresAt: now }, {
      checkedAt: now + 1,
    }, { serviceEndpoint: "https://other.example.com" }]
  ) {
    assertEquals(
      currentHostOAuthCreationEvidence(host(), evidence(change), now),
      null,
    );
  }
});

Deno.test("host-first creation supports AS-only PR404 but does not mask metadata errors", async () => {
  const actual = await discoverAccountCreationAuthServer(
    "https://bsky.social",
    { fetchImpl: fetchMetadata({ prStatus: 404 }) },
  );
  assertEquals(actual.prompt_values_supported, ["create"]);
  await assertRejects(() =>
    discoverAuthServer("https://bsky.social", {
      fetchImpl: fetchMetadata({ prStatus: 404 }),
    })
  );
  for (
    const options of [
      { prStatus: 500 },
      { prStatus: 302 },
      { malformed: true },
      { issuer: "https://other.example.com" },
    ]
  ) {
    await assertRejects(() =>
      discoverAccountCreationAuthServer("https://host.example.com", {
        fetchImpl: fetchMetadata(options),
      })
    );
  }
});

Deno.test("create choices paginate past unsupported first-page candidates", async () => {
  const pages: number[] = [];
  const load = (options: { page?: number } = {}) => {
    pages.push(options.page!);
    return Promise.resolve({
      hosts: options.page === 1 ? [] : [
        host({
          host: "second.example.com",
          serviceEndpoint: "https://second.example.com",
        }),
      ],
      page: options.page!,
      pageSize: 72,
      total: 73,
      sort: "recommended" as const,
    });
  };
  const result = await loadDirectoryCandidates("", load);
  assertEquals(pages, [1, 2]);
  assertEquals(result.map((h) => h.host), ["second.example.com"]);
  pages.length = 0;
  assertEquals((await listAccountCreationCandidates(load)).map((h) => h.host), [
    "second.example.com",
  ]);
  assertEquals(pages, [1, 2]);
});

Deno.test("durable signup discovery rechecks negatives, preserves owner data and rejects endpoint races", async () => {
  const db = createClient({ url: "file::memory:" });
  const client = db as unknown as DbClient;
  try {
    await db.execute(
      "CREATE TABLE account_host(host TEXT PRIMARY KEY, service_endpoint TEXT, capabilities_json TEXT)",
    );
    await db.execute(
      "CREATE TABLE host_oauth_creation(host TEXT PRIMARY KEY, service_endpoint TEXT, supported INTEGER, signup_status TEXT, issuer TEXT, checked_at INTEGER, expires_at INTEGER)",
    );
    await db.execute({
      sql: "INSERT INTO account_host VALUES (?, ?, ?)",
      args: ["host.example.com", "https://host.example.com", "owner metadata"],
    });
    const opts = { hosts: [host()], client, now, fetchImpl: fetchMetadata() };
    assertEquals(await refreshHostOAuthCreationEvidence(opts), {
      candidates: 1,
      checked: 1,
      supported: 1,
    });
    let rows = await loadHostOAuthCreationEvidence([host()], client);
    assertEquals(
      isCreateAccountHostEligible(host(), now, rows.get("host.example.com")),
      true,
    );
    assertEquals(
      (await db.execute("SELECT capabilities_json FROM account_host")).rows[0]
        .capabilities_json,
      "owner metadata",
    );
    assertEquals(await refreshHostOAuthCreationEvidence(opts), {
      candidates: 0,
      checked: 0,
      supported: 0,
    });
    await refreshHostOAuthCreationEvidence({
      ...opts,
      now: now + 1,
      force: true,
      fetchImpl: fetchMetadata({ supported: false }),
    });
    rows = await loadHostOAuthCreationEvidence([host()], client);
    assertEquals(
      isCreateAccountHostEligible(
        host(),
        now + 1,
        rows.get("host.example.com"),
      ),
      false,
    );
    assertEquals(
      (await refreshHostOAuthCreationEvidence({
        ...opts,
        now: now + 25 * 60 * 60 * 1000,
      })).supported,
      1,
    );
    await refreshHostOAuthCreationEvidence({
      ...opts,
      now: now + 26 * 60 * 60 * 1000,
      force: true,
      fetchImpl: (async (input, init) => {
        await db.execute(
          "UPDATE account_host SET service_endpoint = 'https://changed.example.com'",
        );
        return fetchMetadata()(input, init);
      }) as typeof fetch,
    });
    rows = await loadHostOAuthCreationEvidence([host()], client);
    assertEquals(
      rows.get("host.example.com")?.checkedAt,
      now + 25 * 60 * 60 * 1000,
    );
    const controller = new AbortController();
    controller.abort();
    await assertRejects(() =>
      refreshHostOAuthCreationEvidence({ ...opts, signal: controller.signal })
    );
  } finally {
    db.close();
  }
});

Deno.test("anonymous shell reads complete signup choices from AppView without a database", async () => {
  const code = `
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname !== '/api/login/account-hosts' || url.searchParams.get('q') !== 'Eurosky') throw new Error('wrong projection request');
      return Response.json({hosts: [{host:'eurosky.social', oauthAccountCreation:true}]});
    };
    const {listCreateAccountHostOptions} = await import(${
    JSON.stringify(new URL("./create-account-hosts.ts", import.meta.url).href)
  });
    const choices = await listCreateAccountHostOptions({query:'Eurosky'});
    if (choices.length !== 1 || choices[0].host !== 'eurosky.social') throw new Error('remote signup choice lost');
  `;
  const command = new Deno.Command(Deno.execPath(), {
    args: ["eval", code],
    env: {
      ATMOSPHERE_APPVIEW_URL: "https://appview.example.com",
      ATMOSPHERE_DB_BACKEND: "deliberately-no-shell-db",
    },
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
});

Deno.test({
  name:
    "Postgres signup cache uses the baseline schema and endpoint compare-and-set",
  ignore: !Deno.env.get("TEST_POSTGRES_DATABASE_URL") && !Deno.env.get("CI"),
  async fn() {
    const databaseUrl = Deno.env.get("TEST_POSTGRES_DATABASE_URL");
    if (!databaseUrl) {
      throw new Error("TEST_POSTGRES_DATABASE_URL is required in CI");
    }
    const { createPostgresExecuteClient, closePostgresExecuteClient } =
      await import("./postgres.ts");
    const db = createPostgresExecuteClient(databaseUrl);
    try {
      await db.withTransaction!(async (client) => {
        await client.execute(
          "CREATE TEMP TABLE account_host(host text PRIMARY KEY, service_endpoint text) ON COMMIT DROP",
        );
        const schema = await Deno.readTextFile(
          new URL("../sql/neon/001_initial.sql", import.meta.url),
        );
        const statement = schema.match(
          /CREATE TABLE IF NOT EXISTS host_oauth_creation \([\s\S]*?\n\);/,
        )?.[0];
        if (!statement) throw new Error("missing signup evidence baseline");
        await client.execute(
          statement.replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE")
            .replace(/\);$/, ") ON COMMIT DROP;"),
        );
        await client.execute({
          sql: "INSERT INTO account_host VALUES (?, ?)",
          args: ["host.example.com", "https://host.example.com"],
        });
        await refreshHostOAuthCreationEvidence({
          hosts: [host()],
          client,
          now,
          fetchImpl: fetchMetadata(),
        });
        let cache = await loadHostOAuthCreationEvidence([host()], client);
        assertEquals(cache.get("host.example.com")?.supported, true);
        await refreshHostOAuthCreationEvidence({
          hosts: [host()],
          client,
          now: now + 1,
          force: true,
          fetchImpl: (async (input, init) => {
            await client.execute(
              "UPDATE account_host SET service_endpoint = 'https://changed.example.com'",
            );
            return fetchMetadata()(input, init);
          }) as typeof fetch,
        });
        cache = await loadHostOAuthCreationEvidence([host()], client);
        assertEquals(cache.get("host.example.com")?.checkedAt, now);
      });
    } finally {
      await closePostgresExecuteClient(db);
    }
  },
});

Deno.test("signup discovery failure cannot prevent other directory maintenance", async () => {
  assertEquals(
    await refreshHostOAuthCreationForMaintenance(
      {},
      () => Promise.reject(new Error("private error details")),
    ),
    { candidates: 0, checked: 0, supported: 0, error: "Error" },
  );
  const controller = new AbortController();
  await assertRejects(() =>
    refreshHostOAuthCreationForMaintenance(
      { signal: controller.signal },
      () => {
        controller.abort();
        return Promise.reject(new Error("cancelled"));
      },
    )
  );
  assertEquals(
    await refreshHostOAuthCreationForMaintenance({}, (options) => {
      if (!options?.signal) throw new Error("missing bounded discovery signal");
      return Promise.resolve({ candidates: 1, checked: 1, supported: 1 });
    }),
    { candidates: 1, checked: 1, supported: 1 },
  );
});
