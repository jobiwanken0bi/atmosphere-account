import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import type { AppListing } from "../../lib/app-directory.ts";
import { AppListingHero } from "./[handle].tsx";

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
