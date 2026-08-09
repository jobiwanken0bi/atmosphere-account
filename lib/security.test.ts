import {
  applySecurityHeadersForTest,
  csrfExpectedOriginForTest,
  isCrossOriginReadonlyRequest,
  isPrivateNetworkUrl,
  isSafeRelativePath,
  isSameOriginUnsafeRequest,
  readJsonRequestWithLimit,
  readResponseTextWithLimit,
  requestBodyTooLarge,
  RequestBodyTooLargeError,
} from "./security.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("CSRF rejects cross-site unsafe requests by default", () => {
  const req = new Request(
    "https://atmosphereaccount.com/api/account/microblog-viewer",
    {
      method: "POST",
      headers: { origin: "https://evil.example" },
    },
  );
  assertEquals(
    isSameOriginUnsafeRequest(req, "https://atmosphereaccount.com"),
    false,
  );
});

Deno.test("CSRF uses the trusted public origin for appview-proxied requests", () => {
  const appviewUrl = new URL(
    "https://web-production-001c9.up.railway.app/account",
  );
  const forwarded = new Headers({
    origin: "https://atmosphereaccount.com",
    "x-atmosphere-public-origin": "https://atmosphereaccount.com",
  });
  const expectedOrigin = csrfExpectedOriginForTest(appviewUrl, forwarded);
  const sameOriginWrite = new Request(appviewUrl, {
    method: "POST",
    headers: forwarded,
  });
  const crossSiteWrite = new Request(appviewUrl, {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "x-atmosphere-public-origin": "https://atmosphereaccount.com",
    },
  });

  assertEquals(expectedOrigin, "https://atmosphereaccount.com");
  assertEquals(
    isSameOriginUnsafeRequest(sameOriginWrite, expectedOrigin),
    true,
  );
  assertEquals(
    isSameOriginUnsafeRequest(crossSiteWrite, expectedOrigin),
    false,
  );
});

Deno.test("Atmosphere Login selection verification is the only cross-origin POST exemption", () => {
  const req = new Request(
    "https://atmosphereaccount.com/api/login/selection",
    {
      method: "POST",
      headers: { origin: "https://app.example" },
    },
  );
  assertEquals(
    isCrossOriginReadonlyRequest(req, "/api/login/selection"),
    true,
  );
  assertEquals(
    isCrossOriginReadonlyRequest(req, "/api/account/microblog-viewer"),
    false,
  );
});

Deno.test("safe relative paths reject ambiguous redirects", () => {
  assertEquals(isSafeRelativePath("/account"), true);
  assertEquals(isSafeRelativePath("//evil.example"), false);
  assertEquals(isSafeRelativePath("/\\evil.example"), false);
  assertEquals(isSafeRelativePath("/account\nx"), false);
  assertEquals(isSafeRelativePath("https://evil.example"), false);
});

Deno.test("private network URL detection covers common IP literal forms", () => {
  assertEquals(isPrivateNetworkUrl("https://example.com"), false);
  assertEquals(
    isPrivateNetworkUrl("http://example.com", { allowHttp: true }),
    false,
  );
  assertEquals(isPrivateNetworkUrl("http://example.com"), true);
  assertEquals(isPrivateNetworkUrl("https://localhost"), true);
  assertEquals(isPrivateNetworkUrl("https://127.0.0.1"), true);
  assertEquals(isPrivateNetworkUrl("https://10.0.0.5"), true);
  assertEquals(isPrivateNetworkUrl("https://172.20.0.5"), true);
  assertEquals(isPrivateNetworkUrl("https://192.168.1.5"), true);
  assertEquals(isPrivateNetworkUrl("https://[::1]"), true);
  assertEquals(isPrivateNetworkUrl("https://[fd00::1]"), true);
});

Deno.test("request body size checks use content-length before parsing", () => {
  const req = new Request("https://atmosphereaccount.com/login/select", {
    method: "POST",
    headers: { "content-length": "9000" },
  });
  assertEquals(requestBodyTooLarge(req, 8192), true);
  assertEquals(requestBodyTooLarge(req, 10000), false);
});

Deno.test("bounded response reader rejects oversized responses", async () => {
  const ok = await readResponseTextWithLimit(
    new Response("small"),
    10,
  );
  assertEquals(ok.ok, true);

  const tooLarge = await readResponseTextWithLimit(
    new Response("large response"),
    4,
  );
  assertEquals(tooLarge.ok, false);
});

Deno.test("bounded JSON reader rejects oversized streamed requests", async () => {
  const request = new Request(
    "https://atmosphereaccount.com/api/account/type",
    {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"value":"'));
          controller.enqueue(new TextEncoder().encode("too-large"));
          controller.enqueue(new TextEncoder().encode('"}'));
          controller.close();
        },
      }),
    },
  );
  let tooLarge = false;
  try {
    await readJsonRequestWithLimit(request, 8);
  } catch (error) {
    tooLarge = error instanceof RequestBodyTooLargeError;
  }
  assertEquals(tooLarge, true);
});

Deno.test("token-bearing Atmosphere Login pages force private browser headers", () => {
  for (
    const pathname of [
      "/login/select",
      "/signin",
      "/oauth/add-account",
      "/oauth/switch",
      "/oauth/login",
      "/oauth/create",
      "/api/login/selection",
      "/examples/atmosphere-login/callback",
      "/hosts/claim",
      "/hosts/register",
      "/hosts/pds.example/claim",
    ]
  ) {
    const headers = applySecurityHeadersForTest(pathname);
    assertEquals(headers.get("referrer-policy"), "no-referrer");
    assertEquals(headers.get("cache-control"), "no-store");
    assertEquals(headers.get("x-robots-tag"), "noindex, nofollow");
  }
});

Deno.test("security policy disables WebAuthn after passkey removal", () => {
  const policy = applySecurityHeadersForTest("/apps").get(
    "permissions-policy",
  ) ?? "";
  assertEquals(policy.includes("publickey-credentials-create=()"), true);
  assertEquals(policy.includes("publickey-credentials-get=()"), true);
  assertEquals(policy.includes("publickey-credentials-create=(self)"), false);
  assertEquals(policy.includes("publickey-credentials-get=(self)"), false);
});

Deno.test("ordinary pages keep the default referrer policy", () => {
  const headers = applySecurityHeadersForTest("/apps");
  assertEquals(
    headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  assertEquals(headers.has("cache-control"), false);
});

Deno.test("rendered account pages are always private and non-cacheable", () => {
  for (const pathname of ["/account", "/account/apps-hosts"]) {
    const headers = applySecurityHeadersForTest(
      pathname,
      new Headers({
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      }),
    );
    assertEquals(headers.get("cache-control"), "private, no-store");
  }
});

Deno.test("the legacy account redirect remains cacheable", () => {
  const headers = applySecurityHeadersForTest(
    "/account/products",
    new Headers({ location: "/account/apps-hosts" }),
  );
  assertEquals(headers.has("cache-control"), false);
});

Deno.test("account cache policy does not override non-HTML responses", () => {
  const headers = applySecurityHeadersForTest(
    "/account/apps-hosts",
    new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "max-age=60",
    }),
  );
  assertEquals(headers.get("cache-control"), "max-age=60");
});

Deno.test("public HTML pages are unaffected by the account cache policy", () => {
  const headers = applySecurityHeadersForTest(
    "/apps",
    new Headers({ "content-type": "text/html; charset=utf-8" }),
  );
  assertEquals(headers.has("cache-control"), false);
});

Deno.test("login popup routes keep opener-compatible COOP", () => {
  for (
    const pathname of [
      "/login/select",
      "/examples/atmosphere-login/app",
      "/examples/atmosphere-login/callback",
    ]
  ) {
    const headers = applySecurityHeadersForTest(pathname);
    assertEquals(
      headers.get("cross-origin-opener-policy"),
      "same-origin-allow-popups",
    );
  }
});

Deno.test("ordinary pages keep strict COOP isolation", () => {
  const headers = applySecurityHeadersForTest("/apps");
  assertEquals(headers.get("cross-origin-opener-policy"), "same-origin");
});
