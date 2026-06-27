import type { AccountHost } from "./account-hosts.ts";
import { buildHostAccountRoute } from "./host-account-routing.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

function host(overrides: Partial<AccountHost> = {}): AccountHost {
  return {
    host: "example.host",
    displayName: "Example Host",
    description: "A test host.",
    homepageUrl: "https://example.host",
    serviceEndpoint: "https://pds.example.host",
    accountManagementUrl: null,
    dashboardUrl: null,
    capabilityManifestUrl: null,
    capabilitiesJson: null,
    supportUrl: "https://example.host/support",
    profileHandle: "example.host",
    profileDid: null,
    bskyProfileVisible: true,
    avatarUrl: null,
    claimHandle: "example.host",
    claimDid: null,
    signupStatus: "open",
    verificationStatus: "claimed",
    source: "seeded",
    matchPatterns: ["example.host"],
    serviceRecordUri: null,
    serviceRecordCid: null,
    serviceObservedAt: null,
    profileCheckedAt: null,
    lastCheckedAt: null,
    lastObservedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

Deno.test("buildHostAccountRoute derives account page from service endpoint", () => {
  const route = buildHostAccountRoute({ host: host() });

  assert(route);
  assertEquals(route.accountManagementUrl, "https://pds.example.host/account");
  assertEquals(route.source, "service_endpoint");
  assertEquals(route.directoryUrl, "/hosts/example.host");
});

Deno.test("buildHostAccountRoute prefers explicit account management URL", () => {
  const route = buildHostAccountRoute({
    host: host({
      accountManagementUrl: "https://accounts.example.host/manage",
    }),
  });

  assert(route);
  assertEquals(
    route.accountManagementUrl,
    "https://accounts.example.host/manage",
  );
  assertEquals(route.source, "explicit_account_management_url");
});

Deno.test("buildHostAccountRoute does not fall back to homepage as an account page", () => {
  const route = buildHostAccountRoute({
    host: host({
      serviceEndpoint: null,
      accountManagementUrl: null,
      dashboardUrl: null,
      homepageUrl: "https://marketing.example.host",
    }),
  });

  assert(route);
  assertEquals(route.accountManagementUrl, null);
  assertEquals(route.source, "unknown");
});

Deno.test("buildHostAccountRoute can use OAuth-observed lookup before a full host row exists", () => {
  const route = buildHostAccountRoute({
    host: null,
    lookup: {
      host: "observed.host",
      displayName: "Observed Host",
      endpoint: "https://pds.observed.host",
      verificationStatus: "observed",
    },
  });

  assert(route);
  assertEquals(route.displayName, "Observed Host");
  assertEquals(route.accountManagementUrl, "https://pds.observed.host/account");
});
