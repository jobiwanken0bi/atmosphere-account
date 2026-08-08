import {
  applySecurityHeadersForTest,
  csrfExpectedOriginForTest,
  isCrossOriginReadonlyRequest,
  isJsonMediaType,
  isPrivateNetworkHostname,
  isPrivateNetworkUrl,
  isSafeRelativePath,
  isSameOriginUnsafeRequest,
  readFormDataRequestWithLimit,
  readJsonRequestWithLimit,
  readResponseBytesWithLimit,
  readResponseTextWithLimit,
  requestBodyTooLarge,
  RequestBodyTooLargeError,
} from "./security.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("JSON media type checks reject substring lookalikes", () => {
  assertEquals(isJsonMediaType("application/json; charset=utf-8"), true);
  assertEquals(isJsonMediaType("application/problem+json"), true);
  assertEquals(isJsonMediaType("application/dns-json"), true);
  assertEquals(isJsonMediaType("application/jsonp"), false);
  assertEquals(isJsonMediaType("text/json"), false);
});

Deno.test("CSRF rejects cross-site unsafe requests by default", () => {
  const req = new Request("https://atmosphereaccount.com/api/account/profile", {
    method: "POST",
    headers: { origin: "https://evil.example" },
  });
  assertEquals(
    isSameOriginUnsafeRequest(req, "https://atmosphereaccount.com"),
    false,
  );
});

Deno.test("CSRF fails closed for cookie-backed writes without origin metadata", () => {
  const expectedOrigin = "https://atmosphereaccount.com";
  const strippedBrowserRequest = new Request(
    `${expectedOrigin}/api/account/profile`,
    {
      method: "POST",
      headers: { cookie: "atmo_sid=session.signature" },
    },
  );
  const sameOriginFetchMetadata = new Request(
    `${expectedOrigin}/api/account/profile`,
    {
      method: "POST",
      headers: {
        cookie: "atmo_sid=session.signature",
        "sec-fetch-site": "same-origin",
      },
    },
  );
  const siblingSubdomainRequest = new Request(
    `${expectedOrigin}/api/account/profile`,
    {
      method: "POST",
      headers: {
        cookie: "atmo_sid=session.signature",
        "sec-fetch-site": "same-site",
      },
    },
  );
  const serverToServerRequest = new Request(
    `${expectedOrigin}/api/account/profile`,
    { method: "POST" },
  );

  assertEquals(
    isSameOriginUnsafeRequest(strippedBrowserRequest, expectedOrigin),
    false,
  );
  assertEquals(
    isSameOriginUnsafeRequest(sameOriginFetchMetadata, expectedOrigin),
    true,
  );
  assertEquals(
    isSameOriginUnsafeRequest(siblingSubdomainRequest, expectedOrigin),
    false,
  );
  assertEquals(
    isSameOriginUnsafeRequest(serverToServerRequest, expectedOrigin),
    true,
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
    isCrossOriginReadonlyRequest(req, "/api/account/profile"),
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
  assertEquals(isPrivateNetworkUrl("https://localhost."), true);
  assertEquals(isPrivateNetworkUrl("https://127.0.0.1"), true);
  assertEquals(isPrivateNetworkUrl("https://10.0.0.5"), true);
  assertEquals(isPrivateNetworkUrl("https://172.20.0.5"), true);
  assertEquals(isPrivateNetworkUrl("https://192.168.1.5"), true);
  assertEquals(isPrivateNetworkUrl("https://[::1]"), true);
  assertEquals(isPrivateNetworkUrl("https://[fd00::1]"), true);
  assertEquals(isPrivateNetworkUrl("https://[::ffff:127.0.0.1]"), true);
  assertEquals(isPrivateNetworkUrl("https://[::ffff:10.0.0.1]"), true);
  assertEquals(isPrivateNetworkUrl("https://[::127.0.0.1]"), true);
  assertEquals(isPrivateNetworkUrl("https://[ff02::1]"), true);
  assertEquals(isPrivateNetworkUrl("https://198.18.0.1"), true);
  assertEquals(isPrivateNetworkUrl("https://203.0.113.7"), true);
  assertEquals(isPrivateNetworkUrl("https://8.8.8.8"), false);
  assertEquals(isPrivateNetworkUrl("https://[2606:4700:4700::1111]"), false);
  assertEquals(isPrivateNetworkHostname("::ffff:127.0.0.1"), true);
  assertEquals(isPrivateNetworkHostname("service.internal"), true);
  assertEquals(isPrivateNetworkHostname("service.home.arpa"), true);
  assertEquals(isPrivateNetworkHostname("service.test"), true);
  assertEquals(isPrivateNetworkHostname("service.invalid"), true);
  assertEquals(isPrivateNetworkHostname("service.example"), true);
  assertEquals(isPrivateNetworkHostname("hidden.onion"), true);
  assertEquals(isPrivateNetworkHostname("2001:db8::1"), true);
  assertEquals(isPrivateNetworkHostname("3fff::1"), true);
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

  const understated = await readResponseBytesWithLimit(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5, 6]));
          controller.close();
        },
      }),
      { headers: { "content-length": "2" } },
    ),
    4,
  );
  assertEquals(understated.ok, false);
});

Deno.test("bounded JSON reader rejects oversized streamed requests", async () => {
  const request = new Request("https://atmosphereaccount.com/api/passkeys", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode("too-large"));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    }),
  });
  let tooLarge = false;
  try {
    await readJsonRequestWithLimit(request, 8);
  } catch (error) {
    tooLarge = error instanceof RequestBodyTooLargeError;
  }
  assertEquals(tooLarge, true);
});

Deno.test("bounded form reader rejects chunked bodies without content-length", async () => {
  const request = new Request("https://atmosphereaccount.com/oauth/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("handle="));
        controller.enqueue(new TextEncoder().encode("far-too-large.example"));
        controller.close();
      },
    }),
  });
  let tooLarge = false;
  try {
    await readFormDataRequestWithLimit(request, 8);
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
      "/passkeys",
      "/api/passkeys/authentication/options",
      "/api/login/passkeys/options",
    ]
  ) {
    const headers = applySecurityHeadersForTest(pathname);
    assertEquals(headers.get("referrer-policy"), "no-referrer");
    assertEquals(headers.get("cache-control"), "no-store");
    assertEquals(headers.get("x-robots-tag"), "noindex, nofollow");
  }
});

Deno.test("security policy confines passkey ceremonies to the same origin", () => {
  const headers = applySecurityHeadersForTest("/passkeys");
  const policy = headers.get("permissions-policy") ?? "";
  assertEquals(policy.includes("publickey-credentials-create=(self)"), true);
  assertEquals(policy.includes("publickey-credentials-get=(self)"), true);
});

Deno.test("security policy disables inline HTML event handlers", () => {
  const policy = applySecurityHeadersForTest("/apps").get(
    "content-security-policy",
  ) ?? "";
  assertEquals(policy.includes("script-src-attr 'none'"), true);
});

Deno.test("ordinary pages keep the default referrer policy", () => {
  const headers = applySecurityHeadersForTest("/apps");
  assertEquals(
    headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  assertEquals(headers.has("cache-control"), false);
});

Deno.test("personalized HTML is explicitly private and not cacheable", () => {
  const headers = applySecurityHeadersForTest(
    "/apps",
    new Headers({ "content-type": "text/html; charset=utf-8" }),
    true,
  );
  assertEquals(headers.get("cache-control"), "private, no-store");

  const publicHeaders = applySecurityHeadersForTest(
    "/apps",
    new Headers({ "content-type": "text/html; charset=utf-8" }),
  );
  assertEquals(publicHeaders.has("cache-control"), false);
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
