import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import type { AppListing } from "../../lib/app-directory.ts";
import AppCard from "./AppCard.tsx";

const APP = {
  id: "app-one",
  slug: "app-one",
  name: "App One",
  primaryUrl: "https://app.example",
  tagline: "A useful Atmosphere app.",
  description: "",
  iconUrl: null,
  categorySlugs: ["apps/bluesky/client"],
  tags: ["client", "social", "web"],
  atstoreListingUri: "at://did:plc:app/fyi.atstore.listing.detail/3mexample",
  reviewCount: 21,
  averageRating: 4.6,
  favoriteCount: 12,
  accountHost: "host.example",
} as unknown as AppListing;

Deno.test("AppCard pairs identity signals and footer metadata", () => {
  const html = renderToString(<AppCard app={APP} />);
  const visibleText = html.replaceAll(/<[^>]+>/g, "");
  const top = html.indexOf('class="app-card-top"');
  const name = html.indexOf('class="profile-card-name"');
  const rating = html.indexOf('class="app-card-rating-metric"');
  const handle = html.indexOf('class="profile-card-handle"');
  const host = html.indexOf('class="app-card-host-indicator"');
  const description = html.indexOf('class="profile-card-description"');
  const footer = html.indexOf('class="app-card-footer"');
  const footerMeta = html.indexOf('class="app-card-footer-meta"');
  const category = html.indexOf('class="app-card-category-label"');
  const like = html.indexOf('class="app-card-like-metric"');
  const view = html.indexOf('class="app-card-view"');

  assertStringIncludes(html, 'class="app-card-category-label">Client</span>');
  assertEquals(visibleText.includes("social"), false);
  assertEquals(visibleText.includes("web"), false);
  assertStringIncludes(html, 'class="profile-card-handle"');
  assertStringIncludes(html, 'aria-label="4.6 stars from 21 reviews"');
  assertStringIncludes(visibleText, "4.6★(21)");
  assertStringIncludes(html, 'aria-label="12 likes"');
  assertStringIncludes(html, 'class="app-card-like-icon"');
  assertEquals(visibleText.includes("likes"), false);
  assertStringIncludes(html, 'class="app-card-host-indicator"');
  assertStringIncludes(html, 'class="app-card-footer-meta"');
  assertStringIncludes(html, 'class="app-card-view">View</span>');
  assert(
    top >= 0 && top < name && name < rating && rating < handle &&
      handle < host && host < description && description < footer &&
      footer < footerMeta && footerMeta < category && category < like &&
      like < view,
  );
});

Deno.test("AppCard omits empty review and like metrics", () => {
  const html = renderToString(
    <AppCard
      app={{
        ...APP,
        reviewCount: 0,
        averageRating: null,
        favoriteCount: 0,
      }}
    />,
  );

  assertEquals(html.includes("app-card-rating-metric"), false);
  assertEquals(html.includes("app-card-like-metric"), false);
  assertStringIncludes(html, 'class="app-card-host-indicator"');
  assertStringIncludes(html, 'class="app-card-footer-meta"');
});
