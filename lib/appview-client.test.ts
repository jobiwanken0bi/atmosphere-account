import {
  appviewFetchTimeoutMs,
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

Deno.test("appview fetch timeout defaults to a short public-shell budget", () => {
  assertEquals(appviewFetchTimeoutMs(null), 5000);
  assertEquals(appviewFetchTimeoutMs(""), 5000);
  assertEquals(appviewFetchTimeoutMs("not-a-number"), 5000);
  assertEquals(appviewFetchTimeoutMs("250"), 1000);
  assertEquals(appviewFetchTimeoutMs("15000"), 15000);
});
