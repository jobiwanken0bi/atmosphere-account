import { createClient } from "@libsql/client";
import type { DbClient } from "./db.ts";
import { getAppListingLoginAvailabilityWithClient } from "./app-directory.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function createSafetyTables(db: ReturnType<typeof createClient>) {
  await db.execute(`CREATE TABLE app_listing (
    id TEXT PRIMARY KEY,
    product_did TEXT,
    profile_did TEXT,
    legacy_profile_did TEXT,
    deleted_at INTEGER
  )`);
  await db.execute(`CREATE TABLE app_moderation (
    listing_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'visible',
    updated_by TEXT
  )`);
  await db.execute(`CREATE TABLE profile (
    did TEXT PRIMARY KEY,
    profile_type TEXT NOT NULL,
    takedown_status TEXT
  )`);
}

Deno.test("login availability ignores ordinary directory absence but blocks explicit moderation", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createSafetyTables(db);
    const client = db as unknown as DbClient;
    await db.execute({
      sql: `INSERT INTO app_listing (
        id, product_did, profile_did, legacy_profile_did, deleted_at
      ) VALUES (?, ?, ?, ?, NULL)`,
      args: [
        "app-example",
        "did:plc:owner",
        "did:plc:profile",
        null,
      ],
    });

    // A live ATStore app does not need a legacy public profile row. In
    // particular, public-directory privacy is not a Login with Atmosphere
    // moderation signal.
    assertEquals(
      await getAppListingLoginAvailabilityWithClient(client, "app-example"),
      "available",
    );

    await db.execute({
      sql:
        `INSERT INTO app_moderation (listing_id, status, updated_by) VALUES (?, ?, ?)`,
      args: ["app-example", "hidden", "did:plc:moderator"],
    });
    assertEquals(
      await getAppListingLoginAvailabilityWithClient(client, "app-example"),
      "moderated",
    );
  } finally {
    db.close();
  }
});

Deno.test("login availability honors legacy profile takedown and app deletion", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createSafetyTables(db);
    const client = db as unknown as DbClient;
    await db.execute({
      sql: `INSERT INTO app_listing (
        id, product_did, profile_did, legacy_profile_did, deleted_at
      ) VALUES (?, ?, ?, ?, NULL)`,
      args: [
        "app-legacy",
        "did:plc:owner",
        null,
        "did:plc:legacy",
      ],
    });
    await db.execute({
      sql:
        `INSERT INTO profile (did, profile_type, takedown_status) VALUES (?, 'project', 'taken_down')`,
      args: ["did:plc:legacy"],
    });
    assertEquals(
      await getAppListingLoginAvailabilityWithClient(client, "app-legacy"),
      "taken_down",
    );

    await db.execute({
      sql: `UPDATE app_listing SET deleted_at = ? WHERE id = ?`,
      args: [123, "app-legacy"],
    });
    assertEquals(
      await getAppListingLoginAvailabilityWithClient(client, "app-legacy"),
      "deleted",
    );
    assertEquals(
      await getAppListingLoginAvailabilityWithClient(client, "missing"),
      "deleted",
    );
  } finally {
    db.close();
  }
});
