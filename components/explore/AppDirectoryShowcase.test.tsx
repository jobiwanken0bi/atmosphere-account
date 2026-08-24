import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { AppListing } from "../../lib/app-directory.ts";
import {
  AppCategoryGrid,
  AppDirectoryAvailability,
  AppSpotlight,
} from "./AppDirectoryShowcase.tsx";

function appListing(
  overrides: Partial<AppListing> & Pick<AppListing, "id" | "slug" | "name">,
): AppListing {
  return {
    description: "",
    tagline: "",
    appStatus: null,
    primaryUrl: null,
    iconUrl: null,
    heroUrl: null,
    heroFallbackUrl: null,
    screenshotUrls: [],
    links: [],
    tags: [],
    platforms: [],
    categorySlugs: [],
    lexicons: { produces: [], consumes: [] },
    accountIndicators: [],
    sourceRefs: {},
    canonicalSource: "test",
    canonicalUri: `at://did:plc:test/app/${overrides.id}`,
    productDid: null,
    profileDid: null,
    legacyProfileDid: null,
    accountHost: null,
    atstoreListingUri: null,
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

Deno.test("app directory explains when cards are unavailable", () => {
  const html = renderToString(h(AppDirectoryAvailability, {
    hasCards: false,
  }));

  assertStringIncludes(html, "Apps aren’t available right now.");
  assertStringIncludes(html, "Try again in a moment.");
});

Deno.test("app directory omits the unavailable state when cards exist", () => {
  const html = renderToString(h(AppDirectoryAvailability, {
    hasCards: true,
  }));

  assertEquals(html, "");
});

Deno.test("app collection tiles keep the name and count in one copy stack", () => {
  const html = renderToString(h(AppCategoryGrid, {
    tags: [{ tag: "social", count: 5 }],
  }));

  assertStringIncludes(html, 'class="app-category-copy"');
  assertStringIncludes(
    html,
    '<span class="app-category-name">Social</span><span class="app-category-count">5 apps</span>',
  );
});

Deno.test("limited collection tiles opt into even responsive rows", () => {
  const tags = Array.from({ length: 9 }, (_, index) => ({
    tag: `collection-${index + 1}`,
    count: index + 1,
  }));
  const html = renderToString(h(AppCategoryGrid, { tags, balanced: true }));

  assertStringIncludes(
    html,
    'class="app-category-grid app-category-grid--balanced"',
  );
});

Deno.test("featured apps preserve curator order in the shared media-card layout", () => {
  const first = appListing({
    id: "first",
    slug: "curator-first",
    name: "Curator first",
    description: "The curator-selected app description.",
    heroUrl: "https://cdn.example/featured-square.png",
    tags: ["community"],
    categorySlugs: ["social"],
    reviewCount: 2,
    averageRating: 4.5,
  });
  const second = appListing({
    id: "second",
    slug: "media-first",
    name: "Media first",
    heroUrl: "https://cdn.example/featured-wide.png",
  });
  const html = renderToString(h(AppSpotlight, { apps: [first, second] }));

  assertStringIncludes(
    html,
    'class="glass app-fresh-card app-fresh-card--spotlight" href="/apps/curator-first"',
  );
  assertStringIncludes(html, 'class="app-fresh-media"');
  assertStringIncludes(html, 'class="app-fresh-footer"');
  assertStringIncludes(html, 'width="1200" height="630"');
  assertStringIncludes(html, "Curator first");
  assertStringIncludes(html, "4.5 from 2 reviews");
  assertEquals(html.includes("app-spotlight-card"), false);
  assertEquals(html.includes("app-spotlight-media"), false);
});

Deno.test("featured hero, screenshot, and icon media share one safe card", () => {
  const variants = [
    appListing({
      id: "hero",
      slug: "hero",
      name: "Hero",
      heroUrl: "https://cdn.example/hero-square.png",
      iconUrl: "https://cdn.example/hero-icon.png",
    }),
    appListing({
      id: "screenshot",
      slug: "screenshot",
      name: "Screenshot",
      screenshotUrls: ["https://cdn.example/screenshot-tall.png"],
      iconUrl: "https://cdn.example/screenshot-icon.png",
    }),
    appListing({
      id: "icon",
      slug: "icon",
      name: "Icon",
      iconUrl: "https://cdn.example/icon-only.png",
    }),
  ];

  for (const app of variants) {
    const html = renderToString(h(AppSpotlight, { apps: [app] }));
    assertStringIncludes(html, "app-fresh-card--spotlight");
    assertStringIncludes(html, 'class="app-fresh-footer"');
    assertStringIncludes(html, `aria-label="View ${app.name}"`);
  }

  const iconHtml = renderToString(h(AppSpotlight, { apps: [variants[2]] }));
  assertStringIncludes(iconHtml, "app-fresh-media-icon-backdrop");
  assertStringIncludes(iconHtml, 'width="128" height="128"');
});

Deno.test("app showcase CSS keeps featured and collection stacks balanced", async () => {
  const css = await Deno.readTextFile(
    new URL("../../static/styles.css", import.meta.url),
  );

  assertStringIncludes(
    css,
    `.app-showcase-section {
  --app-directory-name-size: 0.9rem;
  --app-directory-meta-size: 0.74rem;
  --app-directory-avatar-size: 2.5rem;`,
  );
  assertStringIncludes(
    css,
    `.app-fresh-card {
  --app-directory-name-size: 0.9rem;
  --app-directory-meta-size: 0.74rem;
  --app-directory-avatar-size: 2.5rem;`,
  );
  assertStringIncludes(
    css,
    `.app-category-copy {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;`,
  );
  assertStringIncludes(
    css,
    `.app-promo-column .app-fresh-media {
  position: relative;
  inset: auto;
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  overflow: hidden;`,
  );
  assertStringIncludes(
    css,
    `.app-promo-column .app-fresh-media {
    aspect-ratio: 1200 / 630;
  }`,
  );
  assertStringIncludes(
    css,
    `.app-fresh-card.app-fresh-card--spotlight {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 19rem;
  aspect-ratio: auto;`,
  );
  assertStringIncludes(
    css,
    `@media (min-width: 941px) {
  .app-fresh-card.app-fresh-card--spotlight {
    height: auto;
    min-height: 0;
  }

  .app-fresh-card--spotlight .app-fresh-media {
    flex: 0 0 auto;
    aspect-ratio: 1200 / 630;`,
  );
  assertStringIncludes(
    css,
    `.app-fresh-card--spotlight .app-fresh-media img {
  position: absolute;
  inset: 0;
  object-fit: contain;`,
  );
  assertStringIncludes(
    css,
    `.app-fresh-card--spotlight .app-fresh-footer {
  position: relative;
  flex: 0 0 auto;
  margin-top: -0.55rem;`,
  );
  assertStringIncludes(
    css,
    `.app-fresh-card--compact .app-fresh-footer,
.app-fresh-card--spotlight .app-fresh-footer {
  grid-template-columns: var(--app-directory-avatar-size) minmax(0, 1fr) auto;
  gap: 0.46rem;
  min-height: 3.15rem;`,
  );
  assertStringIncludes(
    css,
    `.app-category-grid--balanced > :last-child:nth-child(odd) {
    display: none;`,
  );
  assertEquals(css.includes(".app-spotlight-card"), false);
  assertEquals(css.includes(".app-spotlight-media"), false);
});
