import { siteOrigin } from "./env.ts";
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
