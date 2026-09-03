import { createClient } from "@libsql/client";
import {
  applyLoginAppTrustReviewDecisionWithClient,
  deleteLoginAppForOwnerWithClient,
  hydrateLoginAppTrustReviewRowFailClosed,
  LoginRequestError,
  resetLoginAppReviewStateWithClient,
  saveLoginAppTrustReviewRequestWithClient,
  syncLoginAppProfileIdentityWithClient,
  upsertLoginAppWithClient,
} from "./atmosphere-login.ts";
import type { DbClient } from "./db.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, got ${left}`);
}

async function createLoginAppTable(db: ReturnType<typeof createClient>) {
  await db.execute(`CREATE TABLE login_app (
    client_id TEXT PRIMARY KEY,
    app_name TEXT NOT NULL,
    app_uri TEXT,
    logo_uri TEXT,
    allowed_return_uris TEXT NOT NULL DEFAULT '[]',
    allowed_origins TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'unverified',
    contact_did TEXT,
    app_did TEXT,
    app_profile_uri TEXT,
    link_status TEXT NOT NULL DEFAULT 'relink_required',
    profile_identity_fingerprint TEXT,
    profile_identity_updated_at INTEGER,
    review_revision TEXT,
    environment_revision TEXT,
    preferred_account_host TEXT,
    review_status TEXT NOT NULL DEFAULT 'none',
    review_requested_at INTEGER,
    review_notes TEXT,
    review_decision_at INTEGER,
    review_decision_by TEXT,
    review_decision_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await db.execute(`CREATE TABLE app_listing (
    id TEXT PRIMARY KEY,
    canonical_uri TEXT NOT NULL,
    product_did TEXT,
    profile_did TEXT,
    legacy_profile_did TEXT,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`);
  await db.execute(`CREATE TABLE app_moderation (
    listing_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'visible'
  )`);
  await db.execute(`CREATE TABLE profile (
    did TEXT PRIMARY KEY,
    profile_type TEXT NOT NULL,
    takedown_status TEXT
  )`);
  await db.execute({
    sql: `INSERT INTO app_listing (
      id, canonical_uri, product_did, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, NULL)`,
    args: [
      "app-example",
      "at://did:plc:owner/app.profile/example",
      "did:plc:owner",
      1,
    ],
  });
}

const ownerInput = {
  clientId: "https://app.example/client.json",
  appName: "Example App",
  appUri: "https://app.example/",
  logoUri: "https://app.example/icon.png",
  allowedReturnUris: ["https://app.example/callback"],
  allowedOrigins: [],
  status: "trusted" as const,
  contactDid: "did:plc:owner",
  appDid: "did:plc:owner",
  appProfileUri: "at://did:plc:owner/app.profile/example",
  linkStatus: "linked" as const,
  profileIdentityFingerprint: "profile-v1",
  profileIdentityUpdatedAt: 1,
  environmentRevision: "environment-v1",
  preferredAccountHost: null,
};

Deno.test("owner upserts preserve a concurrent admin block and cannot steal a client ID", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createLoginAppTable(db);
    const client = db as unknown as DbClient;
    assertEquals(await upsertLoginAppWithClient(client, ownerInput, 1), true);
    await db.execute({
      sql: `UPDATE login_app SET status = 'blocked' WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });
    assertEquals(
      await upsertLoginAppWithClient(client, {
        ...ownerInput,
        status: "unverified",
        allowedReturnUris: ["https://app.example/new-callback"],
      }, 2),
      true,
    );
    assertEquals(
      await upsertLoginAppWithClient(client, {
        ...ownerInput,
        appName: "Attacker app",
        contactDid: "did:plc:other",
        appDid: "did:plc:other",
        appProfileUri: "at://did:plc:other/app.profile/other",
        profileIdentityFingerprint: "attacker-profile",
        status: "trusted",
      }, 3),
      false,
    );
    assertEquals(
      await upsertLoginAppWithClient(client, {
        ...ownerInput,
        appName: "Fixture overwrite",
        appDid: null,
        appProfileUri: null,
        contactDid: null,
        linkStatus: "system_fixture",
      }, 4),
      false,
    );
    assertEquals(
      await upsertLoginAppWithClient(client, {
        ...ownerInput,
        appName: "Unlinked overwrite",
        appDid: null,
        appProfileUri: null,
        linkStatus: "relink_required",
      }, 5),
      false,
    );

    const result = await db.execute({
      sql: `SELECT status, app_did, app_name, allowed_return_uris
        FROM login_app WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });
    assertEquals({
      status: result.rows[0].status,
      appDid: result.rows[0].app_did,
      appName: result.rows[0].app_name,
      returns: JSON.parse(String(result.rows[0].allowed_return_uris)),
    }, {
      status: "blocked",
      appDid: "did:plc:owner",
      appName: "Example App",
      returns: ["https://app.example/new-callback"],
    });
  } finally {
    db.close();
  }
});

Deno.test("owner environment edits use CAS and refuse concurrent create races", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createLoginAppTable(db);
    const client = db as unknown as DbClient;
    assertEquals(
      await upsertLoginAppWithClient(client, {
        ...ownerInput,
        insertOnly: true,
      }, 1),
      true,
    );
    assertEquals(
      await upsertLoginAppWithClient(client, {
        ...ownerInput,
        insertOnly: true,
        allowedReturnUris: ["https://app.example/racing-create"],
        environmentRevision: "racing-create",
      }, 2),
      false,
    );
    assertEquals(
      await upsertLoginAppWithClient(client, {
        ...ownerInput,
        allowedReturnUris: ["https://app.example/first-edit"],
        expectedEnvironmentRevision: "environment-v1",
        environmentRevision: "environment-v2",
      }, 3),
      true,
    );
    assertEquals(
      await upsertLoginAppWithClient(client, {
        ...ownerInput,
        allowedReturnUris: ["https://app.example/stale-edit"],
        expectedEnvironmentRevision: "environment-v1",
        environmentRevision: "environment-v3",
      }, 4),
      false,
    );
    // The persistence layer also refuses an exact stale replay. The owner
    // service resolves this as success only after re-reading and comparing the
    // complete submitted environment.
    assertEquals(
      await upsertLoginAppWithClient(client, {
        ...ownerInput,
        allowedReturnUris: ["https://app.example/first-edit"],
        expectedEnvironmentRevision: "environment-v1",
        environmentRevision: "environment-v4",
      }, 5),
      false,
    );

    const saved = (await db.execute({
      sql: `SELECT allowed_return_uris, environment_revision
        FROM login_app WHERE client_id = ?`,
      args: [ownerInput.clientId],
    })).rows[0];
    assertEquals({
      returnUris: JSON.parse(String(saved.allowed_return_uris)),
      environmentRevision: saved.environment_revision,
    }, {
      returnUris: ["https://app.example/first-edit"],
      environmentRevision: "environment-v2",
    });
  } finally {
    db.close();
  }
});

Deno.test("owner environment changes atomically invalidate trust review", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createLoginAppTable(db);
    const client = db as unknown as DbClient;
    await upsertLoginAppWithClient(client, {
      ...ownerInput,
      reviewRevision: "reviewed-environment",
    }, 1);
    await db.execute({
      sql: `UPDATE login_app SET
        review_status = 'requested',
        review_requested_at = 1,
        review_notes = 'ready'
        WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });

    assertEquals(
      await upsertLoginAppWithClient(client, {
        ...ownerInput,
        reviewRevision: "unused-owner-save",
      }, 2),
      true,
    );
    let saved = (await db.execute({
      sql: `SELECT status, review_status, review_revision, review_notes
        FROM login_app WHERE client_id = ?`,
      args: [ownerInput.clientId],
    })).rows[0];
    assertEquals({
      status: saved.status,
      reviewStatus: saved.review_status,
      reviewRevision: saved.review_revision,
      reviewNotes: saved.review_notes,
    }, {
      status: "trusted",
      reviewStatus: "requested",
      reviewRevision: "reviewed-environment",
      reviewNotes: "ready",
    });

    assertEquals(
      await upsertLoginAppWithClient(client, {
        ...ownerInput,
        status: "unverified",
        allowedReturnUris: ["https://app.example/new-callback"],
        reviewRevision: "changed-environment",
      }, 3),
      true,
    );
    saved = (await db.execute({
      sql: `SELECT status, review_status, review_revision,
          review_requested_at, review_notes
        FROM login_app WHERE client_id = ?`,
      args: [ownerInput.clientId],
    })).rows[0];
    assertEquals({
      status: saved.status,
      reviewStatus: saved.review_status,
      reviewRevision: saved.review_revision,
      reviewRequestedAt: saved.review_requested_at ?? null,
      reviewNotes: saved.review_notes ?? null,
    }, {
      status: "unverified",
      reviewStatus: "none",
      reviewRevision: "changed-environment",
      reviewRequestedAt: null,
      reviewNotes: null,
    });
  } finally {
    db.close();
  }
});

Deno.test("profile synchronization fails closed after a concurrent ownership change", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createLoginAppTable(db);
    const client = db as unknown as DbClient;
    await upsertLoginAppWithClient(client, ownerInput, 1);
    const stale = (await db.execute({
      sql: `SELECT * FROM login_app WHERE client_id = ?`,
      args: [ownerInput.clientId],
    })).rows[0] as Record<string, unknown>;
    await db.execute({
      sql: `UPDATE login_app SET
        contact_did = 'did:plc:other',
        app_did = 'did:plc:other',
        app_profile_uri = 'at://did:plc:other/app.profile/other',
        profile_identity_fingerprint = 'other-profile'
        WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });

    try {
      await syncLoginAppProfileIdentityWithClient(client, stale, {
        did: "did:plc:owner",
        listingId: "app-example",
        profileUri: ownerInput.appProfileUri,
        slug: "example",
        name: "Renamed App",
        homepage: ownerInput.appUri,
        logoUri: ownerInput.logoUri,
        updatedAt: 2,
        loginAvailability: "available",
        identityFingerprint: "profile-v2",
      }, 2);
      throw new Error("Expected concurrent ownership change to fail closed");
    } catch (error) {
      if (!(error instanceof LoginRequestError)) throw error;
      assertEquals(error.status, 409);
    }
    const current = (await db.execute({
      sql: `SELECT app_did, app_profile_uri FROM login_app WHERE client_id = ?`,
      args: [ownerInput.clientId],
    })).rows[0];
    assertEquals({
      appDid: current.app_did,
      profileUri: current.app_profile_uri,
    }, {
      appDid: "did:plc:other",
      profileUri: "at://did:plc:other/app.profile/other",
    });
  } finally {
    db.close();
  }
});

Deno.test("profile synchronization accepts Postgres bigint timestamps returned as strings", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createLoginAppTable(db);
    const client = db as unknown as DbClient;
    await upsertLoginAppWithClient(client, ownerInput, 1);
    const stale = (await db.execute({
      sql: `SELECT * FROM login_app WHERE client_id = ?`,
      args: [ownerInput.clientId],
    })).rows[0] as Record<string, unknown>;
    stale.profile_identity_updated_at = String(
      stale.profile_identity_updated_at,
    );

    const postgresLikeClient: DbClient = {
      async execute(query, args) {
        const result = await client.execute(query, args);
        const sql = typeof query === "string" ? query : query.sql;
        if (!sql.includes("SELECT * FROM login_app")) return result;
        return {
          ...result,
          rows: result.rows.map((row) => ({
            ...row,
            profile_identity_updated_at:
              row.profile_identity_updated_at === null
                ? null
                : String(row.profile_identity_updated_at),
          })),
        };
      },
    };

    const synced = await syncLoginAppProfileIdentityWithClient(
      postgresLikeClient,
      stale,
      {
        did: "did:plc:owner",
        listingId: "app-example",
        profileUri: ownerInput.appProfileUri,
        slug: "example",
        name: "Renamed App",
        homepage: ownerInput.appUri,
        logoUri: ownerInput.logoUri,
        updatedAt: 2,
        loginAvailability: "available",
        identityFingerprint: "profile-v2",
      },
      2,
    );
    assertEquals({
      appName: synced.app_name,
      profileIdentityUpdatedAt: synced.profile_identity_updated_at,
      profileIdentityFingerprint: synced.profile_identity_fingerprint,
    }, {
      appName: "Renamed App",
      profileIdentityUpdatedAt: "2",
      profileIdentityFingerprint: "profile-v2",
    });
  } finally {
    db.close();
  }
});

Deno.test("profile synchronization keeps millisecond bigint parameters out of Postgres integer inference", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createLoginAppTable(db);
    const client = db as unknown as DbClient;
    const previousTimestamp = 1_785_367_862_706;
    const nextTimestamp = previousTimestamp + 1;
    await upsertLoginAppWithClient(client, ownerInput, previousTimestamp);
    await db.execute({
      sql:
        `UPDATE login_app SET profile_identity_updated_at = ? WHERE client_id = ?`,
      args: [previousTimestamp, ownerInput.clientId],
    });
    const stale = (await db.execute({
      sql: `SELECT * FROM login_app WHERE client_id = ?`,
      args: [ownerInput.clientId],
    })).rows[0] as Record<string, unknown>;
    stale.profile_identity_updated_at = String(
      stale.profile_identity_updated_at,
    );

    let updateSql = "";
    const postgresLikeClient: DbClient = {
      async execute(query, args) {
        const sql = typeof query === "string" ? query : query.sql;
        if (/UPDATE\s+login_app/i.test(sql)) updateSql = sql;
        const result = await client.execute(query, args);
        if (!sql.includes("SELECT * FROM login_app")) return result;
        return {
          ...result,
          rows: result.rows.map((row) => ({
            ...row,
            profile_identity_updated_at:
              row.profile_identity_updated_at === null
                ? null
                : String(row.profile_identity_updated_at),
          })),
        };
      },
    };

    const synced = await syncLoginAppProfileIdentityWithClient(
      postgresLikeClient,
      stale,
      {
        did: "did:plc:owner",
        listingId: "app-example",
        profileUri: ownerInput.appProfileUri,
        slug: "example",
        name: "Renamed App",
        homepage: ownerInput.appUri,
        logoUri: ownerInput.logoUri,
        updatedAt: nextTimestamp,
        loginAvailability: "available",
        identityFingerprint: "profile-v2",
      },
      nextTimestamp,
    );

    if (!updateSql.includes("CAST(-1 AS BIGINT)")) {
      throw new Error("Expected bigint-safe optimistic-lock parameters");
    }
    assertEquals({
      appName: synced.app_name,
      profileIdentityUpdatedAt: synced.profile_identity_updated_at,
    }, {
      appName: "Renamed App",
      profileIdentityUpdatedAt: String(nextTimestamp),
    });
  } finally {
    db.close();
  }
});

Deno.test("profile identity synchronization cannot overwrite a concurrent block", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createLoginAppTable(db);
    const client = db as unknown as DbClient;
    await upsertLoginAppWithClient(client, ownerInput, 1);
    await db.execute({
      sql: `UPDATE login_app SET
        review_status = 'approved', review_decision_at = 1,
        review_decision_by = 'did:plc:admin',
        review_decision_reason = 'security incident'
        WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });
    const stale = (await db.execute({
      sql: `SELECT * FROM login_app WHERE client_id = ?`,
      args: [ownerInput.clientId],
    })).rows[0] as Record<string, unknown>;
    await db.execute({
      sql: `UPDATE login_app SET status = 'blocked' WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });
    assertEquals(
      await resetLoginAppReviewStateWithClient(
        client,
        ownerInput.clientId,
        2,
      ),
      false,
    );

    const synced = await syncLoginAppProfileIdentityWithClient(
      client,
      stale,
      {
        did: "did:plc:owner",
        listingId: "app-example",
        profileUri: ownerInput.appProfileUri,
        slug: "example",
        name: "Renamed App",
        homepage: ownerInput.appUri,
        logoUri: ownerInput.logoUri,
        updatedAt: 3,
        loginAvailability: "available",
        identityFingerprint: "profile-v2",
      },
      3,
    );
    assertEquals({
      status: synced.status,
      reviewStatus: synced.review_status,
      reviewDecisionBy: synced.review_decision_by ?? null,
      reviewDecisionReason: synced.review_decision_reason ?? null,
      appName: synced.app_name,
    }, {
      status: "blocked",
      reviewStatus: "approved",
      reviewDecisionBy: "did:plc:admin",
      reviewDecisionReason: "security incident",
      appName: "Renamed App",
    });
  } finally {
    db.close();
  }
});

Deno.test("linked upserts do not create an orphan after the app profile disappears", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createLoginAppTable(db);
    const client = db as unknown as DbClient;
    assertEquals(await upsertLoginAppWithClient(client, ownerInput, 1), true);
    await db.execute(`DELETE FROM app_listing`);

    assertEquals(
      await upsertLoginAppWithClient(client, {
        ...ownerInput,
        clientId: "https://new.example/client.json",
      }, 2),
      false,
    );
    assertEquals(
      await upsertLoginAppWithClient(client, {
        ...ownerInput,
        allowedReturnUris: ["https://app.example/replaced"],
      }, 3),
      false,
    );

    const rows = await db.execute(
      `SELECT client_id, allowed_return_uris FROM login_app ORDER BY client_id`,
    );
    assertEquals(
      rows.rows.map((row) => ({
        clientId: row.client_id,
        returns: JSON.parse(String(row.allowed_return_uris)),
      })),
      [{
        clientId: ownerInput.clientId,
        returns: ownerInput.allowedReturnUris,
      }],
    );
  } finally {
    db.close();
  }
});

Deno.test("trusted approval is bound to the reviewed environment and live profile version", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createLoginAppTable(db);
    const client = db as unknown as DbClient;
    await upsertLoginAppWithClient(client, {
      ...ownerInput,
      status: "unverified",
      reviewRevision: "review-1",
    }, 1);
    await db.execute({
      sql: `UPDATE login_app
        SET review_status = 'requested', review_revision = 'review-2',
            allowed_return_uris = '["https://app.example/changed"]'
        WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });
    assertEquals(
      await applyLoginAppTrustReviewDecisionWithClient(
        client,
        {
          clientId: ownerInput.clientId,
          adminDid: "did:plc:admin",
          action: "approve",
          expectedReviewRevision: "review-1",
        },
        2,
        "decision-1",
      ),
      false,
    );

    await db.execute({
      sql: `UPDATE login_app
        SET review_status = 'requested', review_revision = 'review-3'
        WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });
    await db.execute(`UPDATE app_listing SET updated_at = 2`);
    assertEquals(
      await applyLoginAppTrustReviewDecisionWithClient(
        client,
        {
          clientId: ownerInput.clientId,
          adminDid: "did:plc:admin",
          action: "approve",
          expectedReviewRevision: "review-3",
        },
        3,
        "decision-2",
      ),
      false,
    );

    await db.execute({
      sql: `UPDATE login_app
        SET profile_identity_updated_at = 2,
            review_status = 'requested', review_revision = 'review-4'
        WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });
    assertEquals(
      await applyLoginAppTrustReviewDecisionWithClient(
        client,
        {
          clientId: ownerInput.clientId,
          adminDid: "did:plc:admin",
          action: "approve",
          expectedReviewRevision: "review-4",
        },
        4,
        "decision-3",
      ),
      true,
    );
    const current = (await db.execute({
      sql: `SELECT status, review_status, review_revision
        FROM login_app WHERE client_id = ?`,
      args: [ownerInput.clientId],
    })).rows[0];
    assertEquals({
      status: current.status,
      reviewStatus: current.review_status,
      revision: current.review_revision,
    }, {
      status: "trusted",
      reviewStatus: "approved",
      revision: "decision-3",
    });
  } finally {
    db.close();
  }
});

Deno.test("reject and block decisions cannot target a newer review revision", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createLoginAppTable(db);
    const client = db as unknown as DbClient;
    await upsertLoginAppWithClient(client, {
      ...ownerInput,
      status: "unverified",
      reviewRevision: "review-1",
    }, 1);
    await db.execute({
      sql: `UPDATE login_app
        SET review_status = 'requested', review_revision = 'review-2'
        WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });

    for (const action of ["reject", "block"] as const) {
      assertEquals(
        await applyLoginAppTrustReviewDecisionWithClient(
          client,
          {
            clientId: ownerInput.clientId,
            adminDid: "did:plc:admin",
            action,
            expectedReviewRevision: "review-1",
          },
          2,
          `stale-${action}`,
        ),
        false,
      );
    }

    assertEquals(
      await applyLoginAppTrustReviewDecisionWithClient(
        client,
        {
          clientId: ownerInput.clientId,
          adminDid: "did:plc:admin",
          action: "reject",
          expectedReviewRevision: "review-2",
        },
        3,
        "decision-1",
      ),
      true,
    );
    const current = (await db.execute({
      sql: `SELECT status, review_status, review_revision
        FROM login_app WHERE client_id = ?`,
      args: [ownerInput.clientId],
    })).rows[0];
    assertEquals({
      status: current.status,
      reviewStatus: current.review_status,
      revision: current.review_revision,
    }, {
      status: "unverified",
      reviewStatus: "rejected",
      revision: "decision-1",
    });

    await db.execute({
      sql: `UPDATE login_app
        SET review_status = 'requested', review_revision = NULL
        WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });
    assertEquals(
      await applyLoginAppTrustReviewDecisionWithClient(
        client,
        {
          clientId: ownerInput.clientId,
          adminDid: "did:plc:admin",
          action: "block",
          expectedReviewRevision: null,
        },
        4,
        "decision-2",
      ),
      true,
    );
  } finally {
    db.close();
  }
});

Deno.test("review requests are bound to the checked environment and live profile version", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createLoginAppTable(db);
    const client = db as unknown as DbClient;
    await upsertLoginAppWithClient(client, {
      ...ownerInput,
      status: "unverified",
      reviewRevision: "checked-1",
    }, 1);
    await db.execute({
      sql: `UPDATE login_app
        SET review_revision = 'edited-2',
            allowed_return_uris = '["https://app.example/edited"]'
        WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });
    assertEquals(
      await saveLoginAppTrustReviewRequestWithClient(client, {
        clientId: ownerInput.clientId,
        ownerDid: ownerInput.appDid,
        notes: "Ready",
        expectedReviewRevision: "checked-1",
        nextReviewRevision: "requested-1",
      }, 2),
      false,
    );

    await db.execute({
      sql: `UPDATE login_app SET review_revision = 'checked-3'
        WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });
    await db.execute(`UPDATE app_listing SET updated_at = 2`);
    assertEquals(
      await saveLoginAppTrustReviewRequestWithClient(client, {
        clientId: ownerInput.clientId,
        ownerDid: ownerInput.appDid,
        notes: "Ready",
        expectedReviewRevision: "checked-3",
        nextReviewRevision: "requested-2",
      }, 3),
      false,
    );

    await db.execute({
      sql: `UPDATE login_app
        SET profile_identity_updated_at = 2, review_revision = 'checked-4'
        WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });
    assertEquals(
      await saveLoginAppTrustReviewRequestWithClient(client, {
        clientId: ownerInput.clientId,
        ownerDid: ownerInput.appDid,
        notes: "Ready",
        expectedReviewRevision: "checked-4",
        nextReviewRevision: "requested-3",
      }, 4),
      true,
    );
    const current = (await db.execute({
      sql: `SELECT review_status, review_notes, review_revision
        FROM login_app WHERE client_id = ?`,
      args: [ownerInput.clientId],
    })).rows[0];
    assertEquals({
      reviewStatus: current.review_status,
      notes: current.review_notes,
      revision: current.review_revision,
    }, {
      reviewStatus: "requested",
      notes: "Ready",
      revision: "requested-3",
    });
  } finally {
    db.close();
  }
});

Deno.test("one unlinked legacy review cannot hide the rest of the review queue", async () => {
  const legacyRow = {
    client_id: "https://legacy.example/client.json",
    app_name: "Legacy snapshot",
    app_uri: "https://legacy.example",
    logo_uri: null,
    allowed_return_uris: '["https://legacy.example/callback"]',
    allowed_origins: "[]",
    status: "unverified",
    contact_did: "did:plc:ambiguous",
    app_did: null,
    app_profile_uri: null,
    link_status: "relink_required",
    profile_identity_fingerprint: null,
    profile_identity_updated_at: null,
    review_revision: null,
    preferred_account_host: null,
    review_status: "requested",
    review_requested_at: 1,
    review_notes: "Please review",
    review_decision_at: null,
    review_decision_by: null,
    review_decision_reason: null,
    created_at: 1,
    updated_at: 1,
  };
  const fixtureRow = {
    ...legacyRow,
    client_id: "https://fixture.example/client.json",
    app_name: "Fixture",
    contact_did: null,
    link_status: "system_fixture",
    review_revision: "fixture-review",
  };
  const rows = await Promise.all([
    hydrateLoginAppTrustReviewRowFailClosed(
      legacyRow,
      () => Promise.reject(new LoginRequestError("ambiguous owner", 409)),
    ),
    hydrateLoginAppTrustReviewRowFailClosed(fixtureRow),
  ]);
  assertEquals(
    rows.map((app) => ({
      clientId: app.clientId,
      identityAvailable: app.identityAvailable,
      reviewStatus: app.reviewStatus,
    })),
    [
      {
        clientId: legacyRow.client_id,
        identityAvailable: false,
        reviewStatus: "requested",
      },
      {
        clientId: fixtureRow.client_id,
        identityAvailable: true,
        reviewStatus: "requested",
      },
    ],
  );
});

Deno.test("environment deletion is owner-only and never deletes system fixtures", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await createLoginAppTable(db);
    const client = db as unknown as DbClient;
    await upsertLoginAppWithClient(client, ownerInput, 1);
    await db.execute({
      sql: `UPDATE login_app SET status = 'blocked' WHERE client_id = ?`,
      args: [ownerInput.clientId],
    });
    for (
      const [clientId, contactDid, appDid, linkStatus] of [
        [
          "https://legacy.example/client.json",
          ownerInput.appDid,
          null,
          "relink_required",
        ],
        [
          "https://fixture.example/client.json",
          ownerInput.appDid,
          null,
          "system_fixture",
        ],
        [
          "https://other.example/client.json",
          ownerInput.appDid,
          "did:plc:other",
          "linked",
        ],
      ] as const
    ) {
      await db.execute({
        sql: `INSERT INTO login_app (
          client_id, app_name, allowed_return_uris, allowed_origins, status,
          contact_did, app_did, link_status, created_at, updated_at
        ) VALUES (?, 'Environment', '[]', '[]', 'unverified', ?, ?, ?, 1, 1)`,
        args: [clientId, contactDid, appDid, linkStatus],
      });
    }

    assertEquals(
      await deleteLoginAppForOwnerWithClient(
        client,
        "did:plc:other",
        ownerInput.clientId,
      ),
      false,
    );
    assertEquals(
      await deleteLoginAppForOwnerWithClient(
        client,
        ownerInput.appDid,
        ownerInput.clientId,
      ),
      true,
    );
    assertEquals(
      await deleteLoginAppForOwnerWithClient(
        client,
        ownerInput.appDid,
        "https://legacy.example/client.json",
      ),
      true,
    );
    assertEquals(
      await deleteLoginAppForOwnerWithClient(
        client,
        ownerInput.appDid,
        "https://fixture.example/client.json",
      ),
      false,
    );
    assertEquals(
      await deleteLoginAppForOwnerWithClient(
        client,
        ownerInput.appDid,
        "https://other.example/client.json",
      ),
      false,
    );

    const remaining = await db.execute(
      `SELECT client_id FROM login_app ORDER BY client_id`,
    );
    assertEquals(
      remaining.rows.map((row) => row.client_id),
      [
        "https://fixture.example/client.json",
        "https://other.example/client.json",
      ],
    );
  } finally {
    db.close();
  }
});
