function assertIncludes(
  source: string,
  expected: string,
  message: string,
): void {
  if (!source.includes(expected)) throw new Error(message);
}

function assertCachedOnlyCommand(
  source: string,
  entrypoint: string,
  label: string,
): void {
  for (
    const required of [
      "deno",
      "run",
      "--cached-only",
      "--frozen",
      "--no-prompt",
      "--node-modules-dir=auto",
      entrypoint,
    ]
  ) {
    assertIncludes(
      source,
      required,
      `${label} must include ${required}`,
    );
  }
}

Deno.test("Fly rollback image matches the supported indexer runtime graph", async () => {
  const dockerfile = await Deno.readTextFile("worker.Dockerfile");
  const imageCommand = dockerfile.split("\n").find((line) =>
    line.startsWith("CMD ")
  );
  if (!imageCommand) throw new Error("Fly rollback image must define CMD");

  assertIncludes(
    dockerfile,
    "FROM denoland/deno:2.8.3",
    "Fly rollback image must use the shared pinned Deno version",
  );
  for (
    const source of [
      "COPY lib ./lib",
      "COPY i18n ./i18n",
      "COPY lexicons ./lexicons",
      "COPY scripts ./scripts",
      "COPY worker ./worker",
      "COPY utils.ts ./utils.ts",
    ]
  ) {
    assertIncludes(
      dockerfile,
      source,
      `Fly rollback image is missing runtime input: ${source}`,
    );
  }

  assertIncludes(
    dockerfile,
    "deno cache --frozen --node-modules-dir=auto",
    "Fly rollback build must freeze and cache the dependency graph",
  );
  for (const entrypoint of ["worker/indexer.ts", "scripts/migrate-db.ts"]) {
    assertIncludes(
      dockerfile,
      entrypoint,
      `Fly rollback build must cache ${entrypoint}`,
    );
  }
  assertCachedOnlyCommand(
    imageCommand,
    "worker/indexer.ts",
    "Fly rollback image command",
  );
});

Deno.test("Fly rollback release and worker commands stay offline-compatible", async () => {
  const dockerfile = await Deno.readTextFile("worker.Dockerfile");
  const flyConfig = await Deno.readTextFile("fly.indexer.toml");
  const releaseCommand = flyConfig.split("\n").find((line) =>
    line.startsWith("release_command = ")
  );
  const workerCommand = flyConfig.split("\n").find((line) =>
    line.startsWith("worker = ")
  );
  if (!releaseCommand || !workerCommand) {
    throw new Error(
      "Fly rollback config must define release and worker commands",
    );
  }

  assertIncludes(
    flyConfig,
    "dockerfile = 'worker.Dockerfile'",
    "Fly rollback config must build the rollback Dockerfile",
  );
  assertCachedOnlyCommand(
    releaseCommand,
    "scripts/migrate-db.ts",
    "Fly rollback release command",
  );
  assertCachedOnlyCommand(
    workerCommand,
    "worker/indexer.ts",
    "Fly rollback worker command",
  );

  const cacheStep = dockerfile.match(/RUN deno install[\s\S]*?\n\nENV/)?.[0];
  if (!cacheStep) {
    throw new Error("Fly rollback image must define its dependency cache step");
  }
  for (const entrypoint of ["scripts/migrate-db.ts", "worker/indexer.ts"]) {
    assertIncludes(
      cacheStep,
      entrypoint,
      `cached-only Fly command is not backed by a build cache entry for ${entrypoint}`,
    );
  }
});
