/**
 * Seed Atmosphere Account production secrets into the Railway project.
 *
 * This intentionally runs from the operator's machine, not from Codex, because
 * it copies local `.env` secrets to Railway.
 *
 * Usage:
 *   deno run -A scripts/seed-railway-secrets.ts
 */

const project = Deno.env.get("RAILWAY_PROJECT_ID") ??
  "f6fc622b-1fff-469e-9bb2-42210ac4a70c";
const environment = Deno.env.get("RAILWAY_ENVIRONMENT") ?? "production";

const envText = await Deno.readTextFile(".env");
const local = new Map<string, string>();

for (const line of envText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  local.set(key, value);
}

function read(key: string): string | null {
  const value = local.get(key);
  return value && value.length > 0 ? value : null;
}

function entriesFor(keys: string[]): string[] {
  const entries: string[] = [];
  for (const key of keys) {
    const value = read(key);
    if (value) entries.push(`${key}=${value}`);
  }
  return entries;
}

async function setVars(service: "web" | "indexer", entries: string[]) {
  if (entries.length === 0) return;
  const command = new Deno.Command("railway", {
    args: [
      "variable",
      "set",
      ...entries,
      "--service",
      service,
      "--project",
      project,
      "--environment",
      environment,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const stderr = new TextDecoder().decode(output.stderr);
  if (!output.success) {
    throw new Error(`${service} variable set failed: ${stderr}`);
  }
  console.log(`${service}: set ${entries.length} variables`);
}

await setVars("web", [
  "DENO_ENV=production",
  "FRESH_PUBLIC_SITE_URL=https://atmosphereaccount.com",
  "JETSTREAM_URL=wss://jetstream2.us-east.bsky.network/subscribe",
  "ATPROTO_FETCH_TIMEOUT_MS=10000",
  "COMMUNITY_APP_LEXICON_ENABLED=false",
  ...entriesFor([
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "ATMOSPHERE_DID",
    "ADMIN_DIDS",
    "REPORT_IP_SECRET",
    "OAUTH_PRIVATE_JWK",
    "OAUTH_PUBLIC_JWK",
    "OAUTH_KID",
    "SESSION_SECRET",
    "ATSTORE_REPO_DID",
    "ATSTORE_SOCIAL_REPO_DIDS",
  ]),
]);

await setVars("indexer", [
  "DENO_ENV=production",
  "JETSTREAM_URL=wss://jetstream2.us-east.bsky.network/subscribe",
  "ATPROTO_FETCH_TIMEOUT_MS=10000",
  "COMMUNITY_APP_LEXICON_ENABLED=false",
  ...entriesFor([
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "ATMOSPHERE_DID",
    "ATSTORE_REPO_DID",
    "ATSTORE_SOCIAL_REPO_DIDS",
  ]),
]);
