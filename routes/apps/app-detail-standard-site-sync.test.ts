import { assertEquals } from "jsr:@std/assert@1";
import type { ProfileUpdateRow } from "../../lib/profile-updates.ts";
import { loadAppDetailUpdates } from "./[handle].tsx";

const PRODUCT_DID = "did:plc:public-app-sync";

Deno.test("public app loads run cached Standard.site sync even with existing updates", async () => {
  const stale = updateRow("old-cid", "Before external edit", 1);
  const refreshed = updateRow("new-cid", "After external edit", 2);
  let reads = 0;
  let refreshedProjection = false;
  const syncedDids: string[] = [];

  const updates = await loadAppDetailUpdates(
    {
      dids: [PRODUCT_DID],
      productDid: PRODUCT_DID,
      appId: "app-id",
      requestedRkey: null,
    },
    {
      listUpdates: () => {
        reads += 1;
        return Promise.resolve(refreshedProjection ? [refreshed] : [stale]);
      },
      syncProduct: (did) => {
        syncedDids.push(did);
        refreshedProjection = true;
        return Promise.resolve();
      },
    },
  );

  assertEquals(syncedDids, [PRODUCT_DID]);
  assertEquals(reads, 1);
  assertEquals(updates.map((update) => update.title), ["After external edit"]);
});

function updateRow(
  cid: string,
  title: string,
  indexedAt: number,
): ProfileUpdateRow {
  return {
    uri: `at://${PRODUCT_DID}/site.standard.document/3m4publicsyncx`,
    cid,
    rkey: "3m4publicsyncx",
    projectDid: PRODUCT_DID,
    title,
    body: "Body",
    version: null,
    tangledCommitUrl: null,
    tangledRepoUrl: null,
    source: "standard_site",
    status: "visible",
    createdAt: 1,
    updatedAt: indexedAt,
    indexedAt,
  };
}
