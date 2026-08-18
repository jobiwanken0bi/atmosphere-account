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

Deno.test("app hero gives privacy, terms, and scopes distinct icon actions", () => {
  const html = renderToString(
    <AppListingHero
      app={listing()}
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

  assertStringIncludes(html, 'aria-label="Privacy"');
  assertStringIncludes(html, 'aria-label="Terms"');
  assertStringIncludes(html, 'aria-label="Scopes"');
  assertStringIncludes(html, 'role="dialog"');
  assertStringIncludes(html, "App permissions");
  assertStringIncludes(html, "transition:generic");
  assertEquals(html.includes(">Privacy<"), false);
});

Deno.test("related app cards keep media and footer in normal flow", async () => {
  const css = await Deno.readTextFile(
    new URL("../../static/styles.css", import.meta.url),
  );
  assertStringIncludes(css, ".app-detail-related-grid .app-fresh-media");
  assertStringIncludes(css, ".app-detail-related-grid .app-fresh-footer");
  assertStringIncludes(css, "position: relative;");
});
