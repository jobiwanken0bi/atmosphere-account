import {
  atmosphereProfileAtUri,
  buildAtstoreListingFromProfile,
  buildAtstoreListingFromProfileRecord,
  createAtstoreListingRkey,
  getAtstoreMigrationReadiness,
} from "./atstore-migration.ts";
import {
  ATSTORE_LISTING_NSID,
  COMMUNITY_APP_PROFILE_NSID,
  parseAtstoreListing,
  parseCommunityAppRecord,
} from "./app-lexicons.ts";
import {
  buildCommunityAppProfileFromProfileRecord,
  communityAppProfileAtUri,
} from "./community-app-profile.ts";
import type { BlobRef, ProfileRecord } from "./lexicons.ts";
import type { ProfileRow } from "./registry.ts";
import { isAtprotoTid } from "./tid.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

const iconBlob: BlobRef = {
  $type: "blob",
  ref: { $link: "bafyicon" },
  mimeType: "image/png",
  size: 12_345,
};

const screenshotBlob: BlobRef = {
  $type: "blob",
  ref: { $link: "bafyscreenshot" },
  mimeType: "image/webp",
  size: 54_321,
};

function profile(): ProfileRow {
  return {
    did: "did:plc:app",
    handle: "reader.example",
    profileType: "project",
    name: "Reader",
    description: "Read long-form AT Protocol posts.",
    mainLink: "https://reader.example",
    iosLink: null,
    androidLink: null,
    categories: ["app"],
    subcategories: ["blogging"],
    links: [{ kind: "bsky", clientId: "bsky" }],
    screenshots: [{ image: screenshotBlob }],
    avatarCid: iconBlob.ref.$link,
    avatarMime: iconBlob.mimeType,
    bannerCid: null,
    bannerMime: null,
    iconCid: null,
    iconMime: null,
    iconStatus: null,
    iconReviewedBy: null,
    iconReviewedAt: null,
    iconRejectedReason: null,
    iconBwCid: null,
    iconBwMime: null,
    iconBwStatus: null,
    iconBwReviewedBy: null,
    iconBwReviewedAt: null,
    iconBwRejectedReason: null,
    iconAccessStatus: null,
    iconAccessEmail: null,
    iconAccessRequestedAt: null,
    iconAccessReviewedAt: null,
    iconAccessReviewedBy: null,
    iconAccessDeniedReason: null,
    takedownStatus: null,
    takedownReason: null,
    takedownBy: null,
    takedownAt: null,
    pdsUrl: "https://pds.example",
    recordCid: "bafyrecord",
    recordRev: "rev",
    createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
    indexedAt: Date.parse("2026-01-01T00:00:00.000Z"),
  };
}

function record(): ProfileRecord {
  return {
    profileType: "project",
    name: "Reader",
    description: "Read long-form AT Protocol posts.",
    mainLink: "https://reader.example",
    avatar: iconBlob,
    screenshots: [{ image: screenshotBlob }],
    categories: ["app"],
    subcategories: ["blogging"],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

Deno.test("buildAtstoreListingFromProfile emits a parseable shared listing", () => {
  const p = profile();
  const listing = buildAtstoreListingFromProfile(
    p,
    record(),
    new Date("2026-02-01T00:00:00.000Z"),
  );

  assertEquals(listing.slug, "reader.example");
  assertEquals(listing.categorySlug, ["apps/publishing"]);
  assertEquals(listing.productAccountDid, p.did);
  assertEquals(listing.migratedFromAtUri, atmosphereProfileAtUri(p.did));
  assertEquals(listing.icon.ref.$link, "bafyicon");
  assertEquals(listing.screenshots?.[0].ref.$link, "bafyscreenshot");

  const draft = parseAtstoreListing({
    uri: `at://${p.did}/${ATSTORE_LISTING_NSID}/3lx`,
    cid: "bafylisting",
    repoDid: p.did,
    rkey: "3lx",
    value: listing,
  });

  assert(draft, "expected listing draft");
  assertEquals(draft.sourceType, "atstore_listing");
  assertEquals(draft.productDid, p.did);
  assertEquals(draft.primaryUrl, "https://reader.example/");
});

Deno.test("buildAtstoreListingFromProfileRecord emits a direct ATStore listing", () => {
  const p = profile();
  const listing = buildAtstoreListingFromProfileRecord({
    did: p.did,
    handle: p.handle,
    record: record(),
    now: new Date("2026-02-01T00:00:00.000Z"),
  });

  assertEquals(listing.slug, "reader.example");
  assertEquals(listing.categorySlug, ["apps/publishing"]);
  assertEquals(listing.productAccountDid, p.did);
  assertEquals(listing.migratedFromAtUri, undefined);
  assertEquals(listing.icon.ref.$link, "bafyicon");
  assertEquals(listing.screenshots?.[0].ref.$link, "bafyscreenshot");

  const draft = parseAtstoreListing({
    uri: `at://${p.did}/${ATSTORE_LISTING_NSID}/3ly`,
    cid: "bafylisting",
    repoDid: p.did,
    rkey: "3ly",
    value: listing,
  });

  assert(draft, "expected listing draft");
  assertEquals(draft.sourceType, "atstore_listing");
  assertEquals(draft.productDid, p.did);
  assertEquals(
    draft.atstoreListingUri,
    `at://${p.did}/${ATSTORE_LISTING_NSID}/3ly`,
  );
});

Deno.test("buildCommunityAppProfileFromProfileRecord emits a parseable canonical app profile", () => {
  const p = profile();
  const communityProfile = buildCommunityAppProfileFromProfileRecord({
    did: p.did,
    handle: p.handle,
    record: {
      ...record(),
      iosLink: "https://apps.apple.com/app/reader/id123",
      androidLink: "https://play.google.com/store/apps/details?id=reader",
      links: [{ kind: "bsky", clientId: "bsky" }],
    },
    now: new Date("2026-02-01T00:00:00.000Z"),
  });

  assertEquals(communityProfile.name, "Reader");
  assertEquals(communityProfile.createdAt, "2026-01-01T00:00:00.000Z");
  assertEquals(communityProfile.updatedAt, "2026-02-01T00:00:00.000Z");
  assertEquals(communityProfile.status, "community.lexicon.app.defs#released");
  assertEquals(communityProfile.platforms, [
    "community.lexicon.app.defs#platformWeb",
    "community.lexicon.app.defs#platformIOS",
    "community.lexicon.app.defs#platformAndroid",
  ]);
  assertEquals(communityProfile.links.map((link) => link.label), [
    "Website",
    "App Store",
    "Play Store",
    "Bluesky",
  ]);
  assertEquals(communityProfile.images?.map((image) => image.purpose), [
    "community.lexicon.app.defs#purposeIcon",
    "community.lexicon.app.defs#purposeScreenshot",
  ]);

  const draft = parseCommunityAppRecord({
    uri: communityAppProfileAtUri(p.did),
    cid: "bafycommunity",
    repoDid: p.did,
    rkey: "self",
    collection: COMMUNITY_APP_PROFILE_NSID,
    value: communityProfile,
  });

  assert(draft, "expected community app draft");
  assertEquals(draft.sourceType, "community_profile");
  assertEquals(draft.productDid, p.did);
  assertEquals(draft.primaryUrl, "https://reader.example/");
  assertEquals(
    draft.iconUrl,
    `/api/atproto/blob?did=${encodeURIComponent(p.did)}&cid=bafyicon`,
  );
  assertEquals(draft.platforms, ["web", "ios", "android"]);
  assertEquals(draft.status, "released");
  assertEquals(draft.communityProfileUri, communityAppProfileAtUri(p.did));
});

Deno.test("buildCommunityAppProfileFromProfileRecord preserves existing createdAt", () => {
  const p = profile();
  const communityProfile = buildCommunityAppProfileFromProfileRecord({
    did: p.did,
    handle: p.handle,
    record: record(),
    existingRecord: {
      uri: communityAppProfileAtUri(p.did),
      cid: "bafyold",
      rkey: "self",
      value: { createdAt: "2025-12-01T00:00:00.000Z" },
    },
    now: new Date("2026-02-01T00:00:00.000Z"),
  });

  assertEquals(communityProfile.createdAt, "2025-12-01T00:00:00.000Z");
});

Deno.test("getAtstoreMigrationReadiness requires an app URL and icon", () => {
  const p = profile();
  assertEquals(getAtstoreMigrationReadiness(p, record()).ok, true);

  const noUrl = { ...p, mainLink: null };
  assertEquals(getAtstoreMigrationReadiness(noUrl, record()).ok, false);

  const noIcon = { ...record(), avatar: undefined };
  assertEquals(getAtstoreMigrationReadiness(p, noIcon).ok, false);
});

Deno.test("createAtstoreListingRkey returns an AT Protocol TID", () => {
  const rkey = createAtstoreListingRkey();
  assert(isAtprotoTid(rkey), `expected TID rkey, got ${rkey}`);
});
