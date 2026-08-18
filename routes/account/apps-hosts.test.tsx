import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import type { AccountHost } from "../../lib/account-hosts.ts";
import type { AppListing } from "../../lib/app-directory.ts";
import type { DirectoryEntityAppLink } from "../../lib/directory-entity-links.ts";
import {
  appsHostsAccessRedirect,
  appsHostsIntro,
  AppsHostsPage,
  hasManagedProfiles,
  ManagedAppCard,
  ManagedHostCard,
  redirect,
} from "./apps-hosts.tsx";

const APP = {
  id: "app-one",
  slug: "skywriter.example",
  name: "Skywriter",
  iconUrl: null,
  atstoreListingUri: "at://did:plc:owner/fyi.atstore.app/one",
  profileDid: null,
  legacyProfileDid: null,
} as unknown as AppListing;

const HOST = {
  host: "pds.example.social",
  displayName: "Example PDS",
  avatarUrl: null,
  matchPatterns: [],
} as unknown as AccountHost;

const PENDING_LINK = {
  host: HOST.host,
  appListingId: APP.id,
  relationship: "same_operator",
  status: "pending",
  source: "claimed",
  hostOwnerDid: "did:plc:host",
  appOwnerDid: "did:plc:owner",
  hostApprovedAt: Date.now(),
  appApprovedAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  appSlug: APP.slug,
  appName: APP.name,
  hostDisplayName: HOST.displayName,
} satisfies DirectoryEntityAppLink;

const ACCOUNT = {
  user: { did: "did:plc:owner", handle: "owner.example" },
  hasManagedAppProfile: true,
  hasManagedHostProfiles: false,
  hasManagedProfiles: true,
  accountType: "project" as const,
  avatarUrl: null,
  publicProfileHandle: null,
  accountHost: null,
  rememberedAccounts: [],
};

Deno.test("Apps and hosts is only available to profile-managing accounts", () => {
  assertEquals(hasManagedProfiles([], []), false);
  assertEquals(hasManagedProfiles([APP], []), true);
  assertEquals(hasManagedProfiles([], [HOST]), true);
  assertEquals(appsHostsAccessRedirect([], []), "/account");
  assertEquals(appsHostsAccessRedirect([APP], []), null);
  const response = redirect("/account");
  assertEquals(response.headers.get("cache-control"), "no-store");
});

Deno.test("app managers see their app profile and developer settings only", () => {
  const html = renderToString(
    <AppsHostsPage
      account={ACCOUNT}
      apps={[APP]}
      hosts={[]}
      loginApps={[]}
      appLinks={{}}
      hostLinks={{}}
      discoveredAtstoreCount={0}
      syncUnavailable={false}
    />,
  );

  assertStringIncludes(html, "<h1>Apps and hosts</h1>");
  assertStringIncludes(
    html,
    "Manage this account’s app profile, connected hosts, and developer settings.",
  );
  assertStringIncludes(
    html,
    '<main class="account-products-section" id="main-content">',
  );
  assertStringIncludes(html, "<h2>App profile</h2>");
  assertStringIncludes(html, "account-products-grid--single");
  assertStringIncludes(html, "account-product-card--single-profile");
  assertStringIncludes(html, "<h2>Login with Atmosphere</h2>");
  assertEquals(html.includes("<h2>Host profiles</h2>"), false);
  assertEquals(html.includes("Register another app"), false);
  assertEquals(html.includes("Claim detected PDS"), false);
  assertEquals(html.includes("Managed products"), false);
  assertStringIncludes(
    html,
    'class="account-product-action--primary" href="/apps/manage?app=app-one"',
  );
});

Deno.test("host-only managers do not see app or developer settings", () => {
  const html = renderToString(
    <AppsHostsPage
      account={{ ...ACCOUNT, accountType: "user" }}
      apps={[]}
      hosts={[HOST]}
      loginApps={[]}
      appLinks={{}}
      hostLinks={{}}
      discoveredAtstoreCount={0}
      syncUnavailable={false}
    />,
  );

  assertStringIncludes(html, "<h2>Host profiles</h2>");
  assertStringIncludes(html, "account-products-grid--single");
  assertStringIncludes(html, "account-product-card--single-profile");
  assertStringIncludes(html, "account-product-card-content");
  assertStringIncludes(
    html,
    "Manage the host profiles operated by this account and their app connections.",
  );
  assertEquals(html.includes("<h2>App profile</h2>"), false);
  assertEquals(html.includes("Developer settings"), false);
  assertEquals(html.includes("Login with Atmosphere"), false);
  assertEquals(html.includes("Claim detected PDS"), false);
});

Deno.test("Apps and hosts intro follows the profiles the account manages", () => {
  assertEquals(
    appsHostsIntro(1, 1),
    "Manage this account’s app and host profiles, their connections, and developer settings.",
  );
  assertEquals(
    appsHostsIntro(1, 0),
    "Manage this account’s app profile, connected hosts, and developer settings.",
  );
  assertEquals(
    appsHostsIntro(0, 2),
    "Manage the host profiles operated by this account and their app connections.",
  );
});

Deno.test("managed profile card actions align as full touch targets", async () => {
  const styles = await Deno.readTextFile(
    new URL("../../static/styles.css", import.meta.url),
  );
  assertStringIncludes(
    styles,
    `.account-product-actions a,
.account-products-login-list a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.75rem;`,
  );
  assertStringIncludes(
    styles,
    `.account-product-actions .account-product-action--primary {`,
  );
  assertStringIncludes(
    styles,
    `.account-product-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);`,
  );
});

Deno.test("legacy multi-app accounts cannot enter a looping developer link", () => {
  const html = renderToString(
    <AppsHostsPage
      account={ACCOUNT}
      apps={[APP, { ...APP, id: "app-two", slug: "second.example" }]}
      hosts={[]}
      loginApps={[]}
      appLinks={{}}
      hostLinks={{}}
      discoveredAtstoreCount={0}
      syncUnavailable={false}
    />,
  );

  assertStringIncludes(html, "Login with Atmosphere needs one app");
  assertEquals(html.includes('href="/account/developer/apps"'), false);
});

Deno.test("pending relationships are never described as connected", () => {
  const appHtml = renderToString(
    <ManagedAppCard
      app={APP}
      links={[PENDING_LINK]}
      ownerDid="did:plc:owner"
    />,
  );
  const hostHtml = renderToString(
    <ManagedHostCard host={HOST} links={[PENDING_LINK]} />,
  );

  assertStringIncludes(appHtml, "1 pending host");
  assertStringIncludes(appHtml, `Pending: ${HOST.displayName}`);
  assertEquals(appHtml.includes("connected host"), false);
  assertStringIncludes(hostHtml, "1 pending app");
  assertStringIncludes(hostHtml, `Pending: ${APP.name}`);
  assertEquals(hostHtml.includes("connected app"), false);
});
