# Dockerfile for the Atmosphere registry indexer worker.
#
# Build context MUST be the project root, because we COPY whole top-level
# folders (worker/, lib/, lexicons/) into the image. Fly's `flyctl deploy`
# uses the directory containing the fly config as the context — so this
# file lives at the project root, paired with fly.indexer.toml.
# Pinned to match the local Deno (2.7.x) that generated deno.lock — the
# lockfile format moves forward with each minor and older runtimes
# (e.g. 2.1.x) refuse to read newer versions.
FROM denoland/deno:2.7.12

WORKDIR /app

# Bring in just enough of the project to run worker/indexer.ts.
COPY deno.json deno.lock ./
COPY worker ./worker
COPY lib ./lib
COPY lexicons ./lexicons
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
RUN deno cache --node-modules-dir=auto worker/indexer.ts

ENV DENO_ENV=production

# -A grants the network/env/read perms the indexer needs (WebSocket to
# Jetstream, HTTPS to PDSes, env vars for DB creds, file: DB in dev).
CMD ["deno", "run", "-A", "--node-modules-dir=auto", "worker/indexer.ts"]
