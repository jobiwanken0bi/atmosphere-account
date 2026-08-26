import { assert, assertEquals } from "jsr:@std/assert@1";
import { UPDATE_NSID } from "../lib/lexicons.ts";
import {
  createStandardSiteRkey,
  STANDARD_SITE_DOCUMENT_NSID,
  standardSitePublicationUri,
} from "../lib/standard-site-updates.ts";
import {
  buildJetstreamUrl,
  managedListingsIncludeProductDid,
  profileUpdateUriForCollection,
  standardSiteProfileUpdateProjection,
} from "./indexer.ts";

Deno.test("global indexer does not subscribe to network-wide Standard.site traffic", () => {
  const url = new URL(buildJetstreamUrl(123));
  const collections = url.searchParams.getAll("wantedCollections");
  assert(collections.includes(UPDATE_NSID));
  assert(!collections.includes(STANDARD_SITE_DOCUMENT_NSID));
  assertEquals(url.searchParams.get("cursor"), "123");
});

Deno.test("update tombstones use the exact collection URI", () => {
  const did = "did:plc:example";
  const rkey = createStandardSiteRkey(1_800_000_000_000);
  assertEquals(
    profileUpdateUriForCollection(did, UPDATE_NSID, rkey),
    `at://${did}/${UPDATE_NSID}/${rkey}`,
  );
  assertEquals(
    profileUpdateUriForCollection(
      did,
      STANDARD_SITE_DOCUMENT_NSID,
      rkey,
    ),
    `at://${did}/${STANDARD_SITE_DOCUMENT_NSID}/${rkey}`,
  );
  assertEquals(
    profileUpdateUriForCollection(did, "example.other", rkey),
    null,
  );
  assertEquals(
    profileUpdateUriForCollection(
      did,
      STANDARD_SITE_DOCUMENT_NSID,
      "not-a-tid",
    ),
    null,
  );
});

Deno.test("Standard.site ingestion requires an exact product DID match", () => {
  const did = "did:plc:product";
  assertEquals(
    managedListingsIncludeProductDid([
      { productDid: null },
      { productDid: "did:plc:other" },
    ], did),
    false,
  );
  assertEquals(
    managedListingsIncludeProductDid([
      { productDid: "did:plc:other" },
      { productDid: did },
    ], did),
    true,
  );
});

Deno.test("Standard.site documents map to the shared update projection", () => {
  const did = "did:plc:product";
  const publicationRkey = createStandardSiteRkey(1_800_000_000_000);
  const documentRkey = createStandardSiteRkey(1_800_000_000_001);
  const update = standardSiteProfileUpdateProjection({
    did,
    rkey: documentRkey,
    cid: "bafy-standard-document",
    value: {
      $type: STANDARD_SITE_DOCUMENT_NSID,
      site: standardSitePublicationUri(did, publicationRkey),
      path: "/updates/2.4.0",
      title: "Version 2.4",
      description: "Short description",
      textContent: "Full release notes",
      tags: ["release", "version:2.4.0"],
      publishedAt: "2027-01-15T12:00:00.000Z",
      updatedAt: "2027-01-16T13:30:00.000Z",
    },
  });

  assertEquals(update, {
    uri: `at://${did}/${STANDARD_SITE_DOCUMENT_NSID}/${documentRkey}`,
    cid: "bafy-standard-document",
    rkey: documentRkey,
    projectDid: did,
    title: "Version 2.4",
    body: "Full release notes",
    version: "2.4.0",
    tangledCommitUrl: null,
    tangledRepoUrl: null,
    source: "standard_site",
    createdAt: Date.parse("2027-01-15T12:00:00.000Z"),
    updatedAt: Date.parse("2027-01-16T13:30:00.000Z"),
  });
});

Deno.test("invalid Standard.site documents never reach the projection", () => {
  assertEquals(
    standardSiteProfileUpdateProjection({
      did: "did:plc:product",
      rkey: createStandardSiteRkey(1_800_000_000_000),
      cid: "bafy-invalid",
      value: {
        $type: STANDARD_SITE_DOCUMENT_NSID,
        title: "Missing required fields",
      },
    }),
    null,
  );
});
