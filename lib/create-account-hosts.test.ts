import {
  type AccountHost,
  listSeededAccountHostFallback,
} from "./account-hosts.ts";
import {
  HOST_CAPABILITY_OAUTH_ACCOUNT_CREATION,
  isCreateAccountHostEligible as eligible,
  supportsOAuthAccountCreation,
} from "./create-account-hosts.ts";

function isCreateAccountHostEligible(host: AccountHost, at: number): boolean {
  return eligible(host, at, {
    host: host.host,
    serviceEndpoint: "https://host.example.com",
    supported: host.capabilitiesJson !== null,
    signupStatus: null,
    issuer: "https://host.example.com",
    checkedAt: at,
    expiresAt: at + 1000,
  });
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("create-account hosts must enable direct OAuth creation", () => {
  const now = 1_000_000_000;
  const base = {
    ...listSeededAccountHostFallback()[0],
    host: "host.example.com",
    signupStatus: "open" as const,
    signupUrl: "https://host.example.com/signup",
    serviceEndpoint: "https://host.example.com",
    capabilitiesJson: JSON.stringify([{
      id: HOST_CAPABILITY_OAUTH_ACCOUNT_CREATION,
      status: "account.atmosphere.host.defs#capabilitySupported",
    }]),
    observedActiveAccountCount: 10,
    lastIndexedAccountAt: now,
    lastActiveAt: now,
  };

  assertEquals(isCreateAccountHostEligible(base, now), true);
  assertEquals(
    isCreateAccountHostEligible({ ...base, capabilitiesJson: null }, now),
    false,
  );
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
  // Direct OAuth does not use this legacy signup link.
  assertEquals(
    isCreateAccountHostEligible({
      ...base,
      signupUrl: "http://host.example.com/signup",
    }, now),
    true,
  );
});

Deno.test("OAuth account creation requires an explicit supported capability", () => {
  const base = {
    ...listSeededAccountHostFallback()[0],
    serviceEndpoint: "https://host.example.com",
    capabilitiesJson: JSON.stringify([{
      id: HOST_CAPABILITY_OAUTH_ACCOUNT_CREATION,
      status: "account.atmosphere.host.defs#capabilitySupported",
    }]),
  };
  assertEquals(supportsOAuthAccountCreation(base), true);
  assertEquals(
    supportsOAuthAccountCreation({
      ...base,
      capabilitiesJson: JSON.stringify([{
        id: HOST_CAPABILITY_OAUTH_ACCOUNT_CREATION,
        status: "account.atmosphere.host.defs#capabilityPlanned",
      }]),
    }),
    false,
  );
  assertEquals(
    supportsOAuthAccountCreation({ ...base, capabilitiesJson: "not json" }),
    false,
  );
});

Deno.test("selfhosted.social advertises direct OAuth account creation", () => {
  const host = listSeededAccountHostFallback().find((item) =>
    item.host === "selfhosted.social"
  );
  assertEquals(!!host, true);
  assertEquals(host?.signupUrl, "https://selfhosted.social/signup");
  assertEquals(supportsOAuthAccountCreation(host!), true);
});
