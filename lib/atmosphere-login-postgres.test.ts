import { upsertLoginAppWithClient } from "./atmosphere-login.ts";
import {
  closePostgresExecuteClient,
  createPostgresExecuteClient,
} from "./postgres.ts";

const databaseUrl = Deno.env.get("TEST_POSTGRES_DATABASE_URL");
const isCI = Boolean(Deno.env.get("CI"));

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test({
  name:
    "Postgres login environment saves preserve revision, ownership, and trust guards",
  ignore: !databaseUrl && !isCI,
  async fn() {
    if (!databaseUrl) {
      throw new Error("TEST_POSTGRES_DATABASE_URL is required in CI");
    }
    const schema = await Deno.readTextFile(
      new URL("../sql/neon/001_initial.sql", import.meta.url),
    );
    const db = createPostgresExecuteClient(databaseUrl);
    try {
      if (!db.withTransaction) throw new Error("Postgres transaction required");
      await db.withTransaction(async (client) => {
        // Temporary tables stay on this connection and disappear at commit.
        // No persistent app data is read or modified, even with a wrong test URL.
        for (const table of ["login_app", "app_listing"]) {
          const statement = schema.match(
            new RegExp(
              `CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`,
            ),
          )?.[0];
          if (!statement) throw new Error(`Missing baseline table ${table}`);
          await client.execute(
            statement.replace(
              `CREATE TABLE IF NOT EXISTS ${table}`,
              `CREATE TEMP TABLE ${table}`,
            ).replace(/\);$/, ") ON COMMIT DROP;"),
          );
        }
        const now = 1_791_345_600_000;
        const owner = {
          clientId: "https://app.example/client.json",
          appName: "Example App",
          appUri: "https://app.example/",
          allowedReturnUris: ["https://app.example/callback"],
          status: "trusted" as const,
          contactDid: "did:plc:owner",
          appDid: "did:plc:owner",
          appProfileUri: "at://did:plc:owner/app.profile/example",
          linkStatus: "linked" as const,
          profileIdentityFingerprint: "profile-v1",
          profileIdentityUpdatedAt: now,
          environmentRevision: "environment-v1",
          reviewRevision: "review-v1",
        };
        for (
          const [id, did, uri] of [
            ["owner", owner.appDid, owner.appProfileUri],
            [
              "attacker",
              "did:plc:attacker",
              "at://did:plc:attacker/app.profile/example",
            ],
          ]
        ) {
          await client.execute({
            sql: `INSERT INTO app_listing (
              id, slug, name, canonical_source, canonical_uri,
              product_did, updated_at, indexed_at
            ) VALUES (?, ?, ?, 'atstore', ?, ?, ?, ?)`,
            args: [id, id, id, uri, did, now, now],
          });
        }
        const save = (input: Parameters<typeof upsertLoginAppWithClient>[1]) =>
          upsertLoginAppWithClient(client, input, now + 1);
        const read = async () =>
          (await client.execute({
            sql: "SELECT * FROM login_app WHERE client_id = ?",
            args: [owner.clientId],
          })).rows[0];

        // Both null creation and non-null update used to fail at parameter $25.
        assertEquals(await save({ ...owner, insertOnly: true }), true);
        await client.execute(`UPDATE login_app SET review_status = 'approved'`);
        assertEquals(
          await save({
            ...owner,
            expectedEnvironmentRevision: "environment-v1",
            environmentRevision: "unused-noop",
            reviewRevision: "unused-noop",
          }),
          true,
        );
        let row = await read();
        assertEquals([
          row.status,
          row.review_status,
          row.environment_revision,
          row.review_revision,
        ], ["trusted", "approved", "environment-v1", "review-v1"]);

        assertEquals(
          await save({
            ...owner,
            expectedEnvironmentRevision: "environment-v1",
            allowedReturnUris: ["https://app.example/updated"],
            status: "unverified",
            environmentRevision: "environment-v2",
            reviewRevision: "review-v2",
          }),
          true,
        );
        row = await read();
        assertEquals([
          row.status,
          row.review_status,
          row.environment_revision,
          row.review_revision,
        ], ["unverified", "none", "environment-v2", "review-v2"]);
        const saved = JSON.stringify(row);
        assertEquals(
          await save({
            ...owner,
            expectedEnvironmentRevision: "environment-v1",
            environmentRevision: "stale-edit",
          }),
          false,
        );
        assertEquals(await save({ ...owner, insertOnly: true }), false);
        assertEquals(
          await save({
            ...owner,
            contactDid: "did:plc:attacker",
            appDid: "did:plc:attacker",
            appProfileUri: "at://did:plc:attacker/app.profile/example",
            expectedEnvironmentRevision: "environment-v2",
          }),
          false,
        );
        assertEquals(JSON.stringify(await read()), saved);

        await client.execute(`UPDATE login_app SET status = 'blocked'`);
        assertEquals(
          await save({
            ...owner,
            expectedEnvironmentRevision: "environment-v2",
            environmentRevision: "environment-v3",
          }),
          true,
        );
        assertEquals((await read()).status, "blocked");
      });
    } finally {
      await closePostgresExecuteClient(db);
    }
  },
});
