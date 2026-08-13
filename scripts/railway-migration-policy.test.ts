Deno.test("Railway services use isolated config-as-code rebuild scopes", async () => {
  const root = JSON.parse(await Deno.readTextFile("railway.json"));
  if (root.build?.watchPatterns != null) {
    throw new Error(
      "shared railway.json must not make web and workers rebuild together",
    );
  }

  const services = {
    web: JSON.parse(await Deno.readTextFile("railway.web.json")),
    indexer: JSON.parse(await Deno.readTextFile("railway.indexer.json")),
    inventory: JSON.parse(await Deno.readTextFile("railway.inventory.json")),
  };
  for (const [name, config] of Object.entries(services)) {
    if (config.$schema !== "https://railway.com/railway.schema.json") {
      throw new Error(`${name} must use Railway's published schema`);
    }
    if (config.deploy?.preDeployCommand !== "deno task db:prepare:postgres") {
      throw new Error(
        `${name} must run migration and seed sync as one pre-deploy gate`,
      );
    }
    if (!Array.isArray(config.build?.watchPatterns)) {
      throw new Error(`${name} must define service-specific watch patterns`);
    }
  }

  const webPatterns = services.web.build.watchPatterns as string[];
  const indexerPatterns = services.indexer.build.watchPatterns as string[];
  const inventoryPatterns = services.inventory.build.watchPatterns as string[];
  for (
    const required of ["/client.ts", "/lib/**", "/routes/**", "/static/**"]
  ) {
    if (!webPatterns.includes(required)) {
      throw new Error(`web watch patterns must include ${required}`);
    }
  }
  if (webPatterns.includes("/worker/**")) {
    throw new Error("web must not rebuild for indexer-only changes");
  }
  for (const required of ["/i18n/**", "/lib/**", "/worker/**"]) {
    if (!indexerPatterns.includes(required)) {
      throw new Error(`indexer watch patterns must include ${required}`);
    }
  }
  if (indexerPatterns.includes("/routes/**")) {
    throw new Error("indexer must not rebuild for web-only changes");
  }
  for (
    const required of [
      "/lib/**",
      "/scripts/index-relay-pds-inventory.ts",
    ]
  ) {
    if (!inventoryPatterns.includes(required)) {
      throw new Error(`inventory watch patterns must include ${required}`);
    }
  }
  for (const forbidden of ["/routes/**", "/static/**", "/worker/**"]) {
    if (inventoryPatterns.includes(forbidden)) {
      throw new Error(`inventory must not watch unrelated ${forbidden}`);
    }
  }
});

Deno.test("Railway application images contain and cache the migration inputs", async () => {
  const web = await Deno.readTextFile("railway.web.Dockerfile");
  const indexer = await Deno.readTextFile("railway.indexer.Dockerfile");

  for (const [name, dockerfile] of [["web", web], ["indexer", indexer]]) {
    if (!dockerfile.includes("FROM denoland/deno:2.8.3")) {
      throw new Error(
        `Railway ${name} must use the shared pinned Deno version`,
      );
    }
  }

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
  if (!indexer.includes("COPY i18n ./i18n")) {
    throw new Error(
      "Railway worker image must include the indexer/inventory i18n import",
    );
  }
  for (const [name, dockerfile] of [["web", web], ["indexer", indexer]]) {
    if (!dockerfile.includes("scripts/prepare-postgres-release.ts")) {
      throw new Error(
        `Railway ${name} image must cache the release preparation entrypoint`,
      );
    }
  }
  if (
    web.indexOf("RUN deno install --frozen") >
      web.indexOf("COPY --chown=deno:deno . .")
  ) {
    throw new Error("Railway web dependency layer must precede source copy");
  }
  if (
    indexer.indexOf("RUN deno install --frozen") >
      indexer.indexOf("COPY lib ./lib")
  ) {
    throw new Error(
      "Railway indexer dependency layer must precede source copy",
    );
  }
});

Deno.test("Railway release preparation migrates before syncing curated hosts", async () => {
  const runner = await Deno.readTextFile("scripts/prepare-postgres-release.ts");
  const migration = runner.indexOf("await migratePostgresSchema()");
  const seedSync = runner.indexOf("await syncSeededAccountHosts()");
  if (migration < 0 || seedSync < 0 || migration >= seedSync) {
    throw new Error(
      "release preparation must migrate before syncing curated account hosts",
    );
  }
  if (!runner.includes("postgres_release_prepared")) {
    throw new Error(
      "release preparation must emit structured completion telemetry",
    );
  }
  if (!runner.includes("finally") || !runner.includes("closeReleaseDatabase")) {
    throw new Error(
      "release seed sync must always close its database client",
    );
  }
  const migrationRunner = await Deno.readTextFile(
    "scripts/migrate-postgres.ts",
  );
  if (
    !migrationRunner.includes("finally") ||
    !migrationRunner.includes(".end?.()")
  ) {
    throw new Error(
      "migration must always close its direct Postgres client",
    );
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
