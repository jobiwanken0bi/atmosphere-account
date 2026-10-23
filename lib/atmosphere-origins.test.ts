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

Deno.test("trustedRequestOrigin recovers the configured login host after TLS termination", async () => {
  // Import in an isolated process so this test always has distinct HTTPS
  // origins. A same-origin default could accidentally pass via the fallback.
  const moduleUrl = new URL("./atmosphere-origins.ts", import.meta.url).href;
  const script = `const { trustedRequestOrigin } = await import(${
    JSON.stringify(moduleUrl)
  });
    const origin = trustedRequestOrigin(new URL("http://login.cutover.example/oauth/client-metadata.json"));
    if (origin !== "https://login.cutover.example") throw new Error("Wrong login origin after TLS termination");
    for (const value of ["http://login.cutover.example:12345", "http://login.cutover.example.attacker.test"]) {
      if (trustedRequestOrigin(new URL(value)) !== "https://cutover.example") throw new Error("Untrusted host accepted");
    }`;
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--cached-only", script],
    env: {
      DENO_ENV: "production",
      FRESH_PUBLIC_SITE_URL: "https://cutover.example",
      FRESH_PUBLIC_LOGIN_URL: "https://login.cutover.example",
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
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
