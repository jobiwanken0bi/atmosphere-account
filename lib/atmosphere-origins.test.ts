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

Deno.test("trustedRequestOrigin treats same-port loopback aliases as one dev site", () => {
  assertEquals(
    trustedRequestOrigin(
      new URL("http://localhost:5173/oauth/login"),
      new Headers({ origin: "http://127.0.0.1:5173" }),
    ),
    "http://127.0.0.1:5173",
  );
  assertEquals(
    trustedRequestOrigin(
      new URL("http://localhost:5173/oauth/login"),
      new Headers({ referer: "http://127.0.0.1:5173/signin" }),
    ),
    "http://127.0.0.1:5173",
  );
  assertEquals(
    trustedRequestOrigin(
      new URL("http://localhost:5173/oauth/login"),
      new Headers({ origin: "http://127.0.0.1:5174" }),
    ),
    "http://localhost:5173",
  );
});
