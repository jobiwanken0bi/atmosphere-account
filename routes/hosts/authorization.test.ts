import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hostClaimAuthorizationHref,
  hostClaimDnsRequestAllowed,
  hostClaimExpiredLinkContinuationPathForTest,
  hostClaimFailureStatus,
  hostClaimIntroCopy,
  hostClaimManageLocation,
} from "./[host]/claim.tsx";
import { hostAuthorizationHref } from "./[host]/manage/apps.tsx";
import {
  managedHostAuthorizationHref,
  managedHostSaveLocation,
  managedHostServiceEndpoint,
  managedHostTransferAuthorizationHref,
  managedHostTransferNextHref,
} from "./[host]/manage.tsx";
import { detectedHostClaimAuthorizationHref } from "./claim.tsx";
import { hostRegistrationAuthorizationHref } from "./register.tsx";
import { hostProfileResumePath } from "../../lib/host-profile-resume.ts";
import {
  hostClaimActionAvailable,
  hostDnsRecoveryActionAvailable,
} from "./[host].tsx";

const HOST = { host: "pds.example.social", displayName: "Example PDS" };

Deno.test("managed host endpoints come from the listed PDS, not its manager", () => {
  assertEquals(
    managedHostServiceEndpoint({ host: "sprk.so", serviceEndpoint: null }),
    "https://sprk.so",
  );
  assertEquals(
    managedHostServiceEndpoint({
      host: "example.social",
      serviceEndpoint: "https://pds.example.social/",
    }),
    "https://pds.example.social",
  );
  assertEquals(
    managedHostServiceEndpoint({
      host: "bsky.network",
      serviceEndpoint: null,
    }),
    "https://bsky.social",
  );
});

Deno.test("host management saves return to the same settings section", () => {
  assertEquals(
    managedHostSaveLocation(HOST, "directory"),
    "/hosts/pds.example.social/manage?saved=directory#directory-visibility",
  );
  assertEquals(
    managedHostSaveLocation(HOST, "signup"),
    "/hosts/pds.example.social/manage?saved=signup#signup",
  );
  assertEquals(
    managedHostSaveLocation(HOST, "profile"),
    "/hosts/pds.example.social/manage?saved=profile#public-profile",
  );
  assertEquals(
    managedHostSaveLocation(HOST, "account"),
    "/hosts/pds.example.social/manage?saved=account#account-links",
  );
  assertEquals(
    managedHostSaveLocation(HOST, "advanced"),
    "/hosts/pds.example.social/manage?saved=advanced#advanced-settings",
  );
});

Deno.test("host claim failures expose retryable HTTP semantics", () => {
  assertEquals(hostClaimFailureStatus("record_not_found"), 409);
  assertEquals(hostClaimFailureStatus("expired"), 409);
  assertEquals(hostClaimFailureStatus("account_mismatch"), 409);
  assertEquals(hostClaimFailureStatus("dns_unavailable"), 503);
  assertEquals(hostClaimFailureStatus("already_claimed"), 409);
  assertEquals(hostClaimFailureStatus("dns_required"), 409);
  assertEquals(hostClaimFailureStatus("not_authorized"), 403);
});

Deno.test("only hosts without verified ownership offer a claim action", () => {
  assertEquals(
    hostClaimActionAvailable({ verificationStatus: "observed" }, null),
    true,
  );
  assertEquals(
    hostClaimActionAvailable({ verificationStatus: "claimed" }, null),
    false,
  );
  assertEquals(
    hostClaimActionAvailable({ verificationStatus: "verified" }, null),
    false,
  );
  assertEquals(
    hostClaimActionAvailable(
      { verificationStatus: "observed" },
      {
        host: HOST.host,
        claimantDid: "did:plc:owner",
        claimantHandle: "owner.example",
        method: "dns_txt",
        claimedAt: 1,
        verifiedAt: 1,
        updatedAt: 1,
      },
    ),
    false,
  );
});

Deno.test("email-derived ownership exposes DNS recovery to a different account", () => {
  const emailClaim = {
    host: HOST.host,
    claimantDid: "did:plc:emailowner",
    claimantHandle: "email-owner.example",
    method: "pds_contact_email" as const,
    claimedAt: 1,
    verifiedAt: 1,
    updatedAt: 1,
  };
  assertEquals(
    hostDnsRecoveryActionAvailable(
      emailClaim,
      emailClaim.claimantDid,
      "did:plc:newdnsowner",
    ),
    true,
  );
  assertEquals(
    hostDnsRecoveryActionAvailable(
      emailClaim,
      emailClaim.claimantDid,
      emailClaim.claimantDid,
    ),
    false,
  );
  assertEquals(
    hostDnsRecoveryActionAvailable(
      { ...emailClaim, method: "dns_txt" },
      emailClaim.claimantDid,
      "did:plc:newdnsowner",
    ),
    false,
  );
});

Deno.test("email-derived owners can strengthen or recover ownership with DNS", () => {
  const emailClaim = {
    host: HOST.host,
    claimantDid: "did:plc:emailowner",
    claimantHandle: "email-owner.example",
    method: "pds_contact_email" as const,
    claimedAt: 1,
    verifiedAt: 1,
    updatedAt: 1,
  };
  assertEquals(
    hostClaimDnsRequestAllowed({
      claim: emailClaim,
      verifiedOwnerDid: emailClaim.claimantDid,
      currentDid: emailClaim.claimantDid,
      transferPreviousOwnerDid: null,
      pendingRecoveryRequesterDid: "did:plc:newdnsowner",
    }),
    true,
  );
  assertEquals(
    hostClaimDnsRequestAllowed({
      claim: emailClaim,
      verifiedOwnerDid: emailClaim.claimantDid,
      currentDid: "did:plc:newdnsowner",
      transferPreviousOwnerDid: null,
      pendingRecoveryRequesterDid: null,
    }),
    true,
  );
  assertEquals(
    hostClaimDnsRequestAllowed({
      claim: emailClaim,
      verifiedOwnerDid: emailClaim.claimantDid,
      currentDid: "did:plc:competingowner",
      transferPreviousOwnerDid: null,
      pendingRecoveryRequesterDid: "did:plc:newdnsowner",
      pendingRecoveryEligibleAt: 200,
      now: 200,
    }),
    false,
  );
  assertEquals(
    hostClaimDnsRequestAllowed({
      claim: emailClaim,
      verifiedOwnerDid: emailClaim.claimantDid,
      currentDid: "did:plc:newdnsowner",
      transferPreviousOwnerDid: null,
      pendingRecoveryRequesterDid: "did:plc:newdnsowner",
      pendingRecoveryEligibleAt: 200,
      now: 199,
    }),
    false,
  );
  assertEquals(
    hostClaimDnsRequestAllowed({
      claim: emailClaim,
      verifiedOwnerDid: emailClaim.claimantDid,
      currentDid: "did:plc:newdnsowner",
      transferPreviousOwnerDid: null,
      pendingRecoveryRequesterDid: "did:plc:newdnsowner",
      pendingRecoveryEligibleAt: 200,
      now: 200,
    }),
    true,
  );
  assertEquals(
    hostClaimDnsRequestAllowed({
      claim: { ...emailClaim, method: "dns_txt" },
      verifiedOwnerDid: emailClaim.claimantDid,
      currentDid: emailClaim.claimantDid,
      transferPreviousOwnerDid: null,
    }),
    false,
  );
  assertEquals(
    hostClaimDnsRequestAllowed({
      claim: { ...emailClaim, method: "oauth_atproto_account" },
      verifiedOwnerDid: null,
      currentDid: emailClaim.claimantDid,
      transferPreviousOwnerDid: null,
    }),
    true,
  );
});

Deno.test("host claim intro copy follows the current ownership state", () => {
  assertEquals(
    hostClaimIntroCopy({ state: "ready" }),
    "This local .test fixture uses the development claim path. Once claimed, this Atmosphere account can manage its public profile and images.",
  );
  assertEquals(
    hostClaimIntroCopy({
      state: "ready",
      claimProofMethod: "atproto_handle",
      host: HOST.host,
    }),
    "Your verified handle exactly matches pds.example.social, so no additional verification is needed.",
  );
  assertEquals(
    hostClaimIntroCopy({ state: "claimed-by-other" }),
    "This host already has a verified managing account.",
  );
  assertEquals(
    hostClaimIntroCopy({
      state: "claimed-by-you",
      linkAppName: "Field Notes",
    }),
    "This account already manages this host. You can connect it to Field Notes below.",
  );
  assertEquals(
    hostClaimIntroCopy({ state: "verification", transferring: true }),
    "The new managing account must prove control of this host with DNS before anything changes.",
  );
  assertEquals(
    hostClaimIntroCopy({
      state: "dns",
      emailClaimDnsPurpose: "recover",
    }),
    "Use DNS to prove current control. The existing manager stays in control during the 48-hour review period.",
  );
  assertEquals(
    hostClaimIntroCopy({
      state: "dns",
      emailClaimDnsPurpose: "strengthen",
    }),
    "Strengthen this email-verified claim with DNS ownership proof.",
  );
});

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

Deno.test("identity-proved claims do not show DNS completion copy", () => {
  assertEquals(
    hostClaimManageLocation(HOST.host, false, false, false),
    "/hosts/pds.example.social/manage?claimed=1",
  );
});

Deno.test("email-derived claims get a DNS-strengthening completion state", () => {
  assertEquals(
    hostClaimManageLocation(HOST.host, false, false, true, true),
    "/hosts/pds.example.social/manage?strengthened=1&dns=1",
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
