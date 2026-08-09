Deno.test("Railway deploys migrate before starting either application service", async () => {
  const config = JSON.parse(await Deno.readTextFile("railway.json"));
  if (config.$schema !== "https://railway.com/railway.schema.json") {
    throw new Error("railway.json must use Railway's published schema");
  }
  if (config.deploy?.preDeployCommand !== "deno task db:migrate:postgres") {
    throw new Error(
      "Railway must run the Postgres migration as a blocking pre-deploy command",
    );
  }
});

Deno.test("Railway application images contain and cache the migration inputs", async () => {
  const web = await Deno.readTextFile("railway.web.Dockerfile");
  const indexer = await Deno.readTextFile("railway.indexer.Dockerfile");

  if (!/COPY\s+--chown=deno:deno\s+\.\s+\./.test(web)) {
    throw new Error(
      "Railway web image must include the repository migration files",
    );
  }
  for (const source of ["COPY scripts ./scripts", "COPY sql ./sql"]) {
    if (!indexer.includes(source)) {
      throw new Error(
        `Railway indexer image is missing migration input: ${source}`,
      );
    }
  }
  for (const [name, dockerfile] of [["web", web], ["indexer", indexer]]) {
    if (!dockerfile.includes("scripts/migrate-postgres.ts")) {
      throw new Error(
        `Railway ${name} image must cache the Postgres migration entrypoint`,
      );
    }
  }
});

Deno.test("Railway Postgres runner serializes concurrent service migrations", async () => {
  const runner = await Deno.readTextFile("scripts/migrate-postgres.ts");
  if (
    !runner.includes('from "../lib/postgres-migration.ts"') ||
    !runner.includes("withPostgresSchemaMigrationLock(schema)")
  ) {
    throw new Error(
      "Postgres migration runner must inject the transaction advisory lock",
    );
  }
});
