import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import type { AppListing } from "../../lib/app-directory.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import type { ProfileUpdateRow } from "../../lib/profile-updates.ts";
import { atmosphereStandardSiteUpdateSource } from "../../lib/standard-site-updates.ts";
import {
  AppListingDetailPage,
  AppListingHero,
  filterProfileUpdatesForApp,
  mergeProfileUpdateHistories,
  prioritizeProfileUpdates,
  profileUpdateDidsForAppDetail,
} from "./[handle].tsx";

function listing(overrides: Partial<AppListing> = {}): AppListing {
  return {
    id: "spark",
    slug: "spark",
    name: "Spark",
    description: "Real moments, shared together.",
    tagline: "Real moments",
    appStatus: null,
    primaryUrl: "https://sprk.so",
    iconUrl: null,
    heroUrl: null,
    heroFallbackUrl: null,
    screenshotUrls: [],
    links: [],
    tags: ["social"],
    platforms: [],
    categorySlugs: ["social"],
    lexicons: { produces: [], consumes: [] },
    accountIndicators: [],
    sourceRefs: {},
    canonicalSource: "atstore_listing",
    canonicalUri: "at://did:plc:spark/fyi.atstore.listing.detail/spark",
    productDid: null,
    profileDid: null,
    legacyProfileDid: null,
    accountHost: null,
    atstoreListingUri: "at://did:plc:spark/fyi.atstore.listing.detail/spark",
    migratedFromAtUri: null,
    communityProfileUri: null,
    communityEntryUri: null,
    reviewCount: 0,
    averageRating: null,
    favoriteCount: 0,
    mentionCount24h: 0,
    mentionCount7d: 0,
    trendingScore: null,
    publishedAt: null,
    updatedAt: 0,
    indexedAt: 0,
    ...overrides,
  };
}

function update(
  rkey: string,
  overrides: Partial<ProfileUpdateRow> = {},
): ProfileUpdateRow {
  return {
    uri: `at://did:plc:spark/site.standard.document/${rkey}`,
    cid: `cid-${rkey}`,
    rkey,
    projectDid: "did:plc:spark",
    title: `Update ${rkey}`,
    body: `Body ${rkey}`,
    version: null,
    tangledCommitUrl: null,
    tangledRepoUrl: null,
    source: "standard_site",
    status: "visible",
    createdAt: Date.UTC(2026, 7, 26),
    updatedAt: Date.UTC(2026, 7, 26),
    indexedAt: Date.UTC(2026, 7, 26),
    ...overrides,
  };
}

Deno.test("migrated app detail reads merge legacy and product update DIDs", () => {
  assertEquals(
    profileUpdateDidsForAppDetail(
      "did:plc:legacy-profile",
      "did:plc:product",
    ),
    ["did:plc:legacy-profile", "did:plc:product"],
  );
  assertEquals(
    profileUpdateDidsForAppDetail("did:plc:same", "did:plc:same"),
    ["did:plc:same"],
  );
  assertEquals(profileUpdateDidsForAppDetail(null, "did:plc:product"), [
    "did:plc:product",
  ]);
  assertEquals(profileUpdateDidsForAppDetail("did:plc:legacy", null), [
    "did:plc:legacy",
  ]);
  assertEquals(profileUpdateDidsForAppDetail(null, null), []);
});

Deno.test("app detail merges legacy and Standard.site history deterministically", () => {
  const legacy = update("legacy", {
    uri: "at://did:plc:legacy/com.atmosphereaccount.registry.update/legacy",
    projectDid: "did:plc:legacy",
    source: "manual",
    createdAt: Date.UTC(2026, 7, 20),
    indexedAt: Date.UTC(2026, 7, 20),
  });
  const standard = update("standard", {
    createdAt: Date.UTC(2026, 7, 21),
    indexedAt: Date.UTC(2026, 7, 21),
  });
  const staleDuplicate = update("standard", {
    title: "Stale duplicate",
    createdAt: standard.createdAt,
    indexedAt: standard.indexedAt - 1,
  });

  const merged = mergeProfileUpdateHistories([
    [legacy, staleDuplicate],
    [standard],
  ]);

  assertEquals(merged.map((row) => row.rkey), ["standard", "legacy"]);
  assertEquals(merged[0].title, standard.title);
});

Deno.test("app detail keeps generic updates but isolates Atmosphere app sources", () => {
  const appId = "app-spark";
  const generic = update("generic");
  const currentApp = update("current", {
    source: atmosphereStandardSiteUpdateSource(appId),
  });
  const otherApp = update("other", {
    source: atmosphereStandardSiteUpdateSource("another-app"),
  });
  const legacy = update("legacy", {
    uri: "at://did:plc:legacy/com.atmosphereaccount.registry.update/legacy",
    source: "manual",
  });

  assertEquals(
    filterProfileUpdatesForApp(
      [generic, currentApp, otherApp, legacy],
      appId,
    ).map((row) => row.rkey),
    ["generic", "current", "legacy"],
  );
});

Deno.test("requested app update moves first without dropping update history", () => {
  const updates = [update("one"), update("two"), update("three")];

  const prioritized = prioritizeProfileUpdates(updates, "three");

  assertEquals(prioritized.map((row) => row.rkey), ["three", "one", "two"]);
  assertEquals(updates.map((row) => row.rkey), ["one", "two", "three"]);
  assertEquals(
    prioritizeProfileUpdates(updates, "missing").map((row) => row.rkey),
    ["one", "two", "three"],
  );
});

Deno.test("requested update prefers the product Standard.site row over a legacy rkey collision", () => {
  const rkey = "3m4standardxx";
  const appId = "app-spark";
  const legacy = update(rkey, {
    uri: `at://did:plc:legacy/com.atmosphereaccount.registry.update/${rkey}`,
    projectDid: "did:plc:legacy",
    source: "manual",
  });
  const standard = update(rkey, {
    source: atmosphereStandardSiteUpdateSource(appId),
  });

  const prioritized = prioritizeProfileUpdates(
    [legacy, standard],
    rkey,
    { productDid: "did:plc:spark", appId },
  );

  assertEquals(prioritized.map((row) => row.uri), [
    standard.uri,
    legacy.uri,
  ]);
});

Deno.test("shared app listing renders its product updates in What's New", () => {
  const html = renderToString(
    <AppListingDetailPage
      app={listing({ productDid: "did:plc:spark" })}
      appPublicMetadata={{
        privacyUrl: null,
        termsUrl: null,
        scopes: [],
        oauthMetadataUrl: null,
      }}
      resolvedHostLink={null}
      relatedApps={[]}
      reviews={[]}
      ownReview={null}
      ownFavorite={null}
      reviewSort="newest"
      sourceAliases={[]}
      canInspectSources={false}
      updates={[update("release", {
        title: "Standard.site release",
        body: "Shared listing update body",
      })]}
      locale="en"
      signedInUser={null}
      account={buildAccountMenuProps({
        user: null,
        accountType: null,
        accountHost: null,
        rememberedAccounts: [],
      })}
      microblogViewerClientId={null}
      shareUrl="https://atmosphereaccount.com/apps/spark/"
      backNavigation={{ href: "/apps", label: "Back to apps" }}
    />,
  );

  assertStringIncludes(html, "What’s New");
  assertStringIncludes(html, "Standard.site release");
  assertStringIncludes(html, "Shared listing update body");
});

Deno.test("app hero groups profile, policy, and access actions in order", () => {
  const html = renderToString(
    <AppListingHero
      app={listing({
        productDid: "did:plc:spark",
        links: [{
          uri: "https://tangled.org/spark",
          label: "Tangled",
          role: "tangled",
        }],
      })}
      publicMetadata={{
        privacyUrl: "https://sprk.so/privacy",
        termsUrl: "https://sprk.so/terms",
        scopes: ["atproto", "transition:generic"],
        oauthMetadataUrl: "https://sprk.so/oauth-client-metadata.json",
      }}
      resolvedHostLink={null}
      microblogViewerClientId={null}
    />,
  );

  const profileStart = html.indexOf(
    'aria-labelledby="app-profile-actions-label"',
  );
  const policyStart = html.indexOf(
    'aria-labelledby="app-policy-actions-label"',
  );
  const accessStart = html.indexOf(
    'aria-labelledby="app-access-actions-label"',
  );

  assertEquals(profileStart >= 0, true);
  assertEquals(profileStart < policyStart, true);
  assertEquals(policyStart < accessStart, true);

  const profileGroup = html.slice(profileStart, policyStart);
  assertStringIncludes(profileGroup, 'id="app-profile-actions-label"');
  assertStringIncludes(profileGroup, ">Profiles<");
  assertStringIncludes(profileGroup, 'aria-label="Bluesky"');
  assertStringIncludes(profileGroup, 'aria-label="Tangled"');
  assertEquals(
    profileGroup.indexOf('aria-label="Bluesky"') <
      profileGroup.indexOf('aria-label="Tangled"'),
    true,
  );

  const policyGroup = html.slice(policyStart, accessStart);
  assertStringIncludes(policyGroup, 'id="app-policy-actions-label"');
  assertStringIncludes(policyGroup, ">Policies<");
  assertStringIncludes(policyGroup, 'aria-label="Privacy"');
  assertStringIncludes(policyGroup, 'aria-label="Terms"');
  assertStringIncludes(policyGroup, ">Privacy<");
  assertStringIncludes(policyGroup, ">Terms<");
  assertEquals(
    policyGroup.indexOf('aria-label="Privacy"') <
      policyGroup.indexOf('aria-label="Terms"'),
    true,
  );

  const accessGroup = html.slice(accessStart);
  assertStringIncludes(accessGroup, 'id="app-access-actions-label"');
  assertStringIncludes(accessGroup, ">App access<");
  assertStringIncludes(accessGroup, 'aria-label="Permissions"');
  assertStringIncludes(accessGroup, ">Permissions<");
  assertStringIncludes(accessGroup, 'role="region"');
  assertStringIncludes(
    accessGroup,
    'aria-labelledby="app-permissions-title"',
  );
  assertStringIncludes(accessGroup, "App permissions");
  assertStringIncludes(accessGroup, "transition:generic");
  assertEquals(html.includes('aria-label="Scopes"'), false);
  assertEquals(html.includes('role="dialog"'), false);
});

Deno.test("app hero does not render empty inline action groups", () => {
  const html = renderToString(
    <AppListingHero
      app={listing({
        primaryUrl: null,
        links: [],
        productDid: null,
      })}
      publicMetadata={{
        privacyUrl: "https://sprk.so/privacy",
        termsUrl: null,
        scopes: [],
        oauthMetadataUrl: null,
      }}
      resolvedHostLink={null}
      microblogViewerClientId={null}
    />,
  );

  assertStringIncludes(html, 'aria-labelledby="app-policy-actions-label"');
  assertStringIncludes(html, 'id="app-policy-actions-label"');
  assertEquals(html.includes('id="app-profile-actions-label"'), false);
  assertEquals(html.includes('id="app-access-actions-label"'), false);
});

Deno.test("app hero labels a fallback scopes link as Permissions", () => {
  const html = renderToString(
    <AppListingHero
      app={listing({
        primaryUrl: null,
        productDid: null,
        links: [{
          uri: "https://sprk.so/oauth-client-metadata.json",
          label: "OAuth client metadata",
          role: "oauth_metadata",
        }],
      })}
      publicMetadata={{
        privacyUrl: null,
        termsUrl: null,
        scopes: [],
        oauthMetadataUrl: null,
      }}
      resolvedHostLink={null}
      microblogViewerClientId={null}
    />,
  );

  assertStringIncludes(html, 'aria-labelledby="app-access-actions-label"');
  assertStringIncludes(html, 'id="app-access-actions-label"');
  assertStringIncludes(html, ">App access<");
  assertStringIncludes(
    html,
    'href="https://sprk.so/oauth-client-metadata.json"',
  );
  assertStringIncludes(html, 'aria-label="Permissions"');
  assertStringIncludes(html, 'title="Permissions"');
  assertStringIncludes(html, ">Permissions<");
  assertEquals(html.includes("OAuth client metadata"), false);
  assertEquals(html.includes('id="app-profile-actions-label"'), false);
  assertEquals(html.includes('id="app-policy-actions-label"'), false);
  assertEquals(html.includes('role="region"'), false);
});

Deno.test("app action groups stay usable at phone widths", async () => {
  const css = await Deno.readTextFile(
    new URL("../../static/styles.css", import.meta.url),
  );

  assertStringIncludes(css, '"inline-actions inline-actions"');
  assertStringIncludes(css, ".app-detail-inline-action-group--access");
  assertStringIncludes(css, "width: min(22rem, calc(100vw - 4rem));");
  assertStringIncludes(css, "min-height: 2.75rem;");
});

Deno.test("related app cards keep media and footer in normal flow", async () => {
  const css = await Deno.readTextFile(
    new URL("../../static/styles.css", import.meta.url),
  );
  assertStringIncludes(css, ".app-detail-related-grid .app-fresh-media");
  assertStringIncludes(css, ".app-detail-related-grid .app-fresh-footer");
  assertStringIncludes(css, "position: relative;");
});
