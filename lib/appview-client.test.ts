import { shouldProxyAppviewBeforeSession } from "./appview-client.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("early appview proxy covers DB-backed app surfaces before session hydration", () => {
  for (
    const path of [
      "/apps",
      "/apps/grain",
      "/apps/create",
      "/hosts",
      "/hosts/bsky.network",
      "/hosts/register",
      "/account",
      "/account/reviews",
      "/admin/app-directory",
      "/users/joebasser.com",
      "/login/select",
      "/oauth/callback",
    ]
  ) {
    assertEquals(shouldProxyAppviewBeforeSession(path), true);
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
      "/assets/client-entry.js",
      "/atmosphere-login.js",
      "/.well-known/atproto-did",
    ]
  ) {
    assertEquals(shouldProxyAppviewBeforeSession(path), false);
  }
});
