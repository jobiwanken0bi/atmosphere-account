import { createRecord, listRecordsPublic } from "./pds.ts";
import {
  buildStandardSitePublication,
  createStandardSiteRkey,
  parseStandardSitePublication,
  STANDARD_SITE_PUBLICATION_NSID,
  type StandardSitePublicationRecord,
  standardSitePublicationUri,
} from "./standard-site-updates.ts";

export interface StandardSitePublicationRef {
  uri: string;
  cid: string;
  rkey: string;
  value: StandardSitePublicationRecord;
}

interface StandardSitePublicationDeps {
  listRecords?: typeof listRecordsPublic;
  createRecord?: typeof createRecord;
  createRkey?: () => string;
}

/**
 * Find the publication Atmosphere owns for one app page. A product account
 * may also contain a blog or another Standard.site publication, so matching
 * by the exact normalized URL is required; the first publication is not a
 * safe default for authoring.
 */
export async function findStandardSitePublicationByUrl(
  input: { did: string; pdsUrl: string; url: string },
  deps: StandardSitePublicationDeps = {},
): Promise<StandardSitePublicationRef | null> {
  const desired = buildStandardSitePublication({
    url: input.url,
    name: "Atmosphere app updates",
  }).url;
  const list = deps.listRecords ?? listRecordsPublic;
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await list(
      input.pdsUrl,
      input.did,
      STANDARD_SITE_PUBLICATION_NSID,
      { limit: 100, cursor },
    );
    for (const row of page.records) {
      const value = parseStandardSitePublication(row.value);
      if (!value || value.url !== desired) continue;
      const rkey = row.uri.split("/").at(-1) ?? "";
      if (!rkey) continue;
      return { uri: row.uri, cid: row.cid, rkey, value };
    }
    cursor = page.cursor;
    pages += 1;
  } while (cursor && pages < 10);
  return null;
}

/** Create the app-page publication on the first update, then reuse it. */
export async function ensureStandardSitePublication(
  input: {
    did: string;
    pdsUrl: string;
    url: string;
    name: string;
    description?: string | null;
  },
  deps: StandardSitePublicationDeps = {},
): Promise<StandardSitePublicationRef> {
  const existing = await findStandardSitePublicationByUrl(input, deps);
  if (existing) return existing;

  const value = buildStandardSitePublication({
    url: input.url,
    name: input.name,
    description: input.description,
    showInDiscover: false,
  });
  const rkey = (deps.createRkey ?? createStandardSiteRkey)();
  const result = await (deps.createRecord ?? createRecord)(
    input.did,
    input.pdsUrl,
    STANDARD_SITE_PUBLICATION_NSID,
    value as unknown as Record<string, unknown>,
    rkey,
  );
  return {
    uri: result.uri || standardSitePublicationUri(input.did, rkey),
    cid: result.cid,
    rkey,
    value,
  };
}
