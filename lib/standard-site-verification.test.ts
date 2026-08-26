import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveStandardSiteDocumentVerification,
  resolveStandardSitePublicationVerification,
  standardSitePublicationVerificationResponse,
  standardSitePublicationWellKnownPath,
  type StandardSiteVerificationDependencies,
} from "./standard-site-verification.ts";
import {
  atmosphereStandardSiteAppTag,
  STANDARD_SITE_DOCUMENT_NSID,
  STANDARD_SITE_PUBLICATION_NSID,
} from "./standard-site-updates.ts";

const DID = "did:plc:product";
const APP_ID = "app-grain";
const RKEY = "3m4standardxx";
const PUBLICATION_RKEY = "3m4publicatxx";
const PUBLICATION_URI =
  `at://${DID}/${STANDARD_SITE_PUBLICATION_NSID}/${PUBLICATION_RKEY}`;
const DOCUMENT_URI = `at://${DID}/${STANDARD_SITE_DOCUMENT_NSID}/${RKEY}`;

function dependencies(
  documentOverrides: Record<string, unknown> = {},
  publicationUrl = "https://atmosphereaccount.com/apps/grain",
): StandardSiteVerificationDependencies {
  return {
    siteUrl: "https://atmosphereaccount.com",
    getListing: (slug) =>
      Promise.resolve(
        slug === "grain" || slug === "old-grain"
          ? { id: APP_ID, slug: "grain", productDid: DID }
          : null,
      ),
    resolvePds: () => Promise.resolve("https://pds.example"),
    getPublicationBinding: (appId, url) =>
      Promise.resolve(
        appId === APP_ID && url === publicationUrl
          ? { publicationUri: PUBLICATION_URI, publicationUrl: url }
          : null,
      ),
    getPublicationBindingByUri: (appId, uri) =>
      Promise.resolve(
        appId === APP_ID && uri === PUBLICATION_URI
          ? {
            publicationUri: PUBLICATION_URI,
            publicationUrl,
          }
          : null,
      ),
    getDocument: (_pdsUrl, _did, collection) =>
      collection === STANDARD_SITE_PUBLICATION_NSID
        ? Promise.resolve({
          uri: PUBLICATION_URI,
          value: {
            $type: STANDARD_SITE_PUBLICATION_NSID,
            url: publicationUrl,
            name: "Grain updates",
          },
        })
        : Promise.resolve({
          uri: DOCUMENT_URI,
          value: {
            $type: STANDARD_SITE_DOCUMENT_NSID,
            site: PUBLICATION_URI,
            path: `${new URL(publicationUrl).pathname}?update=${RKEY}`,
            title: "Grain 2.0",
            tags: [atmosphereStandardSiteAppTag(APP_ID)],
            publishedAt: "2026-08-26T12:00:00.000Z",
            ...documentOverrides,
          },
        }),
  };
}

Deno.test("publication verification resolves the exact non-root app URL", async () => {
  const path = standardSitePublicationWellKnownPath("grain");
  assertEquals(path, "/.well-known/site.standard.publication/apps/grain");
  assertEquals(
    await resolveStandardSitePublicationVerification(path, dependencies()),
    PUBLICATION_URI,
  );
  assertEquals(
    await resolveStandardSitePublicationVerification(
      "/.well-known/site.standard.publication/apps/grain/extra",
      dependencies(),
    ),
    null,
  );

  const response = await standardSitePublicationVerificationResponse(
    new Request(`https://atmosphereaccount.com${path}`),
    dependencies(),
  );
  assertEquals(response?.status, 200);
  assertEquals(await response?.text(), PUBLICATION_URI);
  assertStringIncludes(
    response?.headers.get("content-type") ?? "",
    "text/plain",
  );

  const historicalPath = standardSitePublicationWellKnownPath("old-grain");
  assertEquals(
    await resolveStandardSitePublicationVerification(
      historicalPath,
      dependencies(
        {},
        "https://atmosphereaccount.com/apps/old-grain",
      ),
    ),
    PUBLICATION_URI,
  );
});

Deno.test("document verification requires the asserted publication and path", async () => {
  const input = {
    appId: APP_ID,
    slug: "grain",
    productDid: DID,
    rkey: RKEY,
    pathname: "/apps/grain",
    search: `?update=${RKEY}`,
  };
  assertEquals(
    await resolveStandardSiteDocumentVerification(input, dependencies()),
    DOCUMENT_URI,
  );
  assertEquals(
    await resolveStandardSiteDocumentVerification(
      input,
      dependencies({ site: "https://blog.example" }),
    ),
    null,
  );
  assertEquals(
    await resolveStandardSiteDocumentVerification(
      input,
      dependencies({ path: "/blog/grain-2" }),
    ),
    null,
  );
  assertEquals(
    await resolveStandardSiteDocumentVerification(
      { ...input, pathname: "/apps/grain-alias" },
      dependencies(),
    ),
    null,
  );
  assertEquals(
    await resolveStandardSiteDocumentVerification(
      { ...input, search: `?update=${RKEY}&tracking=1` },
      dependencies(),
    ),
    null,
  );
  assertEquals(
    await resolveStandardSiteDocumentVerification(
      { ...input, slug: "old-grain", pathname: "/apps/old-grain" },
      dependencies(
        {},
        "https://atmosphereaccount.com/apps/old-grain",
      ),
    ),
    DOCUMENT_URI,
  );
  assertEquals(
    await resolveStandardSiteDocumentVerification(
      input,
      dependencies({ tags: [atmosphereStandardSiteAppTag("another-app")] }),
    ),
    null,
  );
});
