import {
  appviewFetchTimeoutMs,
  appviewProxyRequestBodyForTest,
  appviewRequestHeadersForTest,
  isGeneratedAppviewAssetPathForTest,
  proxiedHeadersForTest,
  shouldBufferAppviewRequestBodyForTest,
  shouldProxyAppviewAssetForTest,
  shouldProxyAppviewBeforeSession,
} from "./appview-client.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("early appview proxy covers DB-backed app surfaces before session hydration", () => {
  for (
    const path of [
      "/apps/grain",
      "/apps/create",
      "/hosts/bsky.network",
      "/hosts/register",
      "/account",
      "/account/reviews",
      "/admin/app-directory",
      "/users/joebasser.com",
      "/login/select",
      "/oauth/add-account",
      "/oauth/callback",
      "/oauth/forget",
      "/oauth/login",
      "/oauth/logout",
      "/oauth/switch",
    ]
  ) {
    assertEquals(shouldProxyAppviewBeforeSession(path), true);
  }
});

Deno.test("early appview proxy keeps only public OAuth documents on the Deno edge", () => {
  for (
    const path of [
      "/oauth/client-metadata.json",
      "/oauth/jwks.json",
    ]
  ) {
    assertEquals(shouldProxyAppviewBeforeSession(path), false);
  }

  for (
    const path of [
      "/oauth/add-account",
      "/oauth/callback",
      "/oauth/forget",
      "/oauth/login",
      "/oauth/logout",
      "/oauth/switch",
    ]
  ) {
    assertEquals(shouldProxyAppviewBeforeSession(path), true);
  }
});

Deno.test("public directory shell pages render on the Deno edge", () => {
  for (
    const path of [
      "/apps",
      "/apps/all",
      "/apps/categories",
      "/hosts",
    ]
  ) {
    assertEquals(shouldProxyAppviewBeforeSession(path), false);
  }
});

Deno.test("early appview proxy covers DB-backed APIs before session hydration", () => {
  for (
    const path of [
      "/api/apps/grain/favorite",
      "/api/hosts/location/infer",
      "/api/account/profile",
      "/api/admin/app-directory/rescore",
      "/api/login/selection",
      "/api/registry/profile",
      "/api/appview/apps/home",
      "/api/atproto/blob",
      "/api/identity/preview",
      "/api/me/avatar",
    ]
  ) {
    assertEquals(shouldProxyAppviewBeforeSession(path), true);
  }
});

Deno.test("early appview proxy leaves static, docs, and health routes on the Deno shell", () => {
  for (
    const path of [
      "/",
      "/docs",
      "/docs/atmosphere-login",
      "/signin",
      "/api/health/ready",
      "/oauth/client-metadata.json",
      "/oauth/jwks.json",
      "/assets/client-entry.js",
      "/atmosphere-login.js",
      "/.well-known/atproto-did",
    ]
  ) {
    assertEquals(shouldProxyAppviewBeforeSession(path), false);
  }
});

Deno.test("generated assets can be proxied from the appview bundle", () => {
  assertEquals(
    isGeneratedAppviewAssetPathForTest("/assets/client-entry.js"),
    true,
  );
  assertEquals(
    isGeneratedAppviewAssetPathForTest(
      "/assets/fresh-island__SignInForm-B3cwBuRQ.js",
    ),
    true,
  );
  assertEquals(isGeneratedAppviewAssetPathForTest("/styles.css"), false);
  assertEquals(
    isGeneratedAppviewAssetPathForTest("/atmosphere-login.js"),
    false,
  );
});

Deno.test("appview asset proxy is limited to trusted Atmosphere origins", () => {
  const trustedOrigins = [
    "https://atmosphereaccount.com",
    "https://login.atmosphereaccount.com",
  ];
  assertEquals(
    shouldProxyAppviewAssetForTest(
      new URL("https://atmosphereaccount.com/assets/client-entry.js"),
      trustedOrigins,
    ),
    true,
  );
  assertEquals(
    shouldProxyAppviewAssetForTest(
      new URL("https://login.atmosphereaccount.com/assets/client-entry.js"),
      trustedOrigins,
    ),
    true,
  );
  assertEquals(
    shouldProxyAppviewAssetForTest(
      new URL("https://example.com/assets/client-entry.js"),
      trustedOrigins,
    ),
    false,
  );
  assertEquals(
    shouldProxyAppviewAssetForTest(
      new URL("https://atmosphereaccount.com/styles.css"),
      trustedOrigins,
    ),
    false,
  );
});

Deno.test("appview fetch timeout defaults to a short public-shell budget", () => {
  assertEquals(appviewFetchTimeoutMs(null), 5000);
  assertEquals(appviewFetchTimeoutMs(""), 5000);
  assertEquals(appviewFetchTimeoutMs("not-a-number"), 5000);
  assertEquals(appviewFetchTimeoutMs("250"), 1000);
  assertEquals(appviewFetchTimeoutMs("15000"), 15000);
});

Deno.test("proxied appview response headers strip transport metadata but keep cookies", () => {
  const source = new Headers({
    "alt-svc": 'h3=":443"',
    "cache-control": "no-store",
    "connection": "keep-alive",
    "content-encoding": "gzip",
    "content-length": "123",
    "content-type": "text/html; charset=utf-8",
    "etag": '"abc"',
    "server": "railway-hikari",
    "transfer-encoding": "chunked",
    "x-hikari-trace": "ord1.test",
    "x-railway-edge": "ord1",
    "x-railway-request-id": "request-id",
  });
  source.append("set-cookie", "atmo_sid=one; Path=/; HttpOnly");
  source.append("set-cookie", "atmo_remembered_accounts=two; Path=/; HttpOnly");

  const headers = proxiedHeadersForTest(source, { page: true });

  assertEquals(headers.get("cache-control"), "no-store");
  assertEquals(headers.get("content-type"), "text/html; charset=utf-8");
  assertEquals(headers.get("x-atmosphere-appview-proxy"), "1");
  assertEquals(headers.get("x-atmosphere-appview-page-proxy"), "1");
  assertEquals(headers.has("alt-svc"), false);
  assertEquals(headers.has("connection"), false);
  assertEquals(headers.has("content-encoding"), false);
  assertEquals(headers.has("content-length"), false);
  assertEquals(headers.has("etag"), false);
  assertEquals(headers.has("server"), false);
  assertEquals(headers.has("transfer-encoding"), false);
  assertEquals(headers.has("x-hikari-trace"), false);
  assertEquals(headers.has("x-railway-edge"), false);
  assertEquals(headers.has("x-railway-request-id"), false);
  assertEquals(headers.getSetCookie().length, 2);
});

Deno.test("appview request headers preserve browser CSRF context and overwrite proxy-owned headers", async () => {
  const input = new Headers({
    accept: "text/html",
    "accept-language": "en-US",
    authorization: "Bearer should-not-forward",
    cookie: "atmo_sid=session",
    "content-type": "application/json",
    origin: "https://atmosphereaccount.com",
    referer: "https://atmosphereaccount.com/account",
    "sec-fetch-site": "same-origin",
    "user-agent": "test-agent",
    "x-atmosphere-login": "1",
    "x-atmosphere-login-bodyless": "1",
    "x-atmosphere-client-key": "attacker-controlled",
    "x-atmosphere-public-origin": "https://evil.example",
    "x-forwarded-host": "evil.example",
    "x-forwarded-proto": "http",
  });

  const headers = await appviewRequestHeadersForTest(
    input,
    new URL("https://atmosphereaccount.com/account"),
  );

  assertEquals(headers.get("accept"), "text/html");
  assertEquals(headers.get("accept-language"), "en-US");
  assertEquals(headers.get("authorization"), null);
  assertEquals(headers.get("cookie"), "atmo_sid=session");
  assertEquals(headers.get("content-type"), "application/json");
  assertEquals(headers.get("origin"), "https://atmosphereaccount.com");
  assertEquals(headers.get("referer"), "https://atmosphereaccount.com/account");
  assertEquals(headers.get("sec-fetch-site"), "same-origin");
  assertEquals(headers.get("user-agent"), "test-agent");
  assertEquals(headers.get("x-atmosphere-login"), "1");
  assertEquals(headers.get("x-atmosphere-login-bodyless"), "1");
  assertEquals(
    headers.get("x-atmosphere-client-key") === "attacker-controlled",
    false,
  );
  assertEquals(headers.get("x-forwarded-host"), "atmosphereaccount.com");
  assertEquals(headers.get("x-forwarded-proto"), "https");
  assertEquals(
    headers.get("x-atmosphere-public-origin"),
    "https://atmosphereaccount.com",
  );
});

Deno.test("account handoff forms are buffered before crossing the appview proxy", async () => {
  assertEquals(shouldBufferAppviewRequestBodyForTest("/login/select"), true);
  assertEquals(shouldBufferAppviewRequestBodyForTest("/oauth/switch"), true);
  assertEquals(shouldBufferAppviewRequestBodyForTest("/apps/create"), false);

  const request = new Request(
    "https://login.atmosphereaccount.com/login/select",
    {
      method: "POST",
      body: "did=did%3Aplc%3Atest&handoff=browser",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    },
  );
  const body = await appviewProxyRequestBodyForTest(
    new URL(request.url),
    request,
  );
  assertEquals(body instanceof Uint8Array, true);
  assertEquals(
    new TextDecoder().decode(body as Uint8Array),
    "did=did%3Aplc%3Atest&handoff=browser",
  );
});

Deno.test("marked bodyless handoffs never read an incoming request stream", async () => {
  const neverFinishes = new ReadableStream<Uint8Array>({
    start() {},
  });
  const request = new Request(
    "https://login.atmosphereaccount.com/login/select?did=did%3Aplc%3Atest",
    {
      method: "POST",
      body: neverFinishes,
      headers: { "x-atmosphere-login-bodyless": "1" },
    },
  );
  const body = await appviewProxyRequestBodyForTest(
    new URL(request.url),
    request,
  );
  assertEquals(body, undefined);
  await neverFinishes.cancel();
});

Deno.test("account handoff proxy rejects oversized streamed bodies", async () => {
  const request = new Request("https://atmosphereaccount.com/oauth/switch", {
    method: "POST",
    body: "x".repeat(64 * 1024 + 1),
  });
  let rejected = false;
  try {
    await appviewProxyRequestBodyForTest(new URL(request.url), request);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
});
