import { assertEquals } from "jsr:@std/assert@1";
import { createClient } from "@libsql/client";
import { OAuthStateCleanup } from "./oauth-state-cleanup.ts";

Deno.test("OAuth state cleanup bounds each batch and preserves current login state", async () => {
  const client = createClient({ url: "file::memory:" });
  try {
    await client.execute(`CREATE TABLE oauth_state (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL
    )`);
    await client.execute(
      "CREATE INDEX oauth_state_expires ON oauth_state(expires_at)",
    );
    await client.batch([
      ...Array.from({ length: 1_005 }, (_, index) => ({
        sql: "INSERT INTO oauth_state VALUES (?, 'expired', ?)",
        args: [`expired-${index}`, index],
      })),
      {
        sql: "INSERT INTO oauth_state VALUES ('current', 'keep', 200000)",
        args: [],
      },
      {
        sql: "INSERT INTO oauth_state VALUES ('boundary', 'keep', 100000)",
        args: [],
      },
    ], "write");

    const cleanup = new OAuthStateCleanup();
    await cleanup.run(client, 100_000);
    assertEquals(
      (await client.execute("SELECT count(*) AS n FROM oauth_state")).rows[0].n,
      7,
    );
    // New requests within the interval do not issue another delete.
    await cleanup.run(client, 100_001);
    assertEquals(
      (await client.execute("SELECT count(*) AS n FROM oauth_state")).rows[0].n,
      7,
    );
    await cleanup.run(client, 160_000);
    assertEquals(
      (await client.execute("SELECT key, value FROM oauth_state")).rows.map(
        ({ key, value }) => ({ key, value }),
      ),
      [{ key: "current", value: "keep" }],
    );
  } finally {
    client.close();
  }
});

Deno.test("concurrent login attempts share one OAuth cleanup interval", async () => {
  const cleanup = new OAuthStateCleanup();
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => release = resolve);
  const client = {
    execute() {
      calls++;
      return pending;
    },
  };
  const first = cleanup.run(client, 100_000);
  try {
    await Promise.all([
      cleanup.run(client, 100_000),
      cleanup.run(client, 100_001),
    ]);
    assertEquals(calls, 1);
  } finally {
    release();
    await first;
  }
});

Deno.test("OAuth cleanup failures do not break login or retry on every request", async () => {
  const cleanup = new OAuthStateCleanup();
  let calls = 0;
  const client = {
    execute() {
      calls++;
      return Promise.reject(new Error("database unavailable"));
    },
  };
  await cleanup.run(client, 100_000);
  await cleanup.run(client, 100_001);
  assertEquals(calls, 1);
  await cleanup.run(client, 160_000);
  assertEquals(calls, 2);
});
