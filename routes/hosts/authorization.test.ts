import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import {
  ClaimedHostManagementLink,
  hostClaimAddAccountHref,
  hostClaimAuthorizationHref,
  hostClaimDetailHref,
} from "./[host]/claim.tsx";
import { hostDetailOutcomeNotice } from "./[host].tsx";
import { hostAuthorizationHref } from "./[host]/manage/apps.tsx";
import {
  hostProfileReauthorizationHref,
  managedHostAddAccountHref,
  managedHostAuthorizationHref,
  managedHostPublishFailure,
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

Deno.test("host claim authorization is contextual and identity-only", () => {
  const source = new URL(
    "https://atmosphereaccount.com/hosts/pds.example.social/claim?publish=1&from=detected",
  );
  assertAuthorizationHref(hostClaimAuthorizationHref(HOST, source), {
    next: "/hosts/pds.example.social/claim?publish=1&from=detected",
    action: "host_claim",
    name: "Example PDS",
    capabilities: ["identity"],
  });
});

Deno.test("host claim account replacement keeps its identity-only action context", () => {
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
      capabilities: ["identity"],
    },
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
    capabilities: ["identity"],
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

Deno.test("host avatar publication adds media to the host capability", () => {
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

Deno.test("managed host avatar authorization returns through the resume marker", () => {
  const source = new URL(
    "https://atmosphereaccount.com/hosts/pds.example.social/manage?tab=profile",
  );
  assertAuthorizationHref(
    hostProfileReauthorizationHref(
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
  const authorization = new URL(
    hostProfileReauthorizationHref(
      HOST,
      hostProfileResumePath(source),
      ["host", "media"],
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
