import {
  atmosphereStandardSiteAppIdFromTags,
  atmosphereStandardSiteAppTag,
  atmosphereStandardSiteDocumentSlug,
  atmosphereStandardSitePublicationUrl,
  atmosphereStandardSiteUpdateSource,
  buildStandardSiteDocument,
  buildStandardSitePublication,
  canonicalStandardSiteDocumentUrl,
  createStandardSiteRkey,
  isAtmosphereStandardSiteDocument,
  isAtmosphereStandardSiteUpdateSource,
  isStandardSiteRkey,
  parseStandardSiteDocument,
  parseStandardSitePublication,
  STANDARD_SITE_DOCUMENT_NSID,
  STANDARD_SITE_PUBLICATION_NSID,
  standardSiteDocumentUri,
  standardSitePublicationRkeyFromUri,
  standardSitePublicationUri,
  standardSiteUpdatePath,
  standardSiteVersionFromTags,
  standardSiteVersionTag,
  validateStandardSiteDocument,
  validateStandardSitePublication,
} from "./standard-site-updates.ts";

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

function assertThrows(fn: () => unknown, includes: string): void {
  try {
    fn();
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes(includes),
      `Expected error containing ${includes}, got ${String(error)}`,
    );
    return;
  }
  throw new Error(`Expected function to throw ${includes}`);
}

Deno.test("Standard.site helpers create TID-keyed record identities", () => {
  const rkey = createStandardSiteRkey(1_800_000_000_000);

  assert(isStandardSiteRkey(rkey));
  assertEquals(
    standardSitePublicationUri("did:plc:product", rkey),
    `at://did:plc:product/site.standard.publication/${rkey}`,
  );
  assertEquals(
    standardSitePublicationRkeyFromUri(
      `at://did:plc:product/site.standard.publication/${rkey}`,
      "did:plc:product",
    ),
    rkey,
  );
  assertEquals(
    standardSitePublicationRkeyFromUri(
      `at://did:plc:other/site.standard.publication/${rkey}`,
      "did:plc:product",
    ),
    null,
  );
  assertEquals(
    standardSiteDocumentUri("did:plc:product", rkey),
    `at://did:plc:product/site.standard.document/${rkey}`,
  );
  assertThrows(
    () => standardSiteDocumentUri("did:plc:product", "legacy-update-key"),
    "TID",
  );
});

Deno.test("What's New paths are safe, nonempty ATStore permalinks", () => {
  const rkey = createStandardSiteRkey(1_800_000_000_001);
  const path = standardSiteUpdatePath("My App/Preview", rkey);

  assertEquals(path, `/apps/My%20App%2FPreview?update=${rkey}`);
  assertEquals(
    canonicalStandardSiteDocumentUrl(
      "https://account.atmosphere.example/",
      path,
    ),
    `https://account.atmosphere.example/apps/My%20App%2FPreview?update=${rkey}`,
  );
  assertEquals(
    canonicalStandardSiteDocumentUrl("javascript:alert(1)", path),
    null,
  );
  assertThrows(() => standardSiteUpdatePath(" ", rkey), "non-empty");
  assertThrows(() => standardSiteUpdatePath("app", "not-a-tid"), "TID");
});

Deno.test("Atmosphere update identity is exact to one app publication", () => {
  const rkey = createStandardSiteRkey(1_800_000_000_002);
  const publicationUri = standardSitePublicationUri(
    "did:plc:product",
    createStandardSiteRkey(1_800_000_000_001),
  );
  const record = {
    site: publicationUri,
    path: standardSiteUpdatePath("grain.social", rkey),
  };

  assertEquals(
    atmosphereStandardSitePublicationUrl(
      "https://atmosphere.example/base",
      "grain.social",
    ),
    "https://atmosphere.example/apps/grain.social",
  );
  const appId = "7a449f77-349c-4b26-98af-a01ec51edafd";
  assertEquals(
    atmosphereStandardSiteUpdateSource(appId),
    `standard_site_atmosphere:${appId}`,
  );
  assert(isAtmosphereStandardSiteUpdateSource(
    `standard_site_atmosphere:${appId}`,
    appId,
  ));
  assert(
    !isAtmosphereStandardSiteUpdateSource(
      "standard_site_atmosphere:another-app-id",
      appId,
    ),
  );
  assertEquals(atmosphereStandardSiteAppTag(appId), `atmosphere-app:${appId}`);
  assertEquals(
    atmosphereStandardSiteAppIdFromTags([
      "release",
      `atmosphere-app:${appId}`,
    ]),
    appId,
  );
  assertEquals(
    atmosphereStandardSiteDocumentSlug(record, {
      publicationUrl: "https://atmosphere.example/apps/grain.social",
      siteUrl: "https://atmosphere.example",
      rkey,
    }),
    "grain.social",
  );
  assertEquals(
    atmosphereStandardSiteDocumentSlug(record, {
      publicationUrl: "https://blog.example/apps/grain.social",
      siteUrl: "https://atmosphere.example",
      rkey,
    }),
    null,
  );
  assert(isAtmosphereStandardSiteDocument(record, {
    publicationUri,
    slug: "grain.social",
    rkey,
  }));
  assert(
    !isAtmosphereStandardSiteDocument(record, {
      publicationUri,
      slug: "other.app",
      rkey,
    }),
  );
  assert(
    !isAtmosphereStandardSiteDocument(record, {
      publicationUri: publicationUri.replace(
        "did:plc:product",
        "did:plc:other",
      ),
      slug: "grain.social",
      rkey,
    }),
  );
});

Deno.test("publication builder emits the official ATStore publication shape", () => {
  const record = buildStandardSitePublication({
    url: " https://account.atmosphere.example/// ",
    name: " Atmosphere Account updates ",
    description: " Product release notes. ",
    showInDiscover: true,
  });

  assertEquals(record, {
    $type: STANDARD_SITE_PUBLICATION_NSID,
    url: "https://account.atmosphere.example",
    name: "Atmosphere Account updates",
    description: "Product release notes.",
    preferences: { showInDiscover: true },
  });
  assertEquals(parseStandardSitePublication(record), record);
});

Deno.test("publication parser enforces current required fields and URL safety", () => {
  assertEquals(
    validateStandardSitePublication({
      $type: STANDARD_SITE_PUBLICATION_NSID,
      url: "https://example.com",
    }).ok,
    false,
  );
  assertEquals(
    validateStandardSitePublication({
      $type: STANDARD_SITE_DOCUMENT_NSID,
      url: "https://example.com",
      name: "Wrong type",
    }).ok,
    false,
  );
  assertEquals(
    parseStandardSitePublication({
      url: "ftp://example.com",
      name: "Unsafe scheme",
    }),
    null,
  );
});

Deno.test("document builder maps legacy What's New fields without losing version", () => {
  const publicationRkey = createStandardSiteRkey(1_800_000_000_002);
  const documentRkey = createStandardSiteRkey(1_800_000_000_003);
  const site = standardSitePublicationUri(
    "did:plc:product",
    publicationRkey,
  );
  const path = standardSiteUpdatePath("grain.social", documentRkey);
  const record = buildStandardSiteDocument({
    site,
    path,
    title: " Faster sync ",
    body: " Sync now resumes after reconnecting. ",
    version: " v2.4.0 ",
    tags: ["release", "version:stale"],
    createdAt: Date.UTC(2026, 7, 20, 14, 30),
    updatedAt: "2026-08-21T15:45:00-04:00",
  });

  assertEquals(record, {
    $type: STANDARD_SITE_DOCUMENT_NSID,
    site,
    path,
    title: "Faster sync",
    description: "Sync now resumes after reconnecting.",
    textContent: "Sync now resumes after reconnecting.",
    tags: ["release", "version:v2.4.0"],
    publishedAt: "2026-08-20T14:30:00.000Z",
    updatedAt: "2026-08-21T19:45:00.000Z",
  });
  assertEquals(standardSiteVersionFromTags(record.tags), "v2.4.0");
  assertEquals(parseStandardSiteDocument(record), record);
});

Deno.test("document parser accepts publication URLs for official loose documents", () => {
  const parsed = parseStandardSiteDocument({
    $type: STANDARD_SITE_DOCUMENT_NSID,
    site: "https://updates.example.com/",
    path: "releases/one",
    title: "Release one",
    description: "A release.",
    publishedAt: "2026-08-20T14:30:00Z",
  });

  assert(parsed);
  assertEquals(parsed.site, "https://updates.example.com");
  assertEquals(parsed.path, "/releases/one");
  assertEquals(parsed.publishedAt, "2026-08-20T14:30:00.000Z");
});

Deno.test("document parser requires the fields ATStore needs", () => {
  const publicationRkey = createStandardSiteRkey(1_800_000_000_004);
  const base = {
    $type: STANDARD_SITE_DOCUMENT_NSID,
    site: standardSitePublicationUri("did:plc:product", publicationRkey),
    path: "/apps/product",
    title: "Release",
    publishedAt: "2026-08-20T14:30:00.000Z",
  };

  assertEquals(validateStandardSiteDocument({ ...base, path: "" }).ok, false);
  assertEquals(
    validateStandardSiteDocument({ ...base, publishedAt: "yesterday" }).ok,
    false,
  );
  assertEquals(
    validateStandardSiteDocument({ ...base, site: "at://not-a-publication" })
      .ok,
    false,
  );
  assertEquals(
    validateStandardSiteDocument({ ...base, textContent: 42 }).ok,
    false,
  );
});

Deno.test("version tag convention is explicit and bounded", () => {
  assertEquals(standardSiteVersionTag(undefined), null);
  assertEquals(standardSiteVersionTag(" 1.2.3 "), "version:1.2.3");
  assertEquals(
    standardSiteVersionFromTags(["release", "version:1.2.3"]),
    "1.2.3",
  );
  assertThrows(() => standardSiteVersionTag("x".repeat(33)), "<=32");
});
