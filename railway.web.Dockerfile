# Dockerfile for the Atmosphere Account web app on Railway.
FROM denoland/deno:2.7.12

WORKDIR /app

COPY deno.json deno.lock ./
COPY . .

RUN deno task build

ENV DENO_ENV=production

CMD ["sh", "-c", "deno serve -A --host 0.0.0.0 --port ${PORT:-8000} _fresh/server.js"]
