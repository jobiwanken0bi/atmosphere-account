import { createClient } from "@libsql/client";
import {
  fetchRelayPdsInventory,
  isBlueskyHostedPds,
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

Deno.test("relay PDS host normalization accepts public DNS names", () => {
  assertEquals(
    normalizeRelayServiceHost(" PDS.Example.COM. "),
    "pds.example.com",
  );
  for (const invalid of [null, "localhost", "https://pds.example", "a..com"]) {
    assertEquals(normalizeRelayServiceHost(invalid), null);
  }
});

Deno.test("Bluesky mushroom hosts are classified as one Bluesky account host", () => {
  assert(isBlueskyHostedPds("amanita.us-east.host.bsky.network"));
  assert(isBlueskyHostedPds("bsky.social"));
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
      return Promise.resolve(new Response(JSON.stringify(page)));
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
  });
});

Deno.test("relay inventory persistence aggregates mushrooms and marks stale rows", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await db.execute(`CREATE TABLE account_host (
      host TEXT PRIMARY KEY,
      observed_account_count INTEGER NOT NULL DEFAULT 0,
      last_indexed_account_at INTEGER,
      last_observed_at INTEGER,
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
      last_scan_id TEXT NOT NULL
    )`);
    await db.execute({
      sql: "INSERT INTO account_host (host, updated_at) VALUES (?, ?), (?, ?)",
      args: ["bsky.network", 0, "blacksky.community", 0],
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
      ],
    }).instances;
    await persistRelayPdsInventoryForClient(db as unknown as DbClient, first, {
      observedAt: 100,
      scanId: "first",
      complete: true,
    });

    const firstCounts = await db.execute(
      "SELECT host, observed_account_count FROM account_host ORDER BY host",
    );
    assertEquals(firstCounts.rows, [
      { host: "blacksky.community", observed_account_count: 4 },
      { host: "bsky.network", observed_account_count: 30 },
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
      { observedAt: 200, scanId: "second", complete: true },
    );
    assertEquals(persisted.staleInstances, 2);

    const secondCounts = await db.execute(
      "SELECT host, observed_account_count FROM account_host ORDER BY host",
    );
    assertEquals(secondCounts.rows, [
      { host: "blacksky.community", observed_account_count: 0 },
      { host: "bsky.network", observed_account_count: 12 },
    ]);
  } finally {
    db.close();
  }
});
