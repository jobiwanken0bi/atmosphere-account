# One-release rollback image for the Atmosphere registry indexer worker.
#
# Build context MUST be the project root, because we COPY whole top-level
# folders (worker/, lib/, i18n/, lexicons/) into the image. Fly's `flyctl deploy`
# uses the directory containing the fly config as the context — so this
# file lives at the project root, paired with fly.indexer.toml.
# Keep this pin aligned with CI and the Railway images so the same lockfile and
# dependency graph are exercised on the rollback path.
FROM denoland/deno:2.8.3

WORKDIR /app

# Bring in just enough of the project to run worker/indexer.ts.
COPY deno.json deno.lock ./
COPY lib ./lib
COPY i18n ./i18n
COPY lexicons ./lexicons
COPY scripts ./scripts
COPY worker ./worker
COPY utils.ts ./utils.ts

# `deno.json` declares `"nodeModulesDir": "manual"` (which assumes a
# package.json + npm/pnpm install workflow). The indexer doesn't ship a
# package.json — we lay down npm packages straight from deno.json's
# `imports` map by passing `--node-modules-dir=auto` to every Deno
# command. That overrides the project setting for the duration of the
# command and lets Deno create + populate ./node_modules itself.
#
# Same flag at build time (cache) and runtime (run); without it at
# runtime, Deno re-checks `nodeModulesDir: manual` and refuses to use
# the node_modules we just created.
RUN deno install --frozen \
  && deno cache --frozen --node-modules-dir=auto \
    worker/indexer.ts \
    scripts/migrate-db.ts

ENV DENO_ENV=production

# The hosted worker needs network, environment, source reads, OS metadata, and
# the native database/image modules. It does not need subprocess or filesystem
# write access. Cached-only startup prevents dependency downloads at runtime.
CMD ["deno", "run", "--cached-only", "--frozen", "--no-prompt", "--allow-read=/app", "--allow-net", "--allow-env", "--allow-sys", "--allow-ffi=/app/node_modules", "--node-modules-dir=auto", "worker/indexer.ts"]
