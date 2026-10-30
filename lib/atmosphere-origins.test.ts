import { loginOrigin, siteOrigin } from "./env.ts";
import { trustedRequestOrigin } from "./atmosphere-origins.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("trustedRequestOrigin recovers public origin for appview-proxied requests", () => {
  const headers = new Headers({
    "x-atmosphere-public-origin": siteOrigin(),
  });

  assertEquals(
    trustedRequestOrigin(
      new URL("http://web-production-001c9.up.railway.app/apps/bluesky"),
      headers,
    ),
    siteOrigin(),
  );
});

Deno.test("trustedRequestOrigin recovers the configured login host after TLS termination", () => {
  const internalUrl = new URL("/oauth/client-metadata.json", loginOrigin());
  internalUrl.protocol = "http:";
  assertEquals(trustedRequestOrigin(internalUrl), loginOrigin());
});

Deno.test("trustedRequestOrigin does not trust lookalike hosts or forwarded host headers", () => {
  const hostname = new URL(loginOrigin()).hostname;
  const headers = new Headers({
    "x-forwarded-host": hostname,
    "x-forwarded-proto": "https",
  });
  for (
    const url of [
      `http://${hostname}.untrusted.example/oauth/callback`,
      `http://${hostname}:12345/oauth/callback`,
      "http://untrusted.example/oauth/callback",
    ]
  ) {
    assertEquals(trustedRequestOrigin(new URL(url), headers), siteOrigin());
  }
});
