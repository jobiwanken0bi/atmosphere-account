import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hostClaimAuthorizationHref,
  hostClaimExpiredLinkContinuationPathForTest,
  hostClaimManageLocation,
} from "./[host]/claim.tsx";
import { hostAuthorizationHref } from "./[host]/manage/apps.tsx";
import {
  managedHostAuthorizationHref,
  managedHostTransferAuthorizationHref,
  managedHostTransferNextHref,
} from "./[host]/manage.tsx";
import { detectedHostClaimAuthorizationHref } from "./claim.tsx";
import { hostRegistrationAuthorizationHref } from "./register.tsx";
import { hostProfileResumePath } from "../../lib/host-profile-resume.ts";

const HOST = { host: "pds.example.social", displayName: "Example PDS" };

Deno.test("host claim authorization includes complete host and image management", () => {
  const source = new URL(
    "https://atmosphereaccount.com/hosts/pds.example.social/claim?publish=1&from=detected",
  );
  assertAuthorizationHref(hostClaimAuthorizationHref(HOST, source), {
    next: "/hosts/pds.example.social/claim?publish=1&from=detected",
    action: "host_claim",
    name: "Example PDS",
    capabilities: ["host", "media"],
  });
});

Deno.test("an unvalidated transfer query cannot select transfer authorization", () => {
  for (const value of ["", "   ", "forged-token"]) {
    const source = new URL(
      "https://atmosphereaccount.com/hosts/pds.example.social/claim",
    );
    source.searchParams.set("transfer_intent", value);
    assertAuthorizationHref(hostClaimAuthorizationHref(HOST, source), {
      next: `/hosts/pds.example.social/claim${source.search}`,
      action: "host_claim",
      name: "Example PDS",
      capabilities: ["host", "media"],
    });
  }
});

Deno.test("detected host claim preserves its lookup deep link", () => {
  const source = new URL(
    "https://atmosphereaccount.com/hosts/claim?domain=pds.example.social&from=directory",
  );
  assertAuthorizationHref(detectedHostClaimAuthorizationHref(source), {
    next: "/hosts/claim?domain=pds.example.social&from=directory",
    action: "host_claim",
    name: "pds.example.social",
    capabilities: ["host", "media"],
  });
});

Deno.test("an app-owned detected-host selector authenticates the app before account switching", () => {
  const source = new URL(
    "https://atmosphereaccount.com/hosts/claim?link_intent=signed-selector&domain=pds.example.social",
  );
  assertAuthorizationHref(
    detectedHostClaimAuthorizationHref(source, {
      app: { name: "Field Notes" },
    }),
    {
      next:
        "/hosts/claim?link_intent=signed-selector&domain=pds.example.social",
      action: "app",
      name: "Field Notes",
      capabilities: ["app", "media"],
    },
  );

  const boundHostStep = new URL(
    "https://atmosphereaccount.com/hosts/pds.example.social/claim?link_intent=signed-bound-intent&from=detected",
  );
  assertAuthorizationHref(hostClaimAuthorizationHref(HOST, boundHostStep), {
    next:
      "/hosts/pds.example.social/claim?link_intent=signed-bound-intent&from=detected",
    action: "host_claim",
    name: "Example PDS",
    capabilities: ["host", "media"],
  });
});

Deno.test("an expired app link never outlives or blocks DNS host ownership", () => {
  const continuation = hostClaimExpiredLinkContinuationPathForTest(HOST.host);
  assertEquals(
    continuation,
    "/hosts/pds.example.social/claim?publish=1&linkError=1",
  );
  assertAuthorizationHref(
    hostClaimAuthorizationHref(
      HOST,
      new URL(continuation, "https://atmosphereaccount.com"),
    ),
    {
      next: continuation,
      action: "host_claim",
      name: "Example PDS",
      capabilities: ["host", "media"],
    },
  );
  assertEquals(
    hostClaimManageLocation(HOST.host, false, true),
    "/hosts/pds.example.social/manage?claimed=1&dns=1&linkError=1",
  );
});

Deno.test("host management authorization preserves deep links", () => {
  assertAuthorizationHref(
    managedHostAuthorizationHref(
      HOST,
      "/hosts/pds.example.social/manage?linked=1&tab=routes",
    ),
    {
      next: "/hosts/pds.example.social/manage?linked=1&tab=routes",
      action: "host_manage",
      name: "Example PDS",
      capabilities: ["host", "media"],
    },
  );

  const appsUrl = new URL(
    "https://atmosphereaccount.com/hosts/pds.example.social/manage/apps?saved=1",
  );
  assertAuthorizationHref(hostAuthorizationHref(HOST, appsUrl), {
    next: "/hosts/pds.example.social/manage/apps?saved=1",
    action: "host_manage",
    name: "Example PDS",
    capabilities: ["host", "media"],
  });
});

Deno.test("host registration starts with the complete host and image job", () => {
  const source = new URL(
    "https://atmosphereaccount.com/hosts/register?host=local-pds.test&link_intent=opaque",
  );
  assertAuthorizationHref(
    hostRegistrationAuthorizationHref(
      source,
      ["host", "media"],
      "Local PDS",
    ),
    {
      next: "/hosts/register?host=local-pds.test&link_intent=opaque",
      action: "host_manage",
      name: "Local PDS",
      capabilities: ["host", "media"],
    },
  );
});

Deno.test("host management reuses the same bundle granted during claim", () => {
  const claimUrl = new URL(
    "https://atmosphereaccount.com/hosts/pds.example.social/claim",
  );
  const manageUrl = new URL(
    "https://atmosphereaccount.com/hosts/pds.example.social/manage",
  );
  const claim = new URL(
    hostClaimAuthorizationHref(HOST, claimUrl),
    "https://atmosphereaccount.com",
  );
  const manage = new URL(
    managedHostAuthorizationHref(
      HOST,
      `${manageUrl.pathname}${manageUrl.search}`,
    ),
    "https://atmosphereaccount.com",
  );
  assertEquals(claim.searchParams.getAll("capability"), ["host", "media"]);
  assertEquals(
    manage.searchParams.getAll("capability"),
    claim.searchParams.getAll("capability"),
  );
});

Deno.test("host manager change preserves one contextual transfer and full grant", () => {
  const next = managedHostTransferNextHref(
    { ...HOST, operatorListingOptIn: false },
    "signed-transfer-intent",
  );
  assertEquals(
    next,
    "/hosts/pds.example.social/claim?transfer_intent=signed-transfer-intent&publish=0",
  );
  assertAuthorizationHref(managedHostTransferAuthorizationHref(HOST, next), {
    next,
    action: "host_transfer",
    name: "Example PDS",
    capabilities: ["host", "media"],
  });
  assertAuthorizationHref(
    hostClaimAuthorizationHref(
      HOST,
      new URL(next, "https://atmosphereaccount.com"),
      "host_transfer",
    ),
    {
      next,
      action: "host_transfer",
      name: "Example PDS",
      capabilities: ["host", "media"],
    },
  );
});

Deno.test("managed host avatar authorization returns through the resume marker", () => {
  const source = new URL(
    "https://atmosphereaccount.com/hosts/pds.example.social/manage?tab=profile",
  );
  assertAuthorizationHref(
    managedHostAuthorizationHref(
      HOST,
      hostProfileResumePath(source),
      ["host", "media"],
    ),
    {
      next:
        "/hosts/pds.example.social/manage?tab=profile&resume_host_profile=1",
      action: "host_manage",
      name: "Example PDS",
      capabilities: ["host", "media"],
    },
  );
});

function assertAuthorizationHref(
  href: string,
  expected: {
    next: string;
    action: string;
    name: string;
    capabilities: string[];
  },
): void {
  const url = new URL(href, "https://atmosphereaccount.com");
  assertEquals(url.pathname, "/signin");
  assertEquals(url.searchParams.get("next"), expected.next);
  assertEquals(url.searchParams.get("action"), expected.action);
  assertEquals(url.searchParams.get("name"), expected.name);
  assertEquals(
    url.searchParams.getAll("capability"),
    expected.capabilities,
  );
}
