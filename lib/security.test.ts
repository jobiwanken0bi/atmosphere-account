import {
  applySecurityHeadersForTest,
  isCrossOriginReadonlyRequest,
  isPrivateNetworkUrl,
  isSafeRelativePath,
  isSameOriginUnsafeRequest,
  readResponseTextWithLimit,
  requestBodyTooLarge,
} from "./security.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

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

Deno.test("token-bearing Atmosphere Login pages force private browser headers", () => {
  for (
    const pathname of [
      "/login/select",
      "/api/login/selection",
      "/examples/atmosphere-login/callback",
    ]
  ) {
    const headers = applySecurityHeadersForTest(pathname);
    assertEquals(headers.get("referrer-policy"), "no-referrer");
    assertEquals(headers.get("cache-control"), "no-store");
    assertEquals(headers.get("x-robots-tag"), "noindex, nofollow");
  }
});

Deno.test("ordinary pages keep the default referrer policy", () => {
  const headers = applySecurityHeadersForTest("/apps");
  assertEquals(
    headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
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
