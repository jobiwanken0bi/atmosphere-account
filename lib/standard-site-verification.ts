import { getAppListingByIdentifier } from "./app-directory.ts";
import { SITE_URL } from "./env.ts";
import { findPdsEndpoint, resolveDidDocument } from "./identity.ts";
import { getRecordPublic } from "./pds.ts";
import {
  getStandardSitePublicationBinding,
  getStandardSitePublicationBindingByUri,
} from "./standard-site-publication-bindings.ts";
import {
  atmosphereStandardSiteAppIdFromTags,
  atmosphereStandardSiteDocumentSlug,
  isStandardSiteRkey,
  parseStandardSiteDocument,
  parseStandardSitePublication,
  STANDARD_SITE_DOCUMENT_NSID,
  STANDARD_SITE_PUBLICATION_NSID,
  standardSiteDocumentUri,
  standardSitePublicationRkeyFromUri,
} from "./standard-site-updates.ts";
import { define } from "../utils.ts";

const PUBLICATION_WELL_KNOWN_PREFIX =
  "/.well-known/site.standard.publication/apps/";

interface StandardSiteVerificationListing {
  id: string;
  slug: string;
  productDid: string | null;
}

export interface StandardSiteVerificationDependencies {
  siteUrl: string;
  getListing: (
    slug: string,
  ) => Promise<StandardSiteVerificationListing | null>;
  resolvePds: (did: string) => Promise<string>;
  getPublicationBinding: (
    appId: string,
    publicationUrl: string,
  ) => Promise<
    {
      publicationUri: string;
      publicationUrl: string;
    } | null
  >;
  getPublicationBindingByUri: (
    appId: string,
    publicationUri: string,
  ) => Promise<
    {
      publicationUri: string;
      publicationUrl: string;
    } | null
  >;
  getDocument: (
    pdsUrl: string,
    did: string,
    collection: string,
    rkey: string,
  ) => Promise<{ uri: string; value: unknown } | null>;
}

export interface StandardSiteDocumentVerificationInput {
  appId: string;
  slug: string;
  productDid: string | null;
  rkey: string;
  pathname: string;
  search: string;
}

/** Verification endpoint for a publication whose URL is `/apps/<slug>`. */
export function standardSitePublicationWellKnownPath(slug: string): string {
  const normalized = slug.trim();
  if (!normalized || normalized.includes("/")) {
    throw new Error("publication slug must be a non-empty path segment");
  }
  return `${PUBLICATION_WELL_KNOWN_PREFIX}${encodeURIComponent(normalized)}`;
}

export async function resolveStandardSitePublicationVerification(
  pathname: string,
  dependencies: StandardSiteVerificationDependencies,
): Promise<string | null> {
  const slug = publicationSlugFromWellKnownPath(pathname);
  if (!slug) return null;
  const listing = await dependencies.getListing(slug);
  if (
    !listing?.productDid || standardSitePublicationWellKnownPath(slug) !==
      pathname
  ) {
    return null;
  }

  const pdsUrl = await dependencies.resolvePds(listing.productDid);
  const publicationUrl = standardSitePublicationUrl(
    dependencies.siteUrl,
    slug,
  );
  const binding = await dependencies.getPublicationBinding(
    listing.id,
    publicationUrl,
  );
  if (!binding) return null;
  const publication = await loadVerifiedPublication(
    listing.productDid,
    pdsUrl,
    binding,
    dependencies,
  );
  return publication?.uri ?? null;
}

/**
 * Resolve a document backlink only when the requested page is the exact path
 * asserted by both the document and its Atmosphere-owned publication. This
 * avoids claiming unrelated Standard.site posts from the same product repo.
 */
export async function resolveStandardSiteDocumentVerification(
  input: StandardSiteDocumentVerificationInput,
  dependencies: StandardSiteVerificationDependencies,
): Promise<string | null> {
  const did = input.productDid?.trim() ?? "";
  const slug = input.slug.trim();
  const appId = input.appId.trim();
  if (
    !did.startsWith("did:") || !appId || !slug ||
    !isStandardSiteRkey(input.rkey) ||
    input.pathname !== `/apps/${encodeURIComponent(slug)}` ||
    input.search !== `?update=${encodeURIComponent(input.rkey)}`
  ) {
    return null;
  }

  const pdsUrl = await dependencies.resolvePds(did);
  const envelope = await dependencies.getDocument(
    pdsUrl,
    did,
    STANDARD_SITE_DOCUMENT_NSID,
    input.rkey,
  );
  if (!envelope) return null;

  const expectedUri = standardSiteDocumentUri(did, input.rkey);
  const record = parseStandardSiteDocument(envelope.value);
  if (
    envelope.uri !== expectedUri || !record ||
    atmosphereStandardSiteAppIdFromTags(record.tags) !== appId
  ) {
    return null;
  }
  const binding = await dependencies.getPublicationBindingByUri(
    appId,
    record.site,
  );
  if (!binding) return null;
  const publication = await loadVerifiedPublication(
    did,
    pdsUrl,
    binding,
    dependencies,
  );
  if (
    !publication || atmosphereStandardSiteDocumentSlug(record, {
        publicationUrl: publication.url,
        siteUrl: dependencies.siteUrl,
        rkey: input.rkey,
      }) !== slug
  ) {
    return null;
  }
  return expectedUri;
}

export async function standardSitePublicationVerificationResponse(
  request: Request,
  dependencies: StandardSiteVerificationDependencies,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PUBLICATION_WELL_KNOWN_PREFIX)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  try {
    const uri = await resolveStandardSitePublicationVerification(
      url.pathname,
      dependencies,
    );
    if (!uri) return new Response("not found", { status: 404 });
    const headers = {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    };
    return new Response(request.method === "HEAD" ? null : uri, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.warn("[standard-site] publication verification failed", error);
    return new Response("verification unavailable", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}

const runtimeDependencies: StandardSiteVerificationDependencies = {
  siteUrl: SITE_URL,
  getListing: (slug) => getAppListingByIdentifier(slug, { syncLegacy: false }),
  resolvePds: async (did) => findPdsEndpoint(await resolveDidDocument(did)),
  getPublicationBinding: getStandardSitePublicationBinding,
  getPublicationBindingByUri: getStandardSitePublicationBindingByUri,
  getDocument: getRecordPublic,
};

async function loadVerifiedPublication(
  did: string,
  pdsUrl: string,
  binding: { publicationUri: string; publicationUrl: string },
  dependencies: StandardSiteVerificationDependencies,
): Promise<{ uri: string; url: string } | null> {
  const rkey = standardSitePublicationRkeyFromUri(
    binding.publicationUri,
    did,
  );
  if (!rkey) return null;
  const envelope = await dependencies.getDocument(
    pdsUrl,
    did,
    STANDARD_SITE_PUBLICATION_NSID,
    rkey,
  );
  const publication = parseStandardSitePublication(envelope?.value);
  if (
    !envelope || envelope.uri !== binding.publicationUri || !publication ||
    publication.url !== binding.publicationUrl
  ) {
    return null;
  }
  return { uri: envelope.uri, url: publication.url };
}

export const standardSiteVerificationMiddleware = define.middleware(
  async (ctx) => {
    const response = await standardSitePublicationVerificationResponse(
      ctx.req,
      runtimeDependencies,
    );
    return response ?? await ctx.next();
  },
);

export function resolveRuntimeStandardSiteDocumentVerification(
  input: StandardSiteDocumentVerificationInput,
): Promise<string | null> {
  return resolveStandardSiteDocumentVerification(input, runtimeDependencies);
}

function publicationSlugFromWellKnownPath(pathname: string): string | null {
  if (!pathname.startsWith(PUBLICATION_WELL_KNOWN_PREFIX)) return null;
  const encoded = pathname.slice(PUBLICATION_WELL_KNOWN_PREFIX.length);
  if (!encoded || encoded.includes("/")) return null;
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded && !decoded.includes("/") ? decoded : null;
  } catch {
    return null;
  }
}

function standardSitePublicationUrl(siteUrl: string, slug: string): string {
  return new URL(`/apps/${encodeURIComponent(slug)}`, siteUrl).href;
}
