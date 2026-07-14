import { listSeededAccountHostFallback } from "./account-hosts.ts";
import { isCreateAccountHostEligible } from "./create-account-hosts.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("create-account hosts must be active, trusted, joinable, and HTTPS", () => {
  const now = 1_000_000_000;
  const base = {
    ...listSeededAccountHostFallback()[0],
    signupStatus: "open" as const,
    signupUrl: "https://host.example/signup",
    observedActiveAccountCount: 10,
    lastIndexedAccountAt: now,
    lastActiveAt: now,
  };

  assertEquals(isCreateAccountHostEligible(base, now), true);
  assertEquals(
    isCreateAccountHostEligible(
      { ...base, observedActiveAccountCount: 0 },
      now,
    ),
    false,
  );
  assertEquals(
    isCreateAccountHostEligible({
      ...base,
      source: "observed",
      verificationStatus: "observed",
    }, now),
    false,
  );
  assertEquals(
    isCreateAccountHostEligible({ ...base, signupStatus: "closed" }, now),
    false,
  );
  assertEquals(
    isCreateAccountHostEligible({
      ...base,
      signupUrl: "http://host.example/signup",
    }, now),
    false,
  );
});
