# Dockerfile for the Atmosphere Account Jetstream indexer on Railway.
FROM denoland/deno:2.8.3

WORKDIR /app

COPY deno.json deno.lock ./
RUN deno install --frozen

COPY lib ./lib
COPY i18n ./i18n
COPY lexicons ./lexicons
COPY scripts ./scripts
COPY sql ./sql
COPY worker ./worker
COPY utils.ts ./utils.ts

RUN deno cache --frozen --node-modules-dir=auto \
  worker/indexer.ts \
  scripts/migrate-db.ts \
  scripts/prepare-postgres-release.ts

ENV DENO_ENV=production

CMD ["deno", "run", "--cached-only", "--frozen", "--no-prompt", "--allow-read=/app", "--allow-net", "--allow-env", "--allow-sys", "--allow-ffi=/app/node_modules", "--node-modules-dir=auto", "worker/indexer.ts"]
