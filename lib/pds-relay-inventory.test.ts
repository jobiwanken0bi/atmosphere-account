import { createClient } from "@libsql/client";
import {
  fetchRelayPdsInventory,
  inventoryDbErrorCode,
  inventoryDbRetryDelayMs,
  isBlueskyHostedPds,
  isRetryableInventoryDbError,
  normalizeRelayServiceHost,
  parseRelayListHostsPage,
  persistRelayPdsInventoryForClient,
  summarizeRelayPdsInventory,
} from "./pds-relay-inventory.ts";
import type { DbClient } from "./db.ts";

function assert(condition: unknown, message = "Assertion failed"): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

function assertThrows(fn: () => unknown, messagePart: string): void {
  try {
    fn();
  } catch (error) {
    assert(String(error).includes(messagePart), String(error));
    return;
  }
  throw new Error(`Expected function to throw ${JSON.stringify(messagePart)}`);
}

async function assertRejects(
  fn: () => Promise<unknown>,
  messagePart: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(String(error).includes(messagePart), String(error));
    return;
  }
  throw new Error(`Expected promise to reject ${JSON.stringify(messagePart)}`);
}

async function createInventoryTestDb() {
  const db = createClient({ url: "file::memory:" });
  await db.execute(`CREATE TABLE account_host (
    host TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    homepage_url TEXT,
    service_endpoint TEXT,
    service_observed_at INTEGER,
    signup_status TEXT NOT NULL DEFAULT 'unknown',
    verification_status TEXT NOT NULL DEFAULT 'observed',
    source TEXT NOT NULL DEFAULT 'observed',
    observed_account_count INTEGER NOT NULL DEFAULT 0,
    observed_active_account_count INTEGER NOT NULL DEFAULT 0,
    last_active_at INTEGER,
    last_indexed_account_at INTEGER,
    last_observed_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`);
  await db.execute(`CREATE TABLE pds_instance (
    service_host TEXT PRIMARY KEY,
    service_endpoint TEXT NOT NULL,
    account_host TEXT NOT NULL,
    relay_url TEXT NOT NULL,
    relay_status TEXT NOT NULL,
    relay_account_count INTEGER NOT NULL DEFAULT 0,
    relay_seq INTEGER,
    is_bluesky_host INTEGER NOT NULL DEFAULT 0,
    first_observed_at INTEGER NOT NULL,
    last_observed_at INTEGER NOT NULL,
    last_active_at INTEGER,
    last_scan_id TEXT NOT NULL
  )`);
  await db.execute(`CREATE TABLE pds_instance_status_history (
    transition_id TEXT PRIMARY KEY,
    service_host TEXT NOT NULL,
    account_host TEXT NOT NULL,
    relay_url TEXT NOT NULL,
    relay_status TEXT NOT NULL,
    relay_account_count INTEGER,
    relay_seq INTEGER,
    observed_at INTEGER NOT NULL,
    scan_id TEXT NOT NULL
  )`);
  return db;
}

Deno.test("relay PDS host normalization accepts public DNS names", () => {
  assertEquals(
    normalizeRelayServiceHost(" PDS.Example.COM. "),
    "pds.example.com",
  );
  for (const invalid of [null, "localhost", "https://pds.example", "a..com"]) {
    assertEquals(normalizeRelayServiceHost(invalid), null);
  }
});

Deno.test("relay discovery fills a missing host service endpoint without overwriting one", async () => {
  const db = await createInventoryTestDb();
  try {
    await db.execute({
      sql: `INSERT INTO account_host
        (host, service_endpoint, updated_at) VALUES (?, ?, ?), (?, ?, ?)`,
      args: [
        "sprk.so",
        null,
        0,
        "custom.example",
        "https://canonical.custom.example",
        0,
      ],
    });
    const instances = parseRelayListHostsPage({
      hosts: [
        { hostname: "sprk.so", status: "active", accountCount: 12 },
        { hostname: "custom.example", status: "active", accountCount: 4 },
      ],
    }).instances;

    await persistRelayPdsInventoryForClient(
      db as unknown as DbClient,
      instances,
      { observedAt: 100, scanId: "service-endpoints", complete: true },
    );

    const endpoints = await db.execute(
      `SELECT host, service_endpoint, service_observed_at
        FROM account_host ORDER BY host`,
    );
    assertEquals(endpoints.rows, [
      {
        host: "custom.example",
        service_endpoint: "https://canonical.custom.example",
        service_observed_at: null,
      },
      {
        host: "sprk.so",
        service_endpoint: "https://sprk.so",
        service_observed_at: 100,
      },
    ]);
  } finally {
    db.close();
  }
});

Deno.test("Bluesky mushroom hosts are classified as one Bluesky account host", () => {
  assert(isBlueskyHostedPds("amanita.us-east.host.bsky.network"));
  assert(isBlueskyHostedPds("bsky.social"));
  assert(isBlueskyHostedPds("pds.bsky.network"));
  assert(!isBlueskyHostedPds("eurosky.social"));

  const parsed = parseRelayListHostsPage({
    cursor: "next",
    hosts: [
      {
        hostname: "amanita.us-east.host.bsky.network",
        status: "active",
        accountCount: 120_000,
        seq: 99,
      },
      {
        hostname: "blacksky.app",
        status: "idle",
        accountCount: 4_000,
      },
      {
        hostname: "tngl.sh",
        status: "active",
        accountCount: 5_500,
      },
    ],
  });

  assertEquals(parsed.cursor, "next");
  assertEquals(
    parsed.instances.map((row) => ({
      serviceHost: row.serviceHost,
      accountHost: row.accountHost,
      isBlueskyHost: row.isBlueskyHost,
    })),
    [
      {
        serviceHost: "amanita.us-east.host.bsky.network",
        accountHost: "bsky.network",
        isBlueskyHost: true,
      },
      {
        serviceHost: "blacksky.app",
        accountHost: "blacksky.community",
        isBlueskyHost: false,
      },
      {
        serviceHost: "tngl.sh",
        accountHost: "tangled.org",
        isBlueskyHost: false,
      },
    ],
  );
});

Deno.test("relay pages reject malformed hosts without treating them as absent", () => {
  assertThrows(
    () => parseRelayListHostsPage({ hosts: [null] }),
    "not an object",
  );
  assertThrows(
    () =>
      parseRelayListHostsPage({ hosts: [{ hostname: "https://pds.test" }] }),
    "invalid hostname",
  );
  assertThrows(
    () =>
      parseRelayListHostsPage({
        hosts: [{ hostname: "pds.example.com", accountCount: -1 }],
      }),
    "invalid accountCount",
  );
  assertThrows(
    () => parseRelayListHostsPage({ cursor: 123, hosts: [] }),
    "invalid cursor",
  );
});

Deno.test("relay inventory fetch paginates and summarizes without DID scans", async () => {
  const seen: string[] = [];
  const pages = [
    {
      cursor: "2",
      hosts: [
        {
          hostname: "blewit.us-west.host.bsky.network",
          status: "active",
          accountCount: 100,
        },
        {
          hostname: "eurosky.social",
          status: "active",
          accountCount: 20,
        },
      ],
    },
    {
      hosts: [
        {
          hostname: "pds.example.com",
          status: "offline",
          accountCount: 2,
        },
      ],
    },
  ];
  const result = await fetchRelayPdsInventory({
    pageSize: 2,
    fetchImpl: ((input: URL | Request | string) => {
      seen.push(String(input));
      const page = pages.shift();
      return Promise.resolve(
        new Response(JSON.stringify(page), {
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch,
  });

  assertEquals(seen, [
    "https://bsky.network/xrpc/com.atproto.sync.listHosts?limit=2",
    "https://bsky.network/xrpc/com.atproto.sync.listHosts?limit=2&cursor=2",
  ]);
  assertEquals(result.pages, 2);
  assertEquals(result.complete, true);
  assertEquals(result.nextCursor, null);
  assertEquals(summarizeRelayPdsInventory(result.instances), {
    totalInstances: 3,
    activeInstances: 2,
    blueskyInstances: 1,
    independentInstances: 2,
    totalAccounts: 122,
    blueskyAccounts: 100,
    independentAccounts: 22,
    unknownAccountCountInstances: 0,
  });
});

Deno.test("relay inventory follows an empty page when it has a cursor", async () => {
  const pages = [
    { cursor: "next", hosts: [] },
    { hosts: [{ hostname: "pds.example.com", accountCount: 2 }] },
  ];
  const result = await fetchRelayPdsInventory({
    fetchImpl: (() =>
      Promise.resolve(
        new Response(JSON.stringify(pages.shift()), {
          headers: { "content-type": "application/json" },
        }),
      )) as typeof fetch,
  });

  assertEquals(result.pages, 2);
  assertEquals(result.complete, true);
  assertEquals(result.instances.map((row) => row.serviceHost), [
    "pds.example.com",
  ]);
});

Deno.test("relay inventory obeys an overall abort signal before fetching", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("inventory deadline", "TimeoutError"));
  let fetches = 0;
  await assertRejects(
    () =>
      fetchRelayPdsInventory({
        signal: controller.signal,
        fetchImpl: (() => {
          fetches++;
          return Promise.resolve(new Response('{"hosts":[]}'));
        }) as typeof fetch,
      }),
    "inventory deadline",
  );
  assertEquals(fetches, 0);
});

Deno.test("relay inventory retries only transient database failures with bounded jitter", () => {
  const serialization = Object.assign(new Error("retry"), { code: "40001" });
  assert(isRetryableInventoryDbError(serialization));
  assertEquals(inventoryDbErrorCode(serialization), "40001");
  assert(isRetryableInventoryDbError(new Error("database is locked")));
  assert(!isRetryableInventoryDbError(new Error("invalid integer syntax")));
  assertEquals(inventoryDbRetryDelayMs(1, () => 0), 50);
  assertEquals(inventoryDbRetryDelayMs(2, () => 1), 200);
  assertEquals(inventoryDbRetryDelayMs(10, () => 1), 2_000);
});

Deno.test("relay inventory refuses redirects and unbounded or non-JSON pages", async () => {
  let redirectMode: RequestRedirect | undefined;
  await assertRejects(
    () =>
      fetchRelayPdsInventory({
        fetchImpl: ((_input, init) => {
          redirectMode = init?.redirect;
          return Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { location: "http://127.0.0.1/private" },
            }),
          );
        }) as typeof fetch,
      }),
    "HTTP 302",
  );
  assertEquals(redirectMode, "manual");

  await assertRejects(
    () =>
      fetchRelayPdsInventory({
        fetchImpl: (() =>
          Promise.resolve(
            new Response('{"hosts":[]}', {
              headers: { "content-type": "text/html" },
            }),
          )) as typeof fetch,
      }),
    "non-JSON",
  );

  await assertRejects(
    () =>
      fetchRelayPdsInventory({
        fetchImpl: (() =>
          Promise.resolve(
            new Response("x".repeat(2 * 1024 * 1024 + 1), {
              headers: { "content-type": "application/json" },
            }),
          )) as typeof fetch,
      }),
    "response too large",
  );
});

Deno.test("relay pages cap cursor and host collection work", () => {
  assertThrows(
    () =>
      parseRelayListHostsPage({
        cursor: "x".repeat(2_049),
        hosts: [],
      }),
    "invalid cursor",
  );
  assertThrows(
    () =>
      parseRelayListHostsPage({
        hosts: Array.from({ length: 1_001 }, () => ({
          hostname: "pds.example.com",
        })),
      }),
    "too many hosts",
  );
});

Deno.test("relay inventory persistence aggregates mushrooms and marks stale rows", async () => {
  const db = await createInventoryTestDb();
  try {
    await db.execute({
      sql: `INSERT INTO account_host
        (host, observed_account_count, observed_active_account_count, updated_at)
        VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)`,
      args: [
        "bsky.network",
        0,
        10,
        0,
        "blacksky.community",
        0,
        2,
        0,
        "legacy.example",
        99,
        88,
        0,
      ],
    });

    const first = parseRelayListHostsPage({
      hosts: [
        {
          hostname: "amanita.us-east.host.bsky.network",
          status: "active",
          accountCount: 10,
        },
        {
          hostname: "blewit.us-west.host.bsky.network",
          status: "active",
          accountCount: 20,
        },
        {
          hostname: "blacksky.app",
          status: "active",
          accountCount: 4,
        },
        {
          hostname: "independent.example",
          status: "active",
          accountCount: 3,
        },
      ],
    }).instances;
    const firstPersisted = await persistRelayPdsInventoryForClient(
      db as unknown as DbClient,
      first,
      {
        observedAt: 100,
        scanId: "first",
        complete: true,
      },
    );
    assertEquals(firstPersisted.publishedHosts, 1);

    const firstCounts = await db.execute(
      `SELECT host, observed_account_count, observed_active_account_count
        FROM account_host ORDER BY host`,
    );
    assertEquals(firstCounts.rows, [
      {
        host: "blacksky.community",
        observed_account_count: 4,
        observed_active_account_count: 4,
      },
      {
        host: "bsky.network",
        observed_account_count: 30,
        observed_active_account_count: 30,
      },
      {
        host: "independent.example",
        observed_account_count: 3,
        observed_active_account_count: 3,
      },
      {
        host: "legacy.example",
        observed_account_count: 0,
        observed_active_account_count: 0,
      },
    ]);

    const second = parseRelayListHostsPage({
      hosts: [
        {
          hostname: "amanita.us-east.host.bsky.network",
          status: "active",
          accountCount: 12,
        },
      ],
    }).instances;
    const persisted = await persistRelayPdsInventoryForClient(
      db as unknown as DbClient,
      second,
      {
        observedAt: 200,
        scanId: "second",
        complete: true,
        allowLargeDrop: true,
      },
    );
    assertEquals(persisted.staleInstances, 3);

    const secondCounts = await db.execute(
      "SELECT host, observed_account_count FROM account_host ORDER BY host",
    );
    assertEquals(secondCounts.rows, [
      { host: "blacksky.community", observed_account_count: 0 },
      { host: "bsky.network", observed_account_count: 12 },
      { host: "independent.example", observed_account_count: 0 },
      { host: "legacy.example", observed_account_count: 0 },
    ]);
    const lastActive = await db.execute(
      "SELECT host, last_active_at FROM account_host ORDER BY host",
    );
    assertEquals(lastActive.rows, [
      { host: "blacksky.community", last_active_at: 100 },
      { host: "bsky.network", last_active_at: 200 },
      { host: "independent.example", last_active_at: 100 },
      { host: "legacy.example", last_active_at: null },
    ]);
    const statusHistory = await db.execute(
      `SELECT service_host, relay_status, observed_at
        FROM pds_instance_status_history
        ORDER BY observed_at, service_host, relay_status`,
    );
    assertEquals(statusHistory.rows, [
      {
        service_host: "amanita.us-east.host.bsky.network",
        relay_status: "active",
        observed_at: 100,
      },
      {
        service_host: "blacksky.app",
        relay_status: "active",
        observed_at: 100,
      },
      {
        service_host: "blewit.us-west.host.bsky.network",
        relay_status: "active",
        observed_at: 100,
      },
      {
        service_host: "independent.example",
        relay_status: "active",
        observed_at: 100,
      },
      {
        service_host: "blacksky.app",
        relay_status: "not_seen",
        observed_at: 200,
      },
      {
        service_host: "blewit.us-west.host.bsky.network",
        relay_status: "not_seen",
        observed_at: 200,
      },
      {
        service_host: "independent.example",
        relay_status: "not_seen",
        observed_at: 200,
      },
    ]);
  } finally {
    db.close();
  }
});

Deno.test("partial relay scans never publish incomplete account totals", async () => {
  const db = await createInventoryTestDb();
  try {
    await db.execute({
      sql: `INSERT INTO account_host (
          host, observed_account_count, observed_active_account_count, updated_at
        ) VALUES (?, ?, ?, ?)`,
      args: ["bsky.network", 77, 6, 0],
    });
    const partial = parseRelayListHostsPage({
      hosts: [{
        hostname: "partial-independent.example",
        accountCount: 10,
      }],
    }).instances;

    await persistRelayPdsInventoryForClient(
      db as unknown as DbClient,
      partial,
      { observedAt: 100, scanId: "partial", complete: false },
    );

    const publicCounts = await db.execute(
      `SELECT observed_account_count, observed_active_account_count,
          last_indexed_account_at
        FROM account_host WHERE host = 'bsky.network'`,
    );
    assertEquals(publicCounts.rows, [{
      observed_account_count: 77,
      observed_active_account_count: 6,
      last_indexed_account_at: null,
    }]);
    const publicHostCount = await db.execute(
      "SELECT COUNT(*) AS count FROM account_host",
    );
    assertEquals(publicHostCount.rows, [{ count: 1 }]);
    const rawCount = await db.execute(
      "SELECT COUNT(*) AS count FROM pds_instance",
    );
    assertEquals(rawCount.rows, [{ count: 1 }]);
  } finally {
    db.close();
  }
});

Deno.test("complete relay scans reject empty and unexpectedly truncated inventories", async () => {
  const db = await createInventoryTestDb();
  try {
    await db.execute({
      sql: "INSERT INTO account_host (host, updated_at) VALUES (?, ?)",
      args: ["bsky.network", 0],
    });
    const baseline = parseRelayListHostsPage({
      hosts: [
        { hostname: "one.host.bsky.network", accountCount: 10 },
        { hostname: "two.host.bsky.network", accountCount: 20 },
      ],
    }).instances;
    await persistRelayPdsInventoryForClient(
      db as unknown as DbClient,
      baseline,
      { observedAt: 100, scanId: "baseline", complete: true },
    );

    await assertRejects(
      () =>
        persistRelayPdsInventoryForClient(
          db as unknown as DbClient,
          [],
          { observedAt: 200, scanId: "empty", complete: true },
        ),
      "empty complete",
    );
    await assertRejects(
      () =>
        persistRelayPdsInventoryForClient(
          db as unknown as DbClient,
          baseline.slice(0, 1),
          { observedAt: 200, scanId: "truncated", complete: true },
        ),
      "allowLargeDrop",
    );

    const statuses = await db.execute(
      "SELECT relay_status, COUNT(*) AS count FROM pds_instance GROUP BY relay_status",
    );
    assertEquals(statuses.rows, [{ relay_status: "unknown", count: 2 }]);
  } finally {
    db.close();
  }
});

Deno.test("missing optional relay account counts preserve the last known value", async () => {
  const db = await createInventoryTestDb();
  try {
    await db.execute({
      sql: "INSERT INTO account_host (host, updated_at) VALUES (?, ?)",
      args: ["bsky.network", 0],
    });
    const known = parseRelayListHostsPage({
      hosts: [{ hostname: "one.host.bsky.network", accountCount: 10 }],
    }).instances;
    const unknown = parseRelayListHostsPage({
      hosts: [{ hostname: "one.host.bsky.network" }],
    }).instances;
    assertEquals(summarizeRelayPdsInventory(unknown), {
      totalInstances: 1,
      activeInstances: 0,
      blueskyInstances: 1,
      independentInstances: 0,
      totalAccounts: 0,
      blueskyAccounts: 0,
      independentAccounts: 0,
      unknownAccountCountInstances: 1,
    });

    await persistRelayPdsInventoryForClient(
      db as unknown as DbClient,
      known,
      { observedAt: 100, scanId: "known", complete: true },
    );
    await persistRelayPdsInventoryForClient(
      db as unknown as DbClient,
      unknown,
      { observedAt: 200, scanId: "unknown", complete: true },
    );

    const counts = await db.execute(
      "SELECT relay_account_count FROM pds_instance",
    );
    assertEquals(counts.rows, [{ relay_account_count: 10 }]);
  } finally {
    db.close();
  }
});
