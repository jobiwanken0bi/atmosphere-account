import { withDb } from "./db.ts";
import {
  buildStandardSitePublication,
  standardSitePublicationRkeyFromUri,
  standardSitePublicationUri,
} from "./standard-site-updates.ts";

export interface StandardSitePublicationBinding {
  appListingId: string;
  publicationUrl: string;
  publicationUri: string;
  createdAt: number;
  updatedAt: number;
}

interface RawBinding {
  app_listing_id: string;
  publication_url: string;
  publication_uri: string;
  created_at: number;
  updated_at: number;
}

/** Return the durable publication selected for one immutable app + URL. */
export async function getStandardSitePublicationBinding(
  appListingId: string,
  publicationUrl: string,
): Promise<StandardSitePublicationBinding | null> {
  const appId = normalizedAppId(appListingId);
  const url = normalizedPublicationUrl(publicationUrl);
  if (!appId || !url) return null;
  return await withDb(async (client) => {
    const result = await client.execute({
      sql: `
        SELECT * FROM app_standard_site_publication
        WHERE app_listing_id = ? AND publication_url = ?
        LIMIT 1
      `,
      args: [appId, url],
    });
    return result.rows[0]
      ? rowToBinding(result.rows[0] as unknown as RawBinding)
      : null;
  });
}

/** Check immutable ownership when mutating an existing document. */
export async function getStandardSitePublicationBindingByUri(
  appListingId: string,
  publicationUri: string,
): Promise<StandardSitePublicationBinding | null> {
  const appId = normalizedAppId(appListingId);
  const uri = publicationUri.trim();
  if (!appId || !uri.startsWith("at://") || uri.length > 512) return null;
  return await withDb(async (client) => {
    const result = await client.execute({
      sql: `
        SELECT * FROM app_standard_site_publication
        WHERE app_listing_id = ? AND publication_uri = ?
        LIMIT 1
      `,
      args: [appId, uri],
    });
    return result.rows[0]
      ? rowToBinding(result.rows[0] as unknown as RawBinding)
      : null;
  });
}

/**
 * Atomically select one publication URI for an app URL. If concurrent first
 * publishes propose different records, the first committed binding wins and
 * every caller receives that same durable URI.
 */
export async function claimStandardSitePublicationBinding(input: {
  appListingId: string;
  productDid: string;
  publicationUrl: string;
  publicationUri: string;
}): Promise<StandardSitePublicationBinding> {
  const appId = normalizedAppId(input.appListingId);
  const productDid = normalizedProductDid(input.productDid);
  const url = normalizedPublicationUrl(input.publicationUrl);
  const uri = input.publicationUri.trim();
  const rkey = productDid
    ? standardSitePublicationRkeyFromUri(uri, productDid)
    : null;
  if (
    !appId || !productDid || !url || !rkey || uri.length > 512 ||
    uri !== standardSitePublicationUri(productDid, rkey)
  ) {
    throw new Error("invalid Standard.site publication binding");
  }
  return await withDb(async (client) => {
    const now = Date.now();
    await client.execute({
      sql: `
        INSERT INTO app_standard_site_publication (
          app_listing_id, publication_url, publication_uri, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(app_listing_id, publication_url) DO NOTHING
      `,
      args: [appId, url, uri, now, now],
    });
    const result = await client.execute({
      sql: `
        SELECT * FROM app_standard_site_publication
        WHERE app_listing_id = ? AND publication_url = ?
        LIMIT 1
      `,
      args: [appId, url],
    });
    if (!result.rows[0]) {
      throw new Error("Standard.site publication binding was not persisted");
    }
    return rowToBinding(result.rows[0] as unknown as RawBinding);
  });
}

function normalizedAppId(value: string): string | null {
  const appId = value.trim();
  return appId && appId.length <= 256 ? appId : null;
}

function normalizedProductDid(value: string): string | null {
  const did = value.trim();
  return did.startsWith("did:") && did.length <= 512 ? did : null;
}

function normalizedPublicationUrl(value: string): string | null {
  try {
    return buildStandardSitePublication({
      url: value,
      name: "Atmosphere app updates",
    }).url;
  } catch {
    return null;
  }
}

function rowToBinding(row: RawBinding): StandardSitePublicationBinding {
  return {
    appListingId: row.app_listing_id,
    publicationUrl: row.publication_url,
    publicationUri: row.publication_uri,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
