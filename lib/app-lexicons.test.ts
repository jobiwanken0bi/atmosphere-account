import {
  aliasesForDraft,
  compareAppListingDraftPrecedence,
  mergeAppListingDrafts,
} from "./app-directory.ts";
import {
  atmosphereProfileToDraft,
  ATSTORE_LISTING_NSID,
  parseAtstoreFavorite,
  parseAtstoreListing,
  parseAtstoreReview,
  parseCommunityAppRecord,
} from "./app-lexicons.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`Expected ${e}, got ${a}`);
  }
}

Deno.test("parseAtstoreListing normalizes authoritative listing detail records", () => {
  const draft = parseAtstoreListing({
    uri: `at://did:plc:store/${ATSTORE_LISTING_NSID}/3lx`,
    cid: "bafyrecord",
    repoDid: "did:plc:store",
    rkey: "3lx",
    value: {
      name: "Leaflet",
      tagline: "Publish lightly",
      description: "A shared writing app.",
      externalUrl: "https://leaflet.pub/",
      categorySlug: "apps/publishing",
      appTags: ["writing", "publishing"],
      productAccountDid: "did:plc:leaflet",
      icon: {
        ref: { $link: "bafyicon" },
        mimeType: "image/png",
      },
      screenshots: [{
        ref: { $link: "bafyscreenshot" },
        mimeType: "image/webp",
      }],
      links: [{ uri: "https://leaflet.pub", label: "Website" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    },
  });

  assert(draft, "expected a listing draft");
  assertEquals(draft.sourceType, "atstore_listing");
  assertEquals(draft.name, "Leaflet");
  assertEquals(draft.primaryUrl, "https://leaflet.pub/");
  assertEquals(draft.categorySlugs, ["apps/publishing"]);
  assertEquals(draft.tags, ["writing", "publishing"]);
  assertEquals(draft.productDid, "did:plc:leaflet");
  assert(
    draft.iconUrl?.includes(
      "/api/atproto/blob?did=did%3Aplc%3Astore&cid=bafyicon",
    ),
    "expected proxied blob URL",
  );
  assertEquals(draft.screenshotUrls.length, 1);
});

Deno.test("parseAtstoreReview and favorite keep listing URI subjects", () => {
  const subject = `at://did:plc:store/${ATSTORE_LISTING_NSID}/3lx`;
  const review = parseAtstoreReview({
    uri: "at://did:plc:user/fyi.atstore.listing.review/3ly",
    cid: "bafyreview",
    repoDid: "did:plc:user",
    rkey: "3ly",
    value: {
      subject,
      rating: 5,
      text: "Great.",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  });
  const favorite = parseAtstoreFavorite({
    uri: "at://did:plc:user/fyi.atstore.listing.favorite/3lz",
    cid: "bafyfavorite",
    repoDid: "did:plc:user",
    rkey: "3lz",
    value: { subject, createdAt: "2026-01-03T00:00:00.000Z" },
  });

  assert(review, "expected a review draft");
  assert(favorite, "expected a favorite draft");
  assertEquals(review.subject, subject);
  assertEquals(review.rating, 5);
  assertEquals(favorite.subject, subject);
});

Deno.test("parseAtstoreReview and favorite reject non-listing subjects", () => {
  const subject = "at://did:plc:store/app.bsky.feed.post/3lx";
  const review = parseAtstoreReview({
    uri: "at://did:plc:user/fyi.atstore.listing.review/3ly",
    cid: "bafyreview",
    repoDid: "did:plc:user",
    rkey: "3ly",
    value: {
      subject,
      rating: 5,
      text: "Great.",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  });
  const favorite = parseAtstoreFavorite({
    uri: "at://did:plc:user/fyi.atstore.listing.favorite/3lz",
    cid: "bafyfavorite",
    repoDid: "did:plc:user",
    rkey: "3lz",
    value: { subject, createdAt: "2026-01-03T00:00:00.000Z" },
  });

  assertEquals(review, null);
  assertEquals(favorite, null);
});

Deno.test("parseCommunityAppRecord prepares future community app records", () => {
  const draft = parseCommunityAppRecord({
    uri: "at://did:plc:app/community.lexicon.app.profile/self",
    cid: "bafycommunity",
    repoDid: "did:plc:app",
    rkey: "self",
    collection: "community.lexicon.app.profile",
    value: {
      name: "Reader",
      description: "Read long-form AT Protocol posts.",
      status: "community.lexicon.app.defs#preview",
      createdAt: "2026-01-01T00:00:00.000Z",
      links: [{ uri: "https://reader.example", label: "Website" }],
      images: [{
        uri: "https://reader.example/icon.png",
        purpose: "community.lexicon.app.defs#purposeIcon",
      }, {
        uri: "https://reader.example/broken.png",
        image: { ref: { $link: "bafybroken" }, mimeType: "image/png" },
        purpose: "community.lexicon.app.defs#purposeScreenshot",
      }],
      lexicons: {
        produces: ["com.example.reader.bookmark"],
        consumes: ["app.bsky.feed.post"],
      },
      accountIndicators: [{ collection: "com.example.reader.bookmark" }],
      tags: ["reading"],
      platforms: [
        "community.lexicon.app.defs#platformWeb",
        "community.lexicon.app.defs#platformIOS",
      ],
    },
  });

  assert(draft, "expected a community draft");
  assertEquals(draft.sourceType, "community_profile");
  assertEquals(draft.profileDid, "did:plc:app");
  assertEquals(draft.primaryUrl, "https://reader.example");
  assertEquals(draft.iconUrl, "https://reader.example/icon.png");
  assertEquals(draft.screenshotUrls, []);
  assertEquals(draft.status, "preview");
  assertEquals(draft.platforms, ["web", "ios"]);
  assertEquals(draft.lexiconsConsumes, ["app.bsky.feed.post"]);
});

Deno.test("atmosphereProfileToDraft preserves community interop metadata", () => {
  const draft = atmosphereProfileToDraft({
    did: "did:plc:app",
    handle: "reader.example",
    uri: "at://did:plc:app/com.atmosphereaccount.registry.profile/self",
    cid: "bafyprofile",
    record: {
      name: "Reader",
      description: "Read long-form AT Protocol posts.",
      mainLink: "https://reader.example",
      categories: ["app"],
      lexicons: {
        produces: ["com.example.reader.bookmark"],
        consumes: ["app.bsky.feed.post"],
      },
      accountIndicators: [
        { collection: "com.example.reader.bookmark" },
        { collection: "com.example.reader.settings", rkey: "self" },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  });

  assertEquals(draft.lexiconsProduces, ["com.example.reader.bookmark"]);
  assertEquals(draft.lexiconsConsumes, ["app.bsky.feed.post"]);
  assertEquals(draft.accountIndicators, [
    { collection: "com.example.reader.bookmark" },
    { collection: "com.example.reader.settings", rkey: "self" },
  ]);
});

Deno.test("aliasesForDraft dedupes by DID, canonical URL, source URI, and ATStore URI", () => {
  const draft = parseAtstoreListing({
    uri: `at://did:plc:store/${ATSTORE_LISTING_NSID}/3lx`,
    cid: "bafyrecord",
    repoDid: "did:plc:store",
    rkey: "3lx",
    value: {
      name: "Leaflet",
      tagline: "Publish lightly",
      externalUrl: "https://www.leaflet.pub/",
      categorySlug: "apps/publishing",
      productAccountDid: "did:plc:leaflet",
      icon: { ref: { $link: "bafyicon" }, mimeType: "image/png" },
    },
  });

  assert(draft, "expected a listing draft");
  const aliases = aliasesForDraft(draft);
  assert(aliases.includes(`uri:${draft.sourceUri}`));
  assert(aliases.includes("did:plc:leaflet"));
  assert(aliases.includes(`atstore:${draft.sourceUri}`));
  assert(aliases.includes("url:https://www.leaflet.pub"));
  assert(!aliases.includes("slug:leaflet"));
  assertEquals(new Set(aliases).size, aliases.length);
});

Deno.test("real shared records outrank local dev app fixtures", () => {
  const realAtstore = parseAtstoreListing({
    uri: `at://did:plc:store/${ATSTORE_LISTING_NSID}/3lx`,
    cid: "bafyrecord",
    repoDid: "did:plc:store",
    rkey: "3lx",
    value: {
      name: "Leaflet",
      tagline: "Publish lightly",
      externalUrl: "https://leaflet.pub/",
      categorySlug: "apps/publishing",
      productAccountDid: "did:plc:leaflet",
      icon: { ref: { $link: "bafyicon" }, mimeType: "image/png" },
      heroImage: { ref: { $link: "bafyhero" }, mimeType: "image/png" },
      updatedAt: "2026-02-01T00:00:00.000Z",
    },
  });
  const localFixture = parseAtstoreListing({
    uri: `at://did:plc:localdevleaflet/${ATSTORE_LISTING_NSID}/leaflet`,
    cid: "local-leaflet",
    repoDid: "did:plc:localdevleaflet",
    rkey: "leaflet",
    value: {
      name: "Leaflet",
      tagline: "Publish lightly",
      externalUrl: "https://leaflet.pub/",
      categorySlug: "apps/account-tool",
      productAccountDid: "did:plc:localdevleaflet",
      icon: { ref: { $link: "localicon" }, mimeType: "image/png" },
      heroImage: { ref: { $link: "localhero" }, mimeType: "image/png" },
      updatedAt: "2026-03-01T00:00:00.000Z",
    },
  });

  assert(realAtstore, "expected a real ATStore draft");
  assert(localFixture, "expected a local fixture draft");
  const sorted = [localFixture, realAtstore].sort(
    compareAppListingDraftPrecedence,
  );

  assertEquals(sorted[0].sourceUri, realAtstore.sourceUri);
  assert(
    sorted[0].heroUrl?.includes("cid=bafyhero"),
    "expected the real ATStore hero to win",
  );
  const merged = mergeAppListingDrafts([localFixture, realAtstore]);
  assertEquals(merged.categorySlugs, ["apps/publishing"]);
  assertEquals(merged.productDid, "did:plc:leaflet");
});

Deno.test("ATStore content only supplements install and Tangled links from legacy profiles", () => {
  const atstore = parseAtstoreListing({
    uri: `at://did:plc:store/${ATSTORE_LISTING_NSID}/spark`,
    cid: "bafyrecord",
    repoDid: "did:plc:store",
    rkey: "spark",
    value: {
      name: "Spark",
      tagline: "Real Moments, Shared Together",
      description: "ATStore description",
      externalUrl: "https://sprk.so/",
      categorySlug: "apps/video",
      appTags: ["video"],
      productAccountDid: "did:plc:spark",
      icon: { ref: { $link: "bafyicon" }, mimeType: "image/png" },
      updatedAt: "2026-03-01T00:00:00.000Z",
    },
  });
  const legacy = atmosphereProfileToDraft({
    did: "did:plc:spark",
    handle: "sprk.so",
    uri: "at://did:plc:spark/com.atmosphereaccount.registry.profile/self",
    cid: "legacy-profile",
    screenshotUrls: ["https://sprk.so/legacy-shot.png"],
    record: {
      name: "Old Spark",
      description: "Legacy description",
      mainLink: "https://legacy.sprk.so",
      iosLink: "https://apps.apple.com/app/spark",
      androidLink: "https://play.google.com/store/apps/details?id=so.sprk.app",
      links: [{
        url: "https://tangled.org/sprk.so",
        label: "Tangled",
        kind: "tangled",
      }, {
        url: "https://example.com/not-an-app-store",
        label: "iOS",
        kind: "ios",
      }],
      categories: ["app", "accountProvider"],
      subcategories: ["music", "social", "photo"],
      createdAt: "2026-02-01T00:00:00.000Z",
    },
  });

  assert(atstore, "expected an ATStore listing draft");
  const merged = mergeAppListingDrafts([legacy, atstore]);
  assertEquals(merged.name, "Spark");
  assertEquals(merged.description, "ATStore description");
  assertEquals(merged.categorySlugs, ["apps/video"]);
  assertEquals(merged.tags, ["video"]);
  assertEquals(merged.screenshotUrls, []);
  assertEquals(merged.links.map((link) => link.uri), [
    "https://apps.apple.com/app/spark",
    "https://play.google.com/store/apps/details?id=so.sprk.app",
    "https://tangled.org/sprk.so",
  ]);
});
