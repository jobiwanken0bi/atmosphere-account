import {
  appviewFetchTimeoutMs,
  appviewRequestHeadersForTest,
  isGeneratedAppviewAssetPathForTest,
  proxiedHeadersForTest,
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
      "/oauth/callback",
      "/oauth/login",
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
      "/api/login/selection",
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

Deno.test("appview request headers preserve browser CSRF context and overwrite proxy-owned headers", () => {
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
    "x-atmosphere-public-origin": "https://evil.example",
    "x-forwarded-host": "evil.example",
    "x-forwarded-proto": "http",
  });

  const headers = appviewRequestHeadersForTest(
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
  assertEquals(headers.get("x-forwarded-host"), "atmosphereaccount.com");
  assertEquals(headers.get("x-forwarded-proto"), "https");
  assertEquals(
    headers.get("x-atmosphere-public-origin"),
    "https://atmosphereaccount.com",
  );
});
