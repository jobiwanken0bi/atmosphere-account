import { createClient } from "@libsql/client";
import {
  LOGIN_APP_ENVIRONMENT_REVISION_BACKFILL_STATEMENTS,
  LOGIN_APP_LINK_BACKFILL_STATEMENTS,
} from "./atmosphere-login-migration.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, got ${left}`);
}

Deno.test("legacy login environments link only to one unambiguous live app profile", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await db.execute(`CREATE TABLE app_listing (
      id TEXT PRIMARY KEY,
      canonical_uri TEXT NOT NULL,
      product_did TEXT,
      profile_did TEXT,
      legacy_profile_did TEXT,
      deleted_at INTEGER
    )`);
    await db.execute(`CREATE TABLE login_app (
      client_id TEXT PRIMARY KEY,
      contact_did TEXT,
      app_did TEXT,
      app_profile_uri TEXT,
      link_status TEXT NOT NULL DEFAULT 'relink_required'
    )`);
    for (
      const [id, uri, did, deleted] of [
        ["one", "at://did:plc:one/app.profile/one", "did:plc:one", null],
        ["old", "at://did:plc:deleted/app.profile/old", "did:plc:deleted", 1],
        ["a", "at://did:plc:many/app.profile/a", "did:plc:many", null],
        ["b", "at://did:plc:many/app.profile/b", "did:plc:many", null],
      ] as const
    ) {
      await db.execute({
        sql: `INSERT INTO app_listing (
          id, canonical_uri, product_did, deleted_at
        ) VALUES (?, ?, ?, ?)`,
        args: [id, uri, did, deleted],
      });
    }
    for (
      const [clientId, did, linkStatus] of [
        ["https://one.example/client", "did:plc:one", "relink_required"],
        ["https://many.example/client", "did:plc:many", "relink_required"],
        ["https://host.example/client", "did:plc:host-only", "relink_required"],
        [
          "https://deleted.example/client",
          "did:plc:deleted",
          "relink_required",
        ],
        ["https://fixture.example/client", null, "system_fixture"],
      ] as const
    ) {
      await db.execute({
        sql: `INSERT INTO login_app (
          client_id, contact_did, link_status
        ) VALUES (?, ?, ?)`,
        args: [clientId, did, linkStatus],
      });
    }

    for (const statement of LOGIN_APP_LINK_BACKFILL_STATEMENTS) {
      await db.execute(statement);
    }

    const result = await db.execute(`SELECT
      client_id, app_did, app_profile_uri, link_status
      FROM login_app ORDER BY client_id`);
    assertEquals(
      result.rows.map((row) => ({
        clientId: row.client_id,
        appDid: row.app_did ?? null,
        profileUri: row.app_profile_uri ?? null,
        linkStatus: row.link_status,
      })),
      [
        {
          clientId: "https://deleted.example/client",
          appDid: null,
          profileUri: null,
          linkStatus: "relink_required",
        },
        {
          clientId: "https://fixture.example/client",
          appDid: null,
          profileUri: null,
          linkStatus: "system_fixture",
        },
        {
          clientId: "https://host.example/client",
          appDid: null,
          profileUri: null,
          linkStatus: "relink_required",
        },
        {
          clientId: "https://many.example/client",
          appDid: null,
          profileUri: null,
          linkStatus: "relink_required",
        },
        {
          clientId: "https://one.example/client",
          appDid: "did:plc:one",
          profileUri: "at://did:plc:one/app.profile/one",
          linkStatus: "linked",
        },
      ],
    );
    let rerunWrites = 0;
    for (const statement of LOGIN_APP_LINK_BACKFILL_STATEMENTS) {
      const rerun = await db.execute(statement);
      rerunWrites += Number(rerun.rowsAffected ?? 0);
    }
    assertEquals(rerunWrites, 0);
  } finally {
    db.close();
  }
});

Deno.test("legacy login environments receive stable owner-edit revisions", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await db.execute(`CREATE TABLE login_app (
      client_id TEXT PRIMARY KEY,
      review_revision TEXT,
      environment_revision TEXT
    )`);
    await db.execute(`INSERT INTO login_app (
      client_id, review_revision, environment_revision
    ) VALUES
      ('https://reviewed.example/client', 'review-1', NULL),
      ('https://legacy.example/client', NULL, NULL),
      ('https://current.example/client', 'review-2', 'environment-2')`);

    for (
      const statement of LOGIN_APP_ENVIRONMENT_REVISION_BACKFILL_STATEMENTS
    ) {
      await db.execute(statement);
    }
    const rows = await db.execute(`SELECT client_id, environment_revision
      FROM login_app ORDER BY client_id`);
    assertEquals(
      rows.rows.map((row) => ({
        clientId: row.client_id,
        revision: row.environment_revision,
      })),
      [
        {
          clientId: "https://current.example/client",
          revision: "environment-2",
        },
        {
          clientId: "https://legacy.example/client",
          revision: "legacy:https://legacy.example/client",
        },
        {
          clientId: "https://reviewed.example/client",
          revision: "review-1",
        },
      ],
    );

    let rerunWrites = 0;
    for (
      const statement of LOGIN_APP_ENVIRONMENT_REVISION_BACKFILL_STATEMENTS
    ) {
      const rerun = await db.execute(statement);
      rerunWrites += Number(rerun.rowsAffected ?? 0);
    }
    assertEquals(rerunWrites, 0);
  } finally {
    db.close();
  }
});
