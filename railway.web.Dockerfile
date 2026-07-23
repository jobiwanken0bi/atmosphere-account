# Dockerfile for the Atmosphere Account web app on Railway.
FROM denoland/deno:2.8.3

# Sharp/libvips performs many short-lived native allocations while resizing
# public directory media. Debian's default glibc allocator retains fragmented
# arenas in long-running processes, which makes container RSS climb even after
# the image buffers are released. jemalloc returns those pages predictably.
USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends libjemalloc2 \
  && rm -rf /var/lib/apt/lists/*

ENV LD_PRELOAD=libjemalloc.so.2
ENV MALLOC_CONF=background_thread:true,dirty_decay_ms:1000,muzzy_decay_ms:1000

WORKDIR /app
RUN chown deno:deno /app

COPY --chown=deno:deno deno.json deno.lock ./
COPY --chown=deno:deno . .

USER deno

RUN deno task build

ENV DENO_ENV=production

CMD ["sh", "-c", "deno serve -A --host 0.0.0.0 --port ${PORT:-8000} _fresh/server.js"]
