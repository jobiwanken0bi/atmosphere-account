import {
  createCachedStandardSiteSync,
  STANDARD_SITE_DOCUMENT_SCAN_MAX_PAGES,
  STANDARD_SITE_SYNC_LIMIT,
  type StandardSiteSyncDependencies,
  type StandardSiteSyncRecord,
  type StandardSiteUpdateUpsert,
  syncStandardSiteDocumentsForProductCore,
} from "./standard-site-sync.ts";
import {
  atmosphereStandardSiteAppTag,
  atmosphereStandardSitePublicationUrl,
  atmosphereStandardSiteUpdateSource,
  createStandardSiteRkey,
  STANDARD_SITE_DOCUMENT_NSID,
  STANDARD_SITE_PUBLICATION_NSID,
  standardSitePublicationUri,
} from "./standard-site-updates.ts";
import { SITE_URL } from "./env.ts";

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

const PRODUCT_DID = "did:plc:standardsiteproduct";
const APP_ID = "7a449f77-349c-4b26-98af-a01ec51edafd";
const PDS_URL = "https://current-pds.example";
const PUBLICATION_RKEY = createStandardSiteRkey(1_900_000_000_000);

function dependencies(
  overrides: Partial<StandardSiteSyncDependencies> = {},
): StandardSiteSyncDependencies {
  return {
    listManagedListings: () =>
      Promise.resolve([{
        id: APP_ID,
        productDid: PRODUCT_DID,
        slug: "product",
      }]),
    resolvePds: () => Promise.resolve(PDS_URL),
    listRecords: () => Promise.resolve({ records: [] }),
    getPublicationBindingByUri: (appId, publicationUri) =>
      Promise.resolve({
        appListingId: appId,
        publicationUrl: atmosphereStandardSitePublicationUrl(
          SITE_URL,
          "product",
        ),
        publicationUri,
        createdAt: 1,
        updatedAt: 1,
      }),
    upsertUpdate: () => Promise.resolve(),
    reconcileUpdates: () => Promise.resolve(),
    ...overrides,
  };
}

function publicationEnvelope(): StandardSiteSyncRecord {
  return {
    uri: standardSitePublicationUri(PRODUCT_DID, PUBLICATION_RKEY),
    cid: "bafy-publication",
    value: {
      $type: STANDARD_SITE_PUBLICATION_NSID,
      url: atmosphereStandardSitePublicationUrl(SITE_URL, "product"),
      name: "Product updates",
    },
  };
}

function documentEnvelope(input: {
  rkey: string;
  title?: string;
  textContent?: string;
  description?: string;
  version?: string;
  publishedAt?: string;
  updatedAt?: string;
  uriDid?: string;
}): StandardSiteSyncRecord {
  return {
    uri: `at://${
      input.uriDid ?? PRODUCT_DID
    }/${STANDARD_SITE_DOCUMENT_NSID}/${input.rkey}`,
    cid: `bafy-${input.rkey}`,
    value: {
      $type: STANDARD_SITE_DOCUMENT_NSID,
      site: standardSitePublicationUri(PRODUCT_DID, PUBLICATION_RKEY),
      path: `/apps/product?update=${input.rkey}`,
      title: input.title ?? "Product update",
      ...(input.textContent !== undefined
        ? { textContent: input.textContent }
        : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      tags: [
        atmosphereStandardSiteAppTag(APP_ID),
        ...(input.version ? [`version:${input.version}`] : []),
      ],
      publishedAt: input.publishedAt ?? "2026-08-20T14:30:00.000Z",
      ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    },
  };
}

Deno.test("sync gates PDS access on an exact managed product DID", async () => {
  let resolved = false;
  let listed = false;
  let upserted = false;
  const result = await syncStandardSiteDocumentsForProductCore(
    PRODUCT_DID,
    dependencies({
      listManagedListings: () =>
        Promise.resolve([
          {
            id: "other-app",
            productDid: "did:plc:a-different-product",
            slug: "other",
          },
          { id: APP_ID, productDid: null, slug: "product" },
        ]),
      resolvePds: () => {
        resolved = true;
        return Promise.resolve(PDS_URL);
      },
      listRecords: () => {
        listed = true;
        return Promise.resolve({ records: [] });
      },
      upsertUpdate: () => {
        upserted = true;
        return Promise.resolve();
      },
    }),
  );

  assertEquals(result, {
    managed: false,
    recordsSeen: 0,
    recordsSynced: 0,
    recordsSkipped: 0,
  });
  assert(!resolved && !listed && !upserted, "ownership gate must run first");
});

Deno.test("sync maps newest Standard.site documents into profile updates", async () => {
  const firstRkey = createStandardSiteRkey(1_900_000_000_001);
  const secondRkey = createStandardSiteRkey(1_900_000_000_002);
  const wrongDidRkey = createStandardSiteRkey(1_900_000_000_003);
  const emptyRkey = createStandardSiteRkey(1_900_000_000_004);
  const first = documentEnvelope({
    rkey: firstRkey,
    title: "Text wins",
    textContent: "Preferred plaintext body",
    description: "Fallback excerpt",
    version: "2.4.0",
    publishedAt: "2026-08-20T14:30:00.000Z",
    updatedAt: "2026-08-21T15:45:00.000Z",
  });
  const second = documentEnvelope({
    rkey: secondRkey,
    title: "Description fallback",
    description: "Description-only body",
    publishedAt: "2026-08-19T12:00:00.000Z",
  });
  const wrongDid = documentEnvelope({
    rkey: wrongDidRkey,
    textContent: "Must not cross repositories",
    uriDid: "did:plc:anotherproduct",
  });
  const noBody = documentEnvelope({
    rkey: emptyRkey,
    publishedAt: "2026-08-18T12:00:00.000Z",
  });
  const writes: StandardSiteUpdateUpsert[] = [];
  let reconciledUris: string[] = [];
  let resolvedDid = "";
  const listCalls: unknown[][] = [];

  const result = await syncStandardSiteDocumentsForProductCore(
    ` ${PRODUCT_DID} `,
    dependencies({
      // The durable document tag keeps ownership stable after an app slug
      // changes; the publication/path remain the historical permalink.
      listManagedListings: () =>
        Promise.resolve([{
          id: APP_ID,
          productDid: PRODUCT_DID,
          slug: "renamed-product",
        }]),
      resolvePds: (did) => {
        resolvedDid = did;
        return Promise.resolve(PDS_URL);
      },
      listRecords: (pdsUrl, did, collection, options) => {
        listCalls.push([pdsUrl, did, collection, options]);
        return Promise.resolve({
          records: collection === STANDARD_SITE_PUBLICATION_NSID
            ? [publicationEnvelope()]
            : [first, second, wrongDid, noBody],
        });
      },
      upsertUpdate: (input) => {
        writes.push(input);
        return Promise.resolve();
      },
      reconcileUpdates: (_did, liveUris) => {
        reconciledUris = [...liveUris].sort();
        return Promise.resolve();
      },
    }),
  );

  assertEquals(resolvedDid, PRODUCT_DID);
  assertEquals(listCalls, [
    [
      PDS_URL,
      PRODUCT_DID,
      STANDARD_SITE_PUBLICATION_NSID,
      { limit: 100 },
    ],
    [
      PDS_URL,
      PRODUCT_DID,
      STANDARD_SITE_DOCUMENT_NSID,
      { limit: 100, reverse: true },
    ],
  ]);
  assertEquals(result, {
    managed: true,
    recordsSeen: 4,
    recordsSynced: 3,
    recordsSkipped: 1,
  });
  assertEquals(reconciledUris, [first.uri, noBody.uri, second.uri].sort());
  assertEquals(writes, [
    {
      uri: first.uri,
      cid: first.cid,
      rkey: firstRkey,
      projectDid: PRODUCT_DID,
      title: "Text wins",
      body: "Preferred plaintext body",
      version: "2.4.0",
      source: atmosphereStandardSiteUpdateSource(APP_ID),
      createdAt: Date.parse("2026-08-20T14:30:00.000Z"),
      updatedAt: Date.parse("2026-08-21T15:45:00.000Z"),
    },
    {
      uri: second.uri,
      cid: second.cid,
      rkey: secondRkey,
      projectDid: PRODUCT_DID,
      title: "Description fallback",
      body: "Description-only body",
      version: null,
      source: atmosphereStandardSiteUpdateSource(APP_ID),
      createdAt: Date.parse("2026-08-19T12:00:00.000Z"),
      updatedAt: Date.parse("2026-08-19T12:00:00.000Z"),
    },
    {
      uri: noBody.uri,
      cid: noBody.cid,
      rkey: emptyRkey,
      projectDid: PRODUCT_DID,
      title: "Product update",
      body: "",
      version: null,
      source: atmosphereStandardSiteUpdateSource(APP_ID),
      createdAt: Date.parse("2026-08-18T12:00:00.000Z"),
      updatedAt: Date.parse("2026-08-18T12:00:00.000Z"),
    },
  ]);
});

Deno.test("sync hard-caps even an overfull dependency response at 40", async () => {
  const records = Array.from(
    { length: STANDARD_SITE_SYNC_LIMIT + 5 },
    (_, i) =>
      documentEnvelope({
        rkey: createStandardSiteRkey(1_900_000_001_000 + i),
        textContent: `Update ${i}`,
      }),
  );
  let writes = 0;

  const result = await syncStandardSiteDocumentsForProductCore(
    PRODUCT_DID,
    dependencies({
      listRecords: (_pds, _did, collection) =>
        Promise.resolve({
          records: collection === STANDARD_SITE_DOCUMENT_NSID ? records : [],
        }),
      upsertUpdate: () => {
        writes += 1;
        return Promise.resolve();
      },
    }),
  );

  assertEquals(writes, STANDARD_SITE_SYNC_LIMIT);
  assertEquals(result, {
    managed: true,
    recordsSeen: records.length,
    recordsSynced: STANDARD_SITE_SYNC_LIMIT,
    recordsSkipped: 0,
  });
});

Deno.test("complete sync reconciles to the valid publishedAt top 40", async () => {
  const backdated = documentEnvelope({
    rkey: createStandardSiteRkey(1_900_000_200_000),
    title: "Previously visible but now backdated",
    publishedAt: "2020-01-01T00:00:00.000Z",
  });
  const malformedRkey = createStandardSiteRkey(1_900_000_200_001);
  const malformed: StandardSiteSyncRecord = {
    uri: `at://${PRODUCT_DID}/${STANDARD_SITE_DOCUMENT_NSID}/${malformedRkey}`,
    cid: "bafy-malformed",
    value: {
      $type: STANDARD_SITE_DOCUMENT_NSID,
      title: "Missing the required publication and date",
    },
  };
  const selected = Array.from(
    { length: STANDARD_SITE_SYNC_LIMIT },
    (_, i) =>
      documentEnvelope({
        rkey: createStandardSiteRkey(1_900_000_100_000 + i),
        title: `Selected ${i}`,
        publishedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      }),
  );
  const writes: StandardSiteUpdateUpsert[] = [];
  let projectedUris = new Set<string>();

  const result = await syncStandardSiteDocumentsForProductCore(
    PRODUCT_DID,
    dependencies({
      listRecords: (_pds, _did, collection) =>
        Promise.resolve({
          records: collection === STANDARD_SITE_DOCUMENT_NSID
            ? [backdated, malformed, ...selected]
            : [],
        }),
      upsertUpdate: (input) => {
        writes.push(input);
        return Promise.resolve();
      },
      reconcileUpdates: (_did, uris) => {
        projectedUris = new Set(uris);
        return Promise.resolve();
      },
    }),
  );

  assertEquals(result, {
    managed: true,
    recordsSeen: STANDARD_SITE_SYNC_LIMIT + 2,
    recordsSynced: STANDARD_SITE_SYNC_LIMIT,
    recordsSkipped: 1,
  });
  assertEquals(projectedUris.size, STANDARD_SITE_SYNC_LIMIT);
  assert(!projectedUris.has(backdated.uri));
  assert(!projectedUris.has(malformed.uri));
  assertEquals(
    [...projectedUris].sort(),
    selected.map((record) => record.uri).sort(),
  );
  assertEquals(writes.some((write) => write.uri === backdated.uri), false);
});

Deno.test("sync paginates and selects documents by publishedAt", async () => {
  const lexicallyNewer = documentEnvelope({
    rkey: createStandardSiteRkey(1_900_000_003_000),
    title: "Lexically newer but older",
    publishedAt: "2026-01-01T00:00:00.000Z",
  });
  const publishedNewest = documentEnvelope({
    rkey: createStandardSiteRkey(1_900_000_002_000),
    title: "Published newest",
    publishedAt: "2027-01-01T00:00:00.000Z",
  });
  const writes: StandardSiteUpdateUpsert[] = [];
  const documentOptions: unknown[] = [];
  let reconciledUris: string[] = [];

  const result = await syncStandardSiteDocumentsForProductCore(
    PRODUCT_DID,
    dependencies({
      listRecords: (_pds, _did, collection, options) => {
        if (collection === STANDARD_SITE_PUBLICATION_NSID) {
          return Promise.resolve({ records: [publicationEnvelope()] });
        }
        documentOptions.push(options);
        return Promise.resolve(
          options.cursor
            ? { records: [publishedNewest] }
            : { records: [lexicallyNewer], cursor: "next-page" },
        );
      },
      upsertUpdate: (input) => {
        writes.push(input);
        return Promise.resolve();
      },
      reconcileUpdates: (_did, liveUris) => {
        reconciledUris = [...liveUris].sort();
        return Promise.resolve();
      },
    }),
  );

  assertEquals(documentOptions, [
    { limit: 100, reverse: true },
    { limit: 100, reverse: true, cursor: "next-page" },
  ]);
  assertEquals(result, {
    managed: true,
    recordsSeen: 2,
    recordsSynced: 2,
    recordsSkipped: 0,
  });
  assertEquals(writes.map((write) => write.title), [
    "Published newest",
    "Lexically newer but older",
  ]);
  assertEquals(
    reconciledUris,
    [lexicallyNewer.uri, publishedNewest.uri].sort(),
  );
});

Deno.test("sync never reconciles deletions after a bounded partial scan", async () => {
  let documentPages = 0;
  let reconciled = false;

  const result = await syncStandardSiteDocumentsForProductCore(
    PRODUCT_DID,
    dependencies({
      listRecords: (_pds, _did, collection) => {
        if (collection === STANDARD_SITE_PUBLICATION_NSID) {
          return Promise.resolve({ records: [] });
        }
        const record = documentEnvelope({
          rkey: createStandardSiteRkey(1_900_000_010_000 + documentPages),
        });
        documentPages += 1;
        return Promise.resolve({
          records: [record],
          cursor: `page-${documentPages}`,
        });
      },
      reconcileUpdates: () => {
        reconciled = true;
        return Promise.resolve();
      },
    }),
  );

  assertEquals(documentPages, STANDARD_SITE_DOCUMENT_SCAN_MAX_PAGES);
  assertEquals(reconciled, false);
  assertEquals(result, {
    managed: true,
    recordsSeen: STANDARD_SITE_DOCUMENT_SCAN_MAX_PAGES,
    recordsSynced: STANDARD_SITE_DOCUMENT_SCAN_MAX_PAGES,
    recordsSkipped: 0,
  });
});

Deno.test("unbound tagged documents remain generic Standard.site updates", async () => {
  const record = documentEnvelope({
    rkey: createStandardSiteRkey(1_900_000_020_000),
  });
  const writes: StandardSiteUpdateUpsert[] = [];

  await syncStandardSiteDocumentsForProductCore(
    PRODUCT_DID,
    dependencies({
      listRecords: (_pds, _did, collection) =>
        Promise.resolve({
          records: collection === STANDARD_SITE_PUBLICATION_NSID
            ? [publicationEnvelope()]
            : [record],
        }),
      getPublicationBindingByUri: () => Promise.resolve(null),
      upsertUpdate: (input) => {
        writes.push(input);
        return Promise.resolve();
      },
    }),
  );

  assertEquals(writes.length, 1);
  assertEquals(writes[0].source, "standard_site");
});

Deno.test("runtime cache helper caches empty success and singleflights by DID", async () => {
  let clock = 1_000;
  let calls = 0;
  let finish: (result: ReturnType<typeof emptySyncResult>) => void = () => {
    throw new Error("sync did not start");
  };
  const cached = createCachedStandardSiteSync(
    () => {
      calls += 1;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    { ttlMs: 300_000, now: () => clock },
  );

  const first = cached(PRODUCT_DID);
  const concurrent = cached(` ${PRODUCT_DID} `);
  await Promise.resolve();
  assertEquals(calls, 1);
  finish(emptySyncResult());
  assertEquals(await first, emptySyncResult());
  assertEquals(await concurrent, emptySyncResult());

  assertEquals(await cached(PRODUCT_DID), emptySyncResult());
  assertEquals(calls, 1);

  clock += 300_001;
  const afterExpiry = cached(PRODUCT_DID);
  await Promise.resolve();
  assertEquals(calls, 2);
  finish(emptySyncResult());
  await afterExpiry;
});

function emptySyncResult() {
  return {
    managed: true,
    recordsSeen: 0,
    recordsSynced: 0,
    recordsSkipped: 0,
  };
}
