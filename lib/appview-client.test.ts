import {
  appviewAssetSourceUrlForTest,
  appviewFetchTimeoutMs,
  appviewJsonHeadersForTest,
  appviewProxyRequestBodyForTest,
  appviewRequestHeadersForTest,
  hostDirectoryResultForHosts,
  isGeneratedAppviewAssetPathForTest,
  proxiedHeadersForTest,
  rewriteAppviewHtmlForTest,
  seededHostDetailFallback,
  shouldBufferAppviewRequestBodyForTest,
  shouldProxyAppviewAssetForTest,
  shouldProxyAppviewBeforeSession,
} from "./appview-client.ts";
import { readProxyClientKey } from "./proxy-client-key.ts";
import {
  DEFAULT_ACCOUNT_HOST_SORT,
  listSeededAccountHostFallback,
} from "./account-hosts.ts";

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

Deno.test("legacy host arrays are normalized for paginated rolling deploys", () => {
  const hosts = listSeededAccountHostFallback().slice(0, 3).map(
    (host, index) => ({
      ...host,
      observedAccountCount: index + 1,
    }),
  );
  const result = hostDirectoryResultForHosts(
    { sort: "accounts", page: 2, pageSize: 2 },
    hosts,
  );
  assertEquals(result.total, 3);
  assertEquals(result.page, 2);
  assertEquals(result.hosts.length, 1);
  assertEquals(result.hosts[0]?.observedAccountCount, 1);
});

Deno.test("legacy host arrays prioritize account totals in the default sort", () => {
  const [claimedHost, observedHost] = listSeededAccountHostFallback().slice(
    0,
    2,
  );
  const result = hostDirectoryResultForHosts({}, [
    {
      ...observedHost,
      verificationStatus: "observed",
      observedAccountCount: 1_000,
      observedActiveAccountCount: 1_000,
    },
    {
      ...claimedHost,
      verificationStatus: "claimed",
      observedAccountCount: 1,
      observedActiveAccountCount: 0,
    },
  ]);

  assertEquals(result.sort, DEFAULT_ACCOUNT_HOST_SORT);
  assertEquals(result.hosts[0]?.host, observedHost?.host);
});

Deno.test("public host arrays do not treat unverified records as listing authority", () => {
  const now = 1_000_000_000;
  const [personal, published, detected] = listSeededAccountHostFallback().slice(
    0,
    3,
  );
  const result = hostDirectoryResultForHosts(
    { publicOnly: true, now },
    [
      {
        ...personal,
        source: "observed",
        verificationStatus: "observed",
        signupUrl: null,
        serviceRecordUri: null,
        observedActiveAccountCount: 1,
        lastIndexedAccountAt: now,
        lastActiveAt: now,
      },
      {
        ...published,
        source: "manual",
        verificationStatus: "observed",
        serviceRecordUri:
          "at://did:plc:host/account.atmosphere.host.service/self",
        observedActiveAccountCount: 1,
        lastIndexedAccountAt: now,
        lastActiveAt: now,
      },
      {
        ...detected,
        source: "manual",
        verificationStatus: "observed",
        serviceRecordUri:
          "at://did:plc:provider/account.atmosphere.host.service/self",
        publicIntentStatus: "detected",
        publicIntentSource: "pds_managed_invites",
        publicIntentCheckedAt: now,
        observedActiveAccountCount: 2,
        lastIndexedAccountAt: now,
        lastActiveAt: now,
      },
    ],
  );

  assertEquals(result.total, 1);
  assertEquals(result.hosts[0]?.host, detected?.host);
});

Deno.test("create-account host discovery requires trusted signup URLs", () => {
  const hosts = listSeededAccountHostFallback();
  const result = hostDirectoryResultForHosts(
    { signupStatus: "open", hasSignupUrl: true, trustedOnly: true },
    hosts,
  );

  assertEquals(result.hosts.length, 2);
  assertEquals(result.hosts.some((host) => host.host === "bsky.network"), true);
  assertEquals(result.hosts.some((host) => host.host === "tangled.org"), true);
});

Deno.test("create-account host discovery can include open and invite hosts together", () => {
  const [first, second, third] = listSeededAccountHostFallback();
  const result = hostDirectoryResultForHosts(
    {
      signupStatuses: ["open", "invite_required"],
      hasSignupUrl: true,
      trustedOnly: true,
    },
    [
      { ...first, signupStatus: "open", signupUrl: "https://one.test/signup" },
      {
        ...second,
        signupStatus: "invite_required",
        signupUrl: "https://two.test/signup",
      },
      {
        ...third,
        signupStatus: "closed",
        signupUrl: "https://three.test/signup",
      },
    ],
  );

  assertEquals(result.hosts.length, 2);
  assertEquals(
    result.hosts.some((host) => host.signupStatus === "open"),
    true,
  );
  assertEquals(
    result.hosts.some((host) => host.signupStatus === "invite_required"),
    true,
  );
});

Deno.test("host discovery searches inferred locations", () => {
  const host = {
    ...listSeededAccountHostFallback()[0],
    inferredLocation: "North America",
  };
  const result = hostDirectoryResultForHosts(
    { query: "north america" },
    [host],
  );
  assertEquals(result.hosts.length, 1);
});

Deno.test("seeded host detail fallback only resolves exact curated hosts", () => {
  assertEquals(
    seededHostDetailFallback(" BSKY.NETWORK ")?.displayName,
    "Bluesky",
  );
  assertEquals(seededHostDetailFallback("bsky"), null);
  assertEquals(seededHostDetailFallback("example.com"), null);
});

Deno.test("early appview proxy covers DB-backed APIs before session hydration", () => {
  for (
    const path of [
      "/api/apps/grain/favorite",
      "/api/hosts/location/infer",
      "/api/account/profile",
      "/api/admin/app-directory/rescore",
      "/api/login/selection",
      "/api/login/account-hosts",
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

Deno.test("only namespaced appview assets are proxied from the appview bundle", () => {
  assertEquals(
    isGeneratedAppviewAssetPathForTest(
      "/_appview/assets/client-entry.js",
    ),
    true,
  );
  assertEquals(
    isGeneratedAppviewAssetPathForTest(
      "/_appview/assets/fresh-island__SignInForm-B3cwBuRQ.js",
    ),
    true,
  );
  assertEquals(
    isGeneratedAppviewAssetPathForTest("/assets/client-entry.js"),
    false,
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
      new URL(
        "https://atmosphereaccount.com/_appview/assets/client-entry.js",
      ),
      trustedOrigins,
    ),
    true,
  );
  assertEquals(
    shouldProxyAppviewAssetForTest(
      new URL(
        "https://login.atmosphereaccount.com/_appview/assets/client-entry.js",
      ),
      trustedOrigins,
    ),
    true,
  );
  assertEquals(
    shouldProxyAppviewAssetForTest(
      new URL("https://example.com/_appview/assets/client-entry.js"),
      trustedOrigins,
    ),
    false,
  );
  assertEquals(
    shouldProxyAppviewAssetForTest(
      new URL("https://atmosphereaccount.com/assets/client-entry.js"),
      trustedOrigins,
    ),
    false,
  );
});

Deno.test("namespaced appview asset requests map back to appview build assets", () => {
  const source = appviewAssetSourceUrlForTest(
    new URL(
      "https://atmosphereaccount.com/_appview/assets/client-entry.js?v=1",
    ),
  );

  assertEquals(
    source.href,
    "https://atmosphereaccount.com/assets/client-entry.js?v=1",
  );
});

Deno.test("appview HTML keeps its generated assets in the proxy namespace", () => {
  const rewritten = rewriteAppviewHtmlForTest(
    [
      '<script type="module">import { boot } from "/assets/client.js";</script>',
      '<link rel="modulepreload" href="/assets/island.js">',
      '<script src="https://appview.example/assets/absolute.js"></script>',
      '<a href="https://appview.example/apps/spark">Spark</a>',
    ].join(""),
    "https://appview.example",
    new URL("https://atmosphereaccount.com/apps/spark"),
  );

  assertEquals(rewritten.includes('from "/_appview/assets/client.js"'), true);
  assertEquals(
    rewritten.includes('href="/_appview/assets/island.js"'),
    true,
  );
  assertEquals(
    rewritten.includes(
      'src="https://atmosphereaccount.com/_appview/assets/absolute.js"',
    ),
    true,
  );
  assertEquals(
    rewritten.includes('href="https://atmosphereaccount.com/apps/spark"'),
    true,
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

Deno.test("appview JSON requests carry a signed caller identity", async () => {
  const source = new Headers({
    "x-forwarded-for": "198.51.100.42",
    "x-atmosphere-client-key": "attacker-controlled",
  });
  const headers = await appviewJsonHeadersForTest(source);
  const request = new Request(
    "https://appview.example/api/appview/apps/search",
    {
      headers,
    },
  );
  const identity = await readProxyClientKey(request);

  assertEquals(headers.get("accept"), "application/json");
  assertEquals(
    headers.get("x-atmosphere-client-key") === "attacker-controlled",
    false,
  );
  assertEquals(typeof identity, "string");
  assertEquals(identity?.length, 43);
  assertEquals(
    (await appviewJsonHeadersForTest()).has("x-atmosphere-client-key"),
    false,
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
