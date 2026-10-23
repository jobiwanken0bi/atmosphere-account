import {
  extractHtmlAssetPaths,
  extractJsImports,
} from "./smoke-picker-assets.ts";

// Explicit origins prevent this rehearsal from silently exercising production.
function option(name: string): string {
  const value = Deno.args.find((arg) => arg.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!value) throw new Error(`Required option: ${name}=...`);
  return value;
}

function rehearsalOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash ||
    url.hostname === "atmosphereaccount.com" ||
    url.hostname.endsWith(".atmosphereaccount.com")
  ) {
    throw new Error(
      "Use an HTTPS staging origin without a path or credentials",
    );
  }
  return url.origin;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function request(origin: string, path: string, init?: RequestInit) {
  return await fetch(new URL(path, origin), {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
}

async function json(origin: string, path: string) {
  const response = await request(origin, path);
  assert(response.status === 200, `${origin}${path}: HTTP ${response.status}`);
  assert(
    response.headers.get("content-type")?.includes("application/json"),
    `${origin}${path}: expected JSON`,
  );
  return await response.json();
}

async function main() {
  const site = rehearsalOrigin(option("--site-origin"));
  const login = rehearsalOrigin(option("--login-origin"));
  const release = option("--expected-release-id");
  const loginRelease =
    Deno.args.find((arg) => arg.startsWith("--expected-login-release-id="))
      ?.slice("--expected-login-release-id=".length) ?? release;
  const artifact = Deno.args.find((arg) =>
    arg.startsWith("--expected-artifact-digest=")
  )?.slice("--expected-artifact-digest=".length);
  assert(site !== login, "Rehearse with separate site and login origins");
  const expectedHost = Deno.args.find((arg) =>
    arg.startsWith("--expected-host=")
  )
    ?.slice("--expected-host=".length);
  let jwksFingerprint: string | undefined;
  const warnings: string[] = [];

  for (const origin of [site, login]) {
    const health = await json(origin, "/api/health");
    const ready = await json(origin, "/api/health/ready");
    for (const body of [health, ready]) {
      assert(body.ok === true, `${origin}: health failed`);
      assert(body.release?.runtime === "railway", `${origin}: wrong runtime`);
      assert(
        body.release?.deploymentId ===
          (origin === login ? loginRelease : release),
        `${origin}: wrong rehearsal release`,
      );
    }
    if (artifact) {
      assert(
        health.release?.artifactDigest === artifact &&
          ready.release?.artifactDigest === artifact,
        `${origin}: wrong artifact digest`,
      );
    }
    assert(ready.database?.ok === true, `${origin}: database unavailable`);
    assert(
      ready.database?.backend === "postgres",
      `${origin}: expected isolated Postgres`,
    );
    assert(!ready.appview, `${origin}: unexpected appview proxy`);
    const preview = await json(origin, "/api/identity/preview?handle=");
    assert(
      preview.found === false,
      `${origin}: invalid handle preview response`,
    );
    if (ready.degraded || !ready.indexer?.fresh) {
      warnings.push(`${origin}: inventory/indexer freshness is not rehearsed`);
    }

    const metadata = await json(origin, "/oauth/client-metadata.json");
    assert(
      metadata.client_id === `${origin}/oauth/client-metadata.json` &&
        metadata.redirect_uris?.length === 1 &&
        metadata.redirect_uris[0] === `${origin}/oauth/callback` &&
        metadata.jwks_uri === `${origin}/oauth/jwks.json`,
      `${origin}: OAuth metadata escapes the staging origin`,
    );
    const jwks = await json(origin, "/oauth/jwks.json");
    assert(jwks.keys?.length === 1, `${origin}: expected one signing key`);
    assert(!("d" in jwks.keys[0]), `${origin}: JWKS exposes a private key`);
    const fingerprint = JSON.stringify(jwks);
    if (jwksFingerprint) {
      assert(fingerprint === jwksFingerprint, "Site and login keys differ");
    }
    jwksFingerprint = fingerprint;

    const hosts = await json(origin, "/api/login/account-hosts?q=Harbor");
    assert(Array.isArray(hosts.hosts), `${origin}: host search unavailable`);
    if (expectedHost) {
      assert(
        hosts.hosts.some((host: { host: string }) =>
          host.host === expectedHost
        ),
        `${origin}: expected synthetic host fixture missing`,
      );
    }

    const page = await request(origin, "/signin?mode=create", {
      headers: { accept: "text/html", "sec-fetch-dest": "document" },
    });
    const html = await page.text();
    assert(page.status === 200, `${origin}: create account page failed`);
    assert(
      html.includes("signin-host-info-button"),
      `${origin}: missing info UI`,
    );
    const assets = extractHtmlAssetPaths(html);
    assert(
      assets.generatedAssets.length > 0,
      `${origin}: missing island assets`,
    );
    for (const path of assets.stylesheets) {
      const response = await request(origin, path);
      assert(
        response.status === 200 &&
          response.headers.get("content-type")?.includes("css"),
        `${origin}${path}: stylesheet unavailable`,
      );
      await response.body?.cancel();
    }
    const queue = [...assets.generatedAssets];
    const seen = new Set<string>();
    while (queue.length) {
      const path = queue.shift()!;
      if (seen.has(path)) continue;
      seen.add(path);
      const response = await request(origin, path);
      assert(
        response.status === 200 &&
          response.headers.get("content-type")?.includes("javascript"),
        `${origin}${path}: island asset unavailable`,
      );
      queue.push(
        ...extractJsImports(await response.text(), new URL(path, origin)),
      );
    }
    const rejected = await request(origin, "/oauth/login", {
      method: "POST",
      headers: { origin: "https://untrusted.example" },
      body: "",
    });
    assert(
      rejected.status === 403,
      `${origin}: cross-origin POST was not rejected`,
    );
    await rejected.body?.cancel();
    console.log(
      `[cutover] ${origin}: health, OAuth, host search, ${seen.size} island assets, CSRF passed`,
    );
  }

  const picker = await request(site, "/login/select?state=cutover-rehearsal");
  assert(
    picker.status === 308 &&
      picker.headers.get("location") ===
        `${login}/login/select?state=cutover-rehearsal`,
    "Site must redirect the picker to the staging login origin",
  );
  await picker.body?.cancel();
  const account = await request(login, "/account");
  assert(
    account.status === 302 &&
      account.headers.get("location") === `${site}/account`,
    "Login origin must route account management to the staging site",
  );
  await account.body?.cancel();
  for (const warning of warnings) console.warn(`[cutover] ${warning}`);
  console.log(
    `[cutover] passed release=${release}; full external OAuth and DNS cutover remain separate checks`,
  );
}

if (import.meta.main) await main();
