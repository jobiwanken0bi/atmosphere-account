import { isAllowedLoginHostPathForTest } from "./login-domain.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("login domain serves generated picker assets in place", () => {
  assertEquals(isAllowedLoginHostPathForTest("/assets/client-entry.js"), true);
  assertEquals(
    isAllowedLoginHostPathForTest(
      "/assets/fresh-island__SignInForm-B3cwBuRQ.js",
    ),
    true,
  );
});

Deno.test("login domain still redirects ordinary app pages", () => {
  assertEquals(isAllowedLoginHostPathForTest("/apps"), false);
  assertEquals(isAllowedLoginHostPathForTest("/account"), false);
  assertEquals(isAllowedLoginHostPathForTest("/hosts/bsky.network"), false);
});
