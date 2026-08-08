# Dockerfile for the Atmosphere Account Jetstream indexer on Railway.
FROM denoland/deno:2.7.12

WORKDIR /app

COPY deno.json deno.lock ./
COPY lib ./lib
COPY lexicons ./lexicons
COPY scripts ./scripts
COPY worker ./worker
COPY utils.ts ./utils.ts

RUN deno install --frozen \
  && deno cache --node-modules-dir=auto worker/indexer.ts scripts/migrate-db.ts

ENV DENO_ENV=production

CMD ["deno", "run", "--cached-only", "--frozen", "--no-prompt", "--allow-read=/app", "--allow-net", "--allow-env", "--allow-sys", "--allow-ffi=/app/node_modules", "--node-modules-dir=auto", "worker/indexer.ts"]
