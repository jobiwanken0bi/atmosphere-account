import { shouldHydrateAccountDetails } from "./session.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("session details fully hydrate when no appview is configured", () => {
  assertEquals(shouldHydrateAccountDetails("/", false), true);
  assertEquals(shouldHydrateAccountDetails("/docs", false), true);
  assertEquals(shouldHydrateAccountDetails("/signin", false), true);
  assertEquals(shouldHydrateAccountDetails("/apps/manage", false), true);
});

Deno.test("session details stay lightweight for Deno shell pages when appview is configured", () => {
  assertEquals(shouldHydrateAccountDetails("/", true), false);
  assertEquals(shouldHydrateAccountDetails("/docs", true), false);
  assertEquals(shouldHydrateAccountDetails("/signin", true), false);
  assertEquals(
    shouldHydrateAccountDetails("/examples/atmosphere-login/app", true),
    false,
  );
});

Deno.test("session details keep full hydration for dev-only local helpers", () => {
  assertEquals(shouldHydrateAccountDetails("/dev/account-demo", true), true);
});
