import {
  isAllowedLoginHostPathForTest,
  usesSeparateLoginDomain,
} from "./login-domain.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("login domain serves generated picker assets in place", () => {
  assertEquals(isAllowedLoginHostPathForTest("/assets/client-entry.js"), true);
  assertEquals(isAllowedLoginHostPathForTest("/login-handoff.js"), true);
  assertEquals(isAllowedLoginHostPathForTest("/oauth/create"), true);
  assertEquals(isAllowedLoginHostPathForTest("/passkeys"), false);
  assertEquals(isAllowedLoginHostPathForTest("/api/passkeys"), false);
  assertEquals(
    isAllowedLoginHostPathForTest("/api/login/passkeys/options"),
    false,
  );
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
  assertEquals(isAllowedLoginHostPathForTest("/terms"), false);
  assertEquals(isAllowedLoginHostPathForTest("/privacy"), false);
});

Deno.test("login signup search stays on origin without admitting other login APIs", () => {
  assertEquals(isAllowedLoginHostPathForTest("/api/login/account-hosts"), true);
  assertEquals(
    isAllowedLoginHostPathForTest("/api/login/account-hosts/other"),
    false,
  );
  assertEquals(isAllowedLoginHostPathForTest("/api/login/admin"), false);
});

Deno.test("single-origin deployments do not enforce login-host routing", () => {
  assertEquals(
    usesSeparateLoginDomain(
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5173",
    ),
    false,
  );
  assertEquals(
    usesSeparateLoginDomain(
      "https://atmosphereaccount.com",
      "https://login.atmosphereaccount.com",
    ),
    true,
  );
});
