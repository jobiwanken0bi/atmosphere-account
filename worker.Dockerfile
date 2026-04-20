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

# Resolve and cache all transitive imports at build time so the container
# starts cold quickly and doesn't try to pull from JSR/NPM at runtime.
RUN deno cache worker/indexer.ts

ENV DENO_ENV=production

# -A grants the network/env/read perms the indexer needs (WebSocket to
# Jetstream, HTTPS to PDSes, env vars for DB creds, file: DB in dev).
CMD ["deno", "run", "-A", "worker/indexer.ts"]
