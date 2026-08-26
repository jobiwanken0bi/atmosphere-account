import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ensureStandardSitePublication,
  findStandardSitePublicationByUrl,
} from "./standard-site-publishing.ts";
import { STANDARD_SITE_PUBLICATION_NSID } from "./standard-site-updates.ts";

const DID = "did:plc:standardsiteexample";
const TID = "3m4standardxx";

Deno.test("publication lookup matches the exact normalized app URL", async () => {
  const found = await findStandardSitePublicationByUrl({
    did: DID,
    pdsUrl: "https://pds.example",
    url: "https://atmosphereaccount.com/apps/grain/",
  }, {
    listRecords: (_pds, did, collection) => {
      assertEquals(did, DID);
      assertEquals(collection, STANDARD_SITE_PUBLICATION_NSID);
      return Promise.resolve({
        records: [
          {
            uri: `at://${DID}/${collection}/3m4anotherxxx`,
            cid: "bafy-other",
            value: { url: "https://blog.example", name: "Blog" },
          },
          {
            uri: `at://${DID}/${collection}/${TID}`,
            cid: "bafy-match",
            value: {
              url: "https://atmosphereaccount.com/apps/grain",
              name: "Grain updates",
            },
          },
        ],
      });
    },
  });
  assertEquals(found?.rkey, TID);
  assertEquals(found?.cid, "bafy-match");
});

Deno.test("publication creation is private to the Atmosphere app page", async () => {
  let written: Record<string, unknown> | null = null;
  const result = await ensureStandardSitePublication({
    did: DID,
    pdsUrl: "https://pds.example",
    url: "https://atmosphereaccount.com/apps/grain",
    name: "Grain updates",
    description: "Product news from Grain.",
  }, {
    listRecords: () => Promise.resolve({ records: [] }),
    createRkey: () => TID,
    createRecord: (_did, _pds, collection, value, rkey) => {
      assertEquals(collection, STANDARD_SITE_PUBLICATION_NSID);
      assertEquals(rkey, TID);
      written = value;
      return Promise.resolve({ uri: "", cid: "bafy-created" });
    },
  });
  assertEquals(result.rkey, TID);
  assertEquals(
    result.uri,
    `at://${DID}/${STANDARD_SITE_PUBLICATION_NSID}/${TID}`,
  );
  assertEquals(
    (written as unknown as Record<string, unknown>).preferences,
    { showInDiscover: false },
  );
});
