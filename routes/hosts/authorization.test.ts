import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import {
  ClaimedHostManagementLink,
  DnsOnlyHostClaimMethod,
  hostClaimAddAccountHref,
  hostClaimAuthorizationHref,
  hostClaimDetailHref,
  hostClaimHasLinkFailure,
  hostClaimManagementHref,
  hostClaimSwitchAccountHref,
  isSameDidHostClaimRepair,
  rejectLegacyHostClaimAction,
  stripLegacyHostClaimToken,
} from "./[host]/claim.tsx";
import { hostDetailOutcomeNotice } from "./[host].tsx";
import { hostAuthorizationHref } from "./[host]/manage/apps.tsx";
import {
  hostProfileReauthorizationHref,
  managedHostAddAccountHref,
  managedHostAuthorizationHref,
  managedHostPublishFailure,
  managedHostServiceEndpoint,
  managedHostTransferAuthorizationHref,
  managedHostTransferNextHref,
} from "./[host]/manage.tsx";
import { detectedHostClaimAuthorizationHref } from "./claim.tsx";
import {
  hostRegistrationAddAccountHref,
  hostRegistrationAuthorizationHref,
  hostRegistrationPublishFailure,
} from "./register.tsx";
import { hostProfileResumePath } from "../../lib/host-profile-resume.ts";
import { PdsBlobUploadError, PdsRecordWriteError } from "../../lib/pds.ts";

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

Deno.test("host claim authorization includes complete host management", () => {
  const source = new URL(
    "https://atmosphereaccount.com/hosts/pds.example.social/claim?publish=1&from=detected",
  );
  assertAuthorizationHref(hostClaimAuthorizationHref(HOST, source), {
    next: "/hosts/pds.example.social/claim?publish=1&from=detected",
    action: "host_claim",
    name: "Example PDS",
    capabilities: ["host"],
  });
});

Deno.test("production host claiming offers DNS only", () => {
  const html = renderToString(h(DnsOnlyHostClaimMethod, {}));
  assertStringIncludes(html, "Verify with DNS");
  assertStringIncludes(html, "temporary TXT record");
  assertStringIncludes(html, 'name="action" value="request_dns"');
  assertStringIncludes(html, "Show DNS record");
  assertEquals(html.toLowerCase().includes("email"), false);
  assertEquals(html.includes("request_email"), false);
});

Deno.test("legacy email host-claim actions are rejected", async () => {
  for (const action of ["request_email", "verify_email"]) {
    const response = rejectLegacyHostClaimAction(action);
    assertEquals(response?.status, 410);
    assertEquals(response?.headers.get("cache-control"), "no-store");
    assertStringIncludes(
      await response!.text(),
      "Email verification is no longer accepted",
    );
  }
  assertEquals(rejectLegacyHostClaimAction("request_dns"), null);
  assertEquals(rejectLegacyHostClaimAction("verify_dns"), null);
  assertEquals(rejectLegacyHostClaimAction("claim"), null);
});

Deno.test("legacy host-claim email links discard their token", () => {
  const response = stripLegacyHostClaimToken(
    new URL(
      "https://atmosphereaccount.com/hosts/pds.example.social/claim?token=secret-email-token&publish=0",
    ),
  );
  assertEquals(response?.status, 303);
  const location = new URL(
    response?.headers.get("location") ?? "",
    "https://atmosphereaccount.com",
  );
  assertEquals(location.searchParams.has("token"), false);
  assertEquals(location.searchParams.get("legacy_email"), "1");
  assertEquals(location.searchParams.get("publish"), "0");
  assertEquals(response?.headers.get("cache-control"), "no-store");
  assertEquals(response?.headers.get("referrer-policy"), "no-referrer");
  assertEquals(
    stripLegacyHostClaimToken(
      new URL(
        "https://atmosphereaccount.com/hosts/pds.example.social/claim",
      ),
    ),
    null,
  );
});

Deno.test("host claim account replacement keeps its management context", () => {
  assertAuthorizationHref(
    hostClaimAddAccountHref(
      HOST,
      "/hosts/pds.example.social/claim?publish=0&from=detected",
    ),
    {
      entryPath: "/oauth/add-account",
      next: "/hosts/pds.example.social/claim?publish=0&from=detected",
      action: "host_claim",
      name: "Example PDS",
      capabilities: ["host"],
    },
  );
});

Deno.test("host claim account recovery keeps its DNS challenge", () => {
  assertAuthorizationHref(
    hostClaimSwitchAccountHref(
      HOST,
      null,
      false,
      true,
      null,
      "dns-challenge-token",
    ),
    {
      entryPath: "/oauth/add-account",
      next:
        "/hosts/pds.example.social/claim?publish=0&dns_token=dns-challenge-token&from=detected",
      action: "host_claim",
      name: "Example PDS",
      capabilities: ["host"],
    },
  );
});

Deno.test("host manager replacement keeps transfer-specific login copy", () => {
  const next =
    "/hosts/pds.example.social/claim?transfer_intent=opaque&dns_token=dns-challenge-token";
  assertAuthorizationHref(
    hostClaimAddAccountHref(HOST, next, "host_transfer"),
    {
      entryPath: "/oauth/add-account",
      next,
      action: "host_transfer",
      name: "Example PDS",
      capabilities: ["host"],
    },
  );
});

Deno.test("only the same DID can repair its stale host claim", () => {
  const claim = { claimantDid: "did:plc:owner" };
  assertEquals(
    isSameDidHostClaimRepair(claim, null, "did:plc:owner"),
    true,
  );
  assertEquals(
    isSameDidHostClaimRepair(claim, "did:plc:owner", "did:plc:owner"),
    false,
  );
  assertEquals(
    isSameDidHostClaimRepair(claim, null, "did:plc:other"),
    false,
  );
  assertEquals(
    isSameDidHostClaimRepair(claim, null, "did:plc:owner", true),
    false,
  );
});

Deno.test("expired app-link state remains visible through DNS retries", () => {
  assertEquals(
    hostClaimHasLinkFailure(
      new URL(
        "https://atmosphereaccount.com/hosts/pds.example.social/claim?linkError=1&dns_token=token",
      ),
    ),
    true,
  );
  assertEquals(
    hostClaimHasLinkFailure(
      new URL(
        "https://atmosphereaccount.com/hosts/pds.example.social/claim",
      ),
      true,
    ),
    true,
  );
});

Deno.test("host claim outcomes land on public detail with their notices intact", () => {
  assertEquals(
    hostClaimDetailHref(HOST, { claimed: true }),
    "/hosts/pds.example.social?claimed=1",
  );
  assertEquals(
    hostClaimDetailHref(HOST, { claimed: true, linked: true }),
    "/hosts/pds.example.social?claimed=1&linked=1",
  );
  assertEquals(
    hostClaimDetailHref(HOST, { claimed: true, linkError: true }),
    "/hosts/pds.example.social?claimed=1&linkError=1",
  );

  assertEquals(
    hostDetailOutcomeNotice(
      new URL(
        "https://atmosphereaccount.com/hosts/pds.example.social?claimed=1",
      ),
    ),
    { kind: "ok", text: "Host claimed successfully." },
  );
  assertEquals(
    hostDetailOutcomeNotice(
      new URL(
        "https://atmosphereaccount.com/hosts/pds.example.social?claimed=1&linked=1",
      ),
    ),
    { kind: "ok", text: "Host claimed and connected to the app successfully." },
  );
  assertEquals(
    hostDetailOutcomeNotice(
      new URL(
        "https://atmosphereaccount.com/hosts/pds.example.social?claimed=1&linkError=1",
      ),
    ),
    {
      kind: "error",
      text:
        "Host claimed, but the app connection could not be completed. Ask the app owner to start a new connection from app hosting.",
    },
  );
});

Deno.test("successful host verification continues directly to management", () => {
  assertEquals(
    hostClaimManagementHref(HOST, { claimed: true }),
    "/hosts/pds.example.social/manage?claimed=1",
  );
  assertEquals(
    hostClaimManagementHref(HOST, { claimed: true, linked: true }),
    "/hosts/pds.example.social/manage?claimed=1&linked=1",
  );
  assertEquals(
    hostClaimManagementHref(HOST, { claimed: true, linkError: true }),
    "/hosts/pds.example.social/manage?claimed=1&linkError=1",
  );
  assertEquals(
    hostClaimManagementHref(HOST, { claimed: true, dnsVerified: true }),
    "/hosts/pds.example.social/manage?claimed=1&dns=1",
  );
  assertEquals(
    hostClaimManagementHref(HOST, {
      claimed: true,
      dnsVerified: true,
      transferred: true,
    }),
    "/hosts/pds.example.social/manage?claimed=1&dns=1&transferred=1",
  );
});

Deno.test("host manager transfer preserves the sole owner's listing choice", () => {
  const token = "v1.payload.signature";
  const hidden = new URL(
    managedHostTransferNextHref(
      { ...HOST, operatorListingOptIn: false },
      token,
    ),
    "https://atmosphereaccount.com",
  );
  assertEquals(hidden.pathname, "/hosts/pds.example.social/claim");
  assertEquals(hidden.searchParams.get("transfer_intent"), token);
  assertEquals(hidden.searchParams.get("publish"), "0");

  const listed = new URL(
    managedHostTransferNextHref(
      { ...HOST, operatorListingOptIn: true },
      token,
    ),
    "https://atmosphereaccount.com",
  );
  assertEquals(listed.searchParams.get("publish"), "1");
});

Deno.test("host manager transfer uses dedicated account-choice copy", () => {
  const next = "/hosts/pds.example.social/claim?transfer_intent=opaque";
  assertAuthorizationHref(
    managedHostTransferAuthorizationHref(HOST, next),
    {
      next,
      action: "host_transfer",
      name: "Example PDS",
      capabilities: ["host"],
    },
  );
});

Deno.test("claimed host management is contextual until host access is ready", () => {
  const account = {
    user: { did: "did:plc:owner", handle: "owner.example" },
    accountType: null,
    avatarUrl: null,
    publicProfileHandle: null,
    accountHost: null,
    rememberedAccounts: [{
      did: "did:plc:owner",
      handle: "owner.example",
    }],
  };
  const contextual = renderToString(
    h(ClaimedHostManagementLink, {
      host: HOST,
      authorized: false,
      account,
    }),
  );
  const fallback = new URL(
    firstHref(contextual),
    "https://atmosphereaccount.com",
  );
  assertEquals(fallback.pathname, "/signin");
  assertEquals(
    fallback.searchParams.get("next"),
    "/hosts/pds.example.social/manage",
  );
  assertEquals(fallback.searchParams.get("action"), "host_manage");
  assertEquals(fallback.searchParams.getAll("capability"), ["host"]);
  assertEquals(fallback.searchParams.get("name"), "Example PDS");
  assertStringIncludes(contextual, 'aria-haspopup="dialog"');

  const authorized = renderToString(
    h(ClaimedHostManagementLink, {
      host: HOST,
      authorized: true,
      account,
    }),
  );
  assertEquals(firstHref(authorized), "/hosts/pds.example.social/manage");
  assertEquals(authorized.includes("/signin?"), false);
  assertEquals(authorized.includes('aria-haspopup="dialog"'), false);
});

Deno.test("detected host claim preserves its lookup deep link", () => {
  const source = new URL(
    "https://atmosphereaccount.com/hosts/claim?domain=pds.example.social&from=directory",
  );
  assertAuthorizationHref(detectedHostClaimAuthorizationHref(source), {
    next: "/hosts/claim?domain=pds.example.social&from=directory",
    action: "host_claim",
    name: "pds.example.social",
    capabilities: ["host"],
  });
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
      capabilities: ["host"],
    },
  );

  const appsUrl = new URL(
    "https://atmosphereaccount.com/hosts/pds.example.social/manage/apps?saved=1",
  );
  assertAuthorizationHref(hostAuthorizationHref(HOST, appsUrl), {
    next: "/hosts/pds.example.social/manage/apps?saved=1",
    action: "host_manage",
    name: "Example PDS",
    capabilities: ["host"],
  });
});

Deno.test("host management account replacement keeps host permission context", () => {
  assertAuthorizationHref(
    managedHostAddAccountHref(
      HOST,
      "/hosts/pds.example.social/manage?tab=routes",
    ),
    {
      entryPath: "/oauth/add-account",
      next: "/hosts/pds.example.social/manage?tab=routes",
      action: "host_manage",
      name: "Example PDS",
      capabilities: ["host"],
    },
  );
});

Deno.test("host publication uses the complete host capability", () => {
  const source = new URL(
    "https://atmosphereaccount.com/hosts/register?host=local-pds.test&link_intent=opaque",
  );
  assertAuthorizationHref(
    hostRegistrationAuthorizationHref(
      source,
      ["host"],
      "Local PDS",
    ),
    {
      next: "/hosts/register?host=local-pds.test&link_intent=opaque",
      action: "host_manage",
      name: "Local PDS",
      capabilities: ["host"],
    },
  );
});

Deno.test("host publishing failures never expose PDS response bodies", () => {
  const secret = "upstream-secret-body-and-request-id";
  const recordError = new PdsRecordWriteError(
    "putRecord",
    502,
    secret,
  );
  const avatarError = new PdsBlobUploadError(502, secret);
  const failures = [
    hostRegistrationPublishFailure("avatar", avatarError),
    hostRegistrationPublishFailure("record", recordError),
    managedHostPublishFailure("profile", recordError),
    managedHostPublishFailure("settings", recordError),
    managedHostPublishFailure("avatar", avatarError),
  ];

  assertEquals(
    failures.map((failure) => failure.message),
    [
      "We couldn't upload the host avatar. Try again.",
      "We couldn't publish this host. Try again.",
      "We couldn't publish the host profile. Try again.",
      "We couldn't publish the host settings. Try again.",
      "We couldn't upload the host avatar. Try again.",
    ],
  );
  assertEquals(
    failures.some((failure) => JSON.stringify(failure).includes(secret)),
    false,
  );

  const permissionFailure = hostRegistrationPublishFailure(
    "record",
    new PdsRecordWriteError(
      "putRecord",
      403,
      JSON.stringify({ error: "ScopeMissingError", detail: secret }),
    ),
  );
  assertEquals(permissionFailure.reauthorization, true);
  assertEquals(permissionFailure.message.includes(secret), false);

  const forgedPermissionText = managedHostPublishFailure(
    "settings",
    new Error(`putRecord failed: HTTP 403: ${secret}`),
  );
  assertEquals(forgedPermissionText.reauthorization, false);
  assertEquals(forgedPermissionText.message.includes(secret), false);
});

Deno.test("host registration account replacement keeps its registration deep link", () => {
  assertAuthorizationHref(
    hostRegistrationAddAccountHref(
      "/hosts/register?link_intent=opaque&host=local-pds.test",
      "Local PDS",
    ),
    {
      entryPath: "/oauth/add-account",
      next: "/hosts/register?link_intent=opaque&host=local-pds.test",
      action: "host_manage",
      name: "Local PDS",
      capabilities: ["host"],
    },
  );
});

Deno.test("managed host authorization returns through the resume marker", () => {
  const source = new URL(
    "https://atmosphereaccount.com/hosts/pds.example.social/manage?tab=profile",
  );
  assertAuthorizationHref(
    hostProfileReauthorizationHref(
      HOST,
      hostProfileResumePath(source),
      ["host"],
    ),
    {
      next:
        "/hosts/pds.example.social/manage?tab=profile&resume_host_profile=1",
      action: "host_manage",
      name: "Example PDS",
      capabilities: ["host"],
    },
  );
  const authorization = new URL(
    hostProfileReauthorizationHref(
      HOST,
      hostProfileResumePath(source),
      ["host"],
    ),
    "https://atmosphereaccount.com",
  );
  assertEquals(authorization.searchParams.get("permission"), "required");
});

function assertAuthorizationHref(
  href: string,
  expected: {
    entryPath?: string;
    next: string;
    action: string;
    name: string;
    capabilities: string[];
  },
): void {
  const url = new URL(href, "https://atmosphereaccount.com");
  assertEquals(url.pathname, expected.entryPath ?? "/signin");
  assertEquals(url.searchParams.get("next"), expected.next);
  assertEquals(url.searchParams.get("action"), expected.action);
  assertEquals(url.searchParams.get("name"), expected.name);
  assertEquals(
    url.searchParams.getAll("capability"),
    expected.capabilities,
  );
}

function firstHref(html: string): string {
  const href = html.match(/href="([^"]+)"/)?.[1];
  if (!href) throw new Error(`Expected an href in ${html}`);
  return href.replaceAll("&amp;", "&");
}
