# Dockerfile for the Atmosphere Account Jetstream indexer on Railway.
FROM denoland/deno:2.7.12

WORKDIR /app

COPY deno.json deno.lock ./
COPY lib ./lib
COPY lexicons ./lexicons
COPY scripts ./scripts
COPY worker ./worker
COPY utils.ts ./utils.ts

RUN deno cache --node-modules-dir=auto worker/indexer.ts scripts/migrate-db.ts

ENV DENO_ENV=production

CMD ["deno", "run", "-A", "--node-modules-dir=auto", "worker/indexer.ts"]
