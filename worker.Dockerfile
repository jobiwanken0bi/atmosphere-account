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

# `deno.json` declares `"nodeModulesDir": "manual"`, so Deno expects an
# actual ./node_modules to exist when resolving npm: specifiers (e.g.
# @libsql/client/web). `deno install` materializes node_modules from the
# lockfile without running lifecycle scripts. We then `deno cache` the
# entrypoint so all JSR/HTTPS imports are pre-fetched into the global
# cache and the container can start fully offline.
RUN deno install && deno cache worker/indexer.ts

ENV DENO_ENV=production

# -A grants the network/env/read perms the indexer needs (WebSocket to
# Jetstream, HTTPS to PDSes, env vars for DB creds, file: DB in dev).
CMD ["deno", "run", "-A", "worker/indexer.ts"]
