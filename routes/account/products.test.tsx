import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import type { AccountHost } from "../../lib/account-hosts.ts";
import type { AppListing } from "../../lib/app-directory.ts";
import type { LoginApp } from "../../lib/atmosphere-login.ts";
import {
  ManagedAppCard,
  ManagedHostCard,
  ManagedProductsPage,
} from "./products.tsx";

const OWNER_DID = "did:plc:owner";
const APP = {
  id: "at://did:plc:owner/app.example.profile/skywriter",
  slug: "skywriter.example",
  name: "Skywriter",
  iconUrl: null,
  atstoreListingUri: "at://did:plc:owner/com.atproto.lexicon.schema/skywriter",
  profileDid: null,
  legacyProfileDid: null,
} as unknown as AppListing;
const HOST = {
  host: "pds.example.social",
  displayName: "Example PDS",
  avatarUrl: null,
  matchPatterns: [],
} as unknown as AccountHost;

const LOGIN_APP = {
  clientId: "https://skywriter.example/client-metadata.json",
  appName: "Skywriter login",
  appUri: "https://skywriter.example",
  logoUri: null,
  appDid: OWNER_DID,
  appProfileUri: APP.atstoreListingUri,
  appProfileSlug: APP.slug,
  linkStatus: "linked",
  identityAvailable: true,
  loginAvailability: "available",
  allowedReturnUris: ["https://skywriter.example/callback"],
  allowedOrigins: ["https://skywriter.example"],
  status: "unverified",
  reviewStatus: "none",
  reviewRequestedAt: null,
  reviewNotes: null,
  reviewDecisionAt: null,
  reviewDecisionBy: null,
  reviewDecisionReason: null,
  reviewRevision: "review-1",
  contactDid: OWNER_DID,
  preferredAccountHost: null,
  registered: true,
} satisfies LoginApp;

Deno.test("manage listings page separates profiles from developer settings", () => {
  const html = renderToString(
    <ManagedProductsPage
      account={{
        user: { did: OWNER_DID, handle: "owner.example" },
        hasManagedProfiles: true,
        accountType: "project",
        avatarUrl: null,
        publicProfileHandle: null,
        accountHost: null,
        rememberedAccounts: [],
      }}
      apps={[APP]}
      hosts={[]}
      loginApps={[LOGIN_APP]}
      appLinks={{}}
      hostLinks={{}}
      discoveredAtstoreCount={0}
      syncUnavailable={false}
      appAuthorized
      hostAuthorized
      managedApp={APP}
    />,
  );

  assertStringIncludes(html, "<h1>Manage listings</h1>");
  assertStringIncludes(html, "<h2>App profile</h2>");
  assertStringIncludes(html, "<h2>Host profiles</h2>");
  assertStringIncludes(html, "Developer settings");
  assertStringIncludes(html, "<h3>Login with Atmosphere</h3>");
  assertStringIncludes(html, "1 app");
  assertStringIncludes(html, "0 hosts");
  assertStringIncludes(html, "Manage environments");
  assertStringIncludes(html, "skywriter.example");
  assertEquals(html.includes("Skywriter login"), false);
  assertEquals(html.includes(">1 login registration<"), false);
  assertEquals(html.includes("Managed products"), false);
  assertEquals(html.includes("Owner workspace"), false);
});

Deno.test("a host-only account does not see Login with Atmosphere registration", () => {
  const html = renderToString(
    <ManagedProductsPage
      account={{
        user: { did: OWNER_DID, handle: "owner.example" },
        hasManagedProfiles: true,
        accountType: "user",
        avatarUrl: null,
        publicProfileHandle: null,
        accountHost: null,
        rememberedAccounts: [],
      }}
      apps={[]}
      hosts={[HOST]}
      loginApps={[LOGIN_APP]}
      appLinks={{}}
      hostLinks={{}}
      discoveredAtstoreCount={0}
      syncUnavailable={false}
      appAuthorized={false}
      hostAuthorized
      managedApp={null}
    />,
  );

  assertEquals(html.includes("Developer settings"), false);
  assertEquals(html.includes("Login with Atmosphere"), false);
  assertEquals(html.includes('href="/account/developer/apps"'), false);
});

Deno.test("a hidden existing app never enables another registration", () => {
  const html = renderToString(
    <ManagedProductsPage
      account={{
        user: { did: OWNER_DID, handle: "owner.example" },
        hasManagedProfiles: true,
        accountType: "project",
        avatarUrl: null,
        publicProfileHandle: null,
        accountHost: null,
        rememberedAccounts: [],
      }}
      apps={[]}
      hosts={[]}
      loginApps={[]}
      appLinks={{}}
      hostLinks={{}}
      discoveredAtstoreCount={0}
      syncUnavailable={false}
      appAuthorized
      hostAuthorized
      managedApp={APP}
    />,
  );

  assertStringIncludes(
    html,
    "This account already has an app profile, but it is not currently visible",
  );
  assertStringIncludes(html, "1 app");
  assertStringIncludes(html, "Manage your app");
  assertStringIncludes(
    html,
    `href="/apps/manage?app=${encodeURIComponent(APP.id)}"`,
  );
  assertEquals(html.includes("Register an app"), false);
  assertEquals(html.includes("Register another app"), false);
});

Deno.test("managed app card keeps view public and contextualizes app management", () => {
  const html = renderToString(
    <ManagedAppCard
      app={APP}
      links={[]}
      ownerDid={OWNER_DID}
      authorized={false}
      rememberedAccounts={[]}
      initialHandle="owner.example"
    />,
  );
  const hrefs = hrefsIn(html);

  assertEquals(hrefs[0], "/apps/skywriter.example");
  assertPermissionFallback(hrefs[1], {
    next: `/apps/manage?app=${encodeURIComponent(APP.id)}`,
    action: "app",
    capability: "app",
    name: APP.name,
  });
  assertPermissionFallback(hrefs[2], {
    next: `/apps/manage/host?app=${encodeURIComponent(APP.id)}`,
    action: "app",
    capability: "app",
    name: APP.name,
  });
});

Deno.test("authorized managed app card keeps direct management links", () => {
  const html = renderToString(
    <ManagedAppCard
      app={APP}
      links={[]}
      ownerDid={OWNER_DID}
      authorized
      rememberedAccounts={[]}
    />,
  );

  assertEquals(hrefsIn(html), [
    "/apps/skywriter.example",
    `/apps/manage?app=${encodeURIComponent(APP.id)}`,
    `/apps/manage/host?app=${encodeURIComponent(APP.id)}`,
  ]);
});

Deno.test("managed host card contextualizes each host-management destination", () => {
  const html = renderToString(
    <ManagedHostCard
      host={HOST}
      links={[]}
      authorized={false}
      rememberedAccounts={[]}
      initialHandle="owner.example"
    />,
  );
  const hrefs = hrefsIn(html);

  assertEquals(hrefs[0], "/hosts/pds.example.social");
  assertPermissionFallback(hrefs[1], {
    next: "/hosts/pds.example.social/manage",
    action: "host_manage",
    capability: "host",
    name: HOST.displayName,
  });
  assertPermissionFallback(hrefs[2], {
    next: "/hosts/pds.example.social/manage/apps",
    action: "host_manage",
    capability: "host",
    name: HOST.displayName,
  });
});

Deno.test("authorized managed host card keeps direct management links", () => {
  const html = renderToString(
    <ManagedHostCard
      host={HOST}
      links={[]}
      authorized
      rememberedAccounts={[]}
    />,
  );

  assertEquals(hrefsIn(html), [
    "/hosts/pds.example.social",
    "/hosts/pds.example.social/manage",
    "/hosts/pds.example.social/manage/apps",
  ]);
});

function hrefsIn(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
    match[1].replaceAll("&amp;", "&")
  );
}

function assertPermissionFallback(
  href: string,
  expected: {
    next: string;
    action: string;
    capability: string;
    name: string;
  },
): void {
  const url = new URL(href, "https://atmosphereaccount.com");
  assertEquals(url.pathname, "/signin");
  assertEquals(url.searchParams.get("next"), expected.next);
  assertEquals(url.searchParams.get("action"), expected.action);
  assertEquals(url.searchParams.getAll("capability"), [expected.capability]);
  assertEquals(url.searchParams.get("name"), expected.name);
}
