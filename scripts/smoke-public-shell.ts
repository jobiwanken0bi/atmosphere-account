interface Options {
  siteOrigin: string;
  loginOrigin: string;
  requireAppview: boolean;
}

const DEFAULT_SITE_ORIGIN = "https://atmosphereaccount.com";
const DEFAULT_LOGIN_ORIGIN = "https://login.atmosphereaccount.com";

function usage(exitCode = 2): never {
  const write = exitCode === 0 ? console.log : console.error;
  write(
    [
      "Usage: deno task smoke:public-shell [options]",
      "",
      "Checks production public-shell liveness, readiness, OAuth metadata, JWKS,",
      "core HTML pages, and standalone SDK assets.",
      "",
      "Options:",
      "  --site-origin=https://atmosphereaccount.com",
      "  --login-origin=https://login.atmosphereaccount.com",
      "  --no-require-appview  Do not require readiness to report appview.ok.",
    ].join("\n"),
  );
  Deno.exit(exitCode);
}

function readFlag(args: string[], flag: string): string | null {
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function normalizeOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute origin URL`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be an origin without a path`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} must use http or https`);
  }
  return url.origin;
}

function parseOptions(): Options {
  const args = Deno.args.filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) usage(0);
  return {
    siteOrigin: normalizeOrigin(
      readFlag(args, "--site-origin") ??
        Deno.env.get("SMOKE_SITE_ORIGIN") ??
        DEFAULT_SITE_ORIGIN,
      "--site-origin",
    ),
    loginOrigin: normalizeOrigin(
      readFlag(args, "--login-origin") ??
        Deno.env.get("SMOKE_LOGIN_ORIGIN") ??
        DEFAULT_LOGIN_ORIGIN,
      "--login-origin",
    ),
    requireAppview: !args.includes("--no-require-appview"),
  };
}

async function fetchResponse(url: URL): Promise<Response> {
  return await fetch(url, {
    headers: {
      accept: "application/json,text/html,application/javascript,*/*",
      "user-agent": "atmosphere-public-shell-smoke/1.0",
    },
  });
}

async function fetchText(
  url: URL,
): Promise<{ response: Response; text: string }> {
  const response = await fetchResponse(url);
  return { response, text: await response.text() };
}

async function fetchUnknownJson(
  url: URL,
): Promise<{ response: Response; body: unknown }> {
  const { response, text } = await fetchText(url);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return valid JSON`);
  }
  return { response, body };
}

async function fetchJson(
  url: URL,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const { response, body } = await fetchUnknownJson(url);
  return { response, body: assertObject(body, `${url} body`) };
}

function assertStatus(response: Response, url: URL): void {
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
}

function assertContentType(
  response: Response,
  url: URL,
  expected: string,
): void {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes(expected)) {
    throw new Error(
      `${url} returned unexpected content-type ${contentType || "(missing)"}`,
    );
  }
}

function assertEquals(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${actual}`);
  }
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function assertObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function assertContains(text: string, value: string, label: string): void {
  if (!text.includes(value)) throw new Error(`${label} missing ${value}`);
}

async function smokeHtml(
  origin: string,
  path: string,
  expectedText: string,
): Promise<void> {
  const url = new URL(path, origin);
  const { response, text } = await fetchText(url);
  assertStatus(response, url);
  assertContentType(response, url, "html");
  assertContains(text, expectedText, url.toString());
  assertContains(text, "/styles.css", url.toString());
  console.log(`[smoke:public-shell] ok html ${url}`);
}

async function smokeHealth(origin: string): Promise<void> {
  const url = new URL("/api/health", origin);
  const { response, body } = await fetchJson(url);
  assertStatus(response, url);
  assertContentType(response, url, "json");
  assertEquals(body.ok, true, `${url} ok`);
  assertString(body.service, `${url} service`);
  assertString(body.timestamp, `${url} timestamp`);
  console.log(`[smoke:public-shell] ok health ${url}`);
}

async function smokeReadiness(
  origin: string,
  requireAppview: boolean,
): Promise<void> {
  const url = new URL("/api/health/ready", origin);
  const { response, body } = await fetchJson(url);
  assertStatus(response, url);
  assertContentType(response, url, "json");
  assertEquals(body.ok, true, `${url} ok`);
  assertString(body.service, `${url} service`);
  if (requireAppview) {
    const appview = body.appview;
    if (!appview || typeof appview !== "object" || Array.isArray(appview)) {
      throw new Error(`${url} must include appview readiness`);
    }
    assertEquals(
      (appview as Record<string, unknown>).ok,
      true,
      `${url} appview.ok`,
    );
  }
  console.log(`[smoke:public-shell] ok readiness ${url}`);
}

async function smokeOauthMetadata(origin: string): Promise<void> {
  const url = new URL("/oauth/client-metadata.json", origin);
  const { response, body } = await fetchJson(url);
  assertStatus(response, url);
  assertContentType(response, url, "json");
  assertEquals(
    body.client_id,
    new URL("/oauth/client-metadata.json", origin).toString(),
    `${url} client_id`,
  );
  assertEquals(body.application_type, "web", `${url} application_type`);
  assertEquals(
    body.token_endpoint_auth_method,
    "private_key_jwt",
    `${url} auth method`,
  );
  assertEquals(
    body.dpop_bound_access_tokens,
    true,
    `${url} dpop_bound_access_tokens`,
  );
  const redirectUris = assertArray(body.redirect_uris, `${url} redirect_uris`);
  if (!redirectUris.includes(new URL("/oauth/callback", origin).toString())) {
    throw new Error(`${url} missing origin callback redirect_uri`);
  }
  assertEquals(
    body.jwks_uri,
    new URL("/oauth/jwks.json", origin).toString(),
    `${url} jwks_uri`,
  );
  console.log(`[smoke:public-shell] ok oauth metadata ${url}`);
}

async function smokeJwks(origin: string): Promise<void> {
  const url = new URL("/oauth/jwks.json", origin);
  const { response, body } = await fetchJson(url);
  assertStatus(response, url);
  assertContentType(response, url, "json");
  const keys = assertArray(body.keys, `${url} keys`);
  if (keys.length === 0) {
    throw new Error(`${url} must include at least one key`);
  }
  const key = keys[0];
  if (!key || typeof key !== "object" || Array.isArray(key)) {
    throw new Error(`${url} first key must be an object`);
  }
  const record = key as Record<string, unknown>;
  assertString(record.kid, `${url} first key kid`);
  assertEquals(record.kty, "EC", `${url} first key kty`);
  assertEquals(record.crv, "P-256", `${url} first key crv`);
  console.log(`[smoke:public-shell] ok jwks ${url}`);
}

async function smokeSdkAsset(origin: string): Promise<void> {
  const url = new URL("/atmosphere-login.js", origin);
  const { response, text } = await fetchText(url);
  assertStatus(response, url);
  assertContentType(response, url, "javascript");
  assertContains(text, "AtmosphereLogin", url.toString());
  console.log(`[smoke:public-shell] ok sdk ${url}`);
}

function assertAppSection(
  body: Record<string, unknown>,
  section: string,
  url: URL,
): number {
  const items = assertArray(body[section], `${url} ${section}`);
  if (items.length === 0) throw new Error(`${url} ${section} is empty`);
  const first = assertObject(items[0], `${url} ${section}[0]`);
  assertString(first.slug, `${url} ${section}[0].slug`);
  assertString(first.name, `${url} ${section}[0].name`);
  return items.length;
}

async function smokeAppviewData(origin: string): Promise<void> {
  const appsUrl = new URL("/api/appview/apps/home", origin);
  const { response: appsResponse, body: appsBody } = await fetchJson(appsUrl);
  assertStatus(appsResponse, appsUrl);
  assertContentType(appsResponse, appsUrl, "json");
  const featuredCount = assertAppSection(appsBody, "featured", appsUrl);
  const trendingCount = assertAppSection(appsBody, "trending", appsUrl);
  const freshCount = assertAppSection(appsBody, "fresh", appsUrl);

  const hostsUrl = new URL("/api/appview/hosts", origin);
  const { response: hostsResponse, body: hostsBody } = await fetchUnknownJson(
    hostsUrl,
  );
  assertStatus(hostsResponse, hostsUrl);
  assertContentType(hostsResponse, hostsUrl, "json");
  const hosts = assertArray(hostsBody, `${hostsUrl} hosts`);
  if (hosts.length === 0) throw new Error(`${hostsUrl} returned no hosts`);
  const hostRecords = hosts.map((host, index) =>
    assertObject(host, `${hostsUrl} host[${index}]`)
  );
  if (!hostRecords.some((host) => host.host === "bsky.network")) {
    throw new Error(`${hostsUrl} missing bsky.network host`);
  }
  const firstHost = hostRecords[0];
  assertString(firstHost.host, `${hostsUrl} host[0].host`);
  assertString(firstHost.displayName, `${hostsUrl} host[0].displayName`);

  console.log(
    `[smoke:public-shell] ok appview data apps featured=${featuredCount} trending=${trendingCount} fresh=${freshCount} hosts=${hosts.length}`,
  );
}

const options = parseOptions();
console.log(
  `[smoke:public-shell] site=${options.siteOrigin} login=${options.loginOrigin}`,
);

await smokeHealth(options.siteOrigin);
await smokeReadiness(options.siteOrigin, options.requireAppview);
await smokeAppviewData(options.siteOrigin);
await smokeHtml(options.siteOrigin, "/", "Atmosphere Account");
await smokeHtml(
  options.siteOrigin,
  "/docs/atmosphere-login",
  "Atmosphere Login",
);

for (const origin of [options.siteOrigin, options.loginOrigin]) {
  await smokeOauthMetadata(origin);
  await smokeJwks(origin);
  await smokeSdkAsset(origin);
}
