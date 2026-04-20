FROM denoland/deno:2.1.4

WORKDIR /app

COPY deno.json deno.lock ./
COPY worker ./worker
COPY lib ./lib
COPY i18n ./i18n
COPY utils.ts ./utils.ts
COPY lexicons ./lexicons

RUN deno cache worker/indexer.ts

ENV DENO_ENV=production

CMD ["deno", "run", "-A", "--unstable-fs", "worker/indexer.ts"]
