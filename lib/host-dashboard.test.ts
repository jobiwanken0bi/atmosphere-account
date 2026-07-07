import type { AccountHost } from "./account-hosts.ts";
import {
  buildHostDashboardState,
  fetchHostDashboardManifest,
  HOST_DASHBOARD_SPEC_VERSION,
  hostDashboardManifestUrl,
  parseHostDashboardManifest,
  validateHostDashboardManifest,
} from "./host-dashboard.ts";

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
    dataLocation: null,
    inferredLocation: null,
    inferredLocationSource: null,
    inferredLocationCheckedAt: null,
    inferredLocationEvidenceJson: null,
    homepageUrl: "https://example.host",
    serviceEndpoint: "https://pds.example.host",
    accountManagementUrl: null,
    dashboardUrl: "https://example.host/account",
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
    observedAccountCount: 0,
    observedActiveAccountCount: 0,
    lastIndexedAccountAt: null,
    lastCheckedAt: null,
    lastObservedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

Deno.test("parseHostDashboardManifest accepts the v0.1 manifest shape", () => {
  const manifest = parseHostDashboardManifest({
    version: HOST_DASHBOARD_SPEC_VERSION,
    host: "Example.Host",
    displayName: "Example",
    dashboardUrl: "https://example.host/account",
    capabilities: {
      connectedApps: {
        state: "supported",
        href: "https://example.host/account/apps",
      },
    },
  });

  assert(manifest);
  assertEquals(manifest.host, "example.host");
  assertEquals(manifest.capabilities?.connectedApps?.state, "supported");
});

Deno.test("validateHostDashboardManifest rejects wrong host and bad capability state", () => {
  const result = validateHostDashboardManifest({
    version: HOST_DASHBOARD_SPEC_VERSION,
    host: "other.host",
    capabilities: {
      connectedApps: {
        state: "done",
      },
    },
  }, { expectedHost: "example.host" });

  assertEquals(result.ok, false);
  assertEquals(result.manifest, null);
  assert(
    result.issues.some((issue) =>
      issue.path === "$.host" && issue.severity === "error"
    ),
  );
  assert(
    result.issues.some((issue) =>
      issue.path === "$.capabilities.connectedApps.state" &&
      issue.severity === "error"
    ),
  );
});

Deno.test("hostDashboardManifestUrl preserves explicit manifest URLs", () => {
  assertEquals(
    hostDashboardManifestUrl(
      "https://example.host/custom/manifest.json#ignore-me",
    ),
    "https://example.host/custom/manifest.json",
  );
  assertEquals(
    hostDashboardManifestUrl("example.host"),
    "https://example.host/.well-known/atmosphere-host-dashboard.json",
  );
});

Deno.test("hostDashboardManifestUrl rejects private production hosts", () => {
  assertEquals(
    hostDashboardManifestUrl("https://127.0.0.1/manifest.json"),
    null,
  );
  assertEquals(
    hostDashboardManifestUrl("https://192.168.1.20/manifest.json"),
    null,
  );
});

Deno.test("fetchHostDashboardManifest validates fetched JSON", async () => {
  const result = await fetchHostDashboardManifest("example.host", {
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            version: HOST_DASHBOARD_SPEC_VERSION,
            host: "example.host",
            capabilities: {
              connectedApps: { state: "supported" },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
  });

  assertEquals(result.ok, true);
  assertEquals(result.status, 200);
  assertEquals(result.manifest?.host, "example.host");
});

Deno.test("fetchHostDashboardManifest does not follow host-controlled redirects", async () => {
  let redirectMode: RequestRedirect | undefined;
  const result = await fetchHostDashboardManifest("example.host", {
    fetchImpl: (_input, init) => {
      redirectMode = init?.redirect;
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/internal" },
        }),
      );
    },
  });

  assertEquals(redirectMode, "manual");
  assertEquals(result.ok, false);
  assertEquals(result.status, 302);
});

Deno.test("buildHostDashboardState uses honest fallback capability states", () => {
  const dashboard = buildHostDashboardState({ host: host() });

  assert(dashboard);
  assertEquals(dashboard.version, HOST_DASHBOARD_SPEC_VERSION);
  assertEquals(
    dashboard.accountManagementUrl,
    "https://example.host/account",
  );
  assertEquals(dashboard.supportedCount, 0);
  assertEquals(
    dashboard.capabilities.find((capability) => capability.key === "password")
      ?.state,
    "host_owned",
  );
  assertEquals(
    dashboard.capabilities.find((capability) => capability.key === "repoExport")
      ?.state,
    "planned",
  );
});

Deno.test("buildHostDashboardState applies stored host capability overrides", () => {
  const dashboard = buildHostDashboardState({
    host: host({
      capabilitiesJson: JSON.stringify({
        connectedApps: {
          state: "supported",
          href: "https://example.host/account/apps",
        },
      }),
    }),
  });

  assert(dashboard);
  assertEquals(dashboard.supportedCount, 1);
  assertEquals(
    dashboard.capabilities.find((capability) =>
      capability.key === "connectedApps"
    )?.href,
    "https://example.host/account/apps",
  );
});
