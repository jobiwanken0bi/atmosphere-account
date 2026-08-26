import { createClient } from "@libsql/client";
import { assertEquals } from "jsr:@std/assert@1";
import type { DbClient } from "./db.ts";
import { UPDATE_NSID } from "./lexicons.ts";
import { markMissingStandardSiteProfileUpdatesRemovedInDb } from "./profile-updates.ts";
import { STANDARD_SITE_DOCUMENT_NSID } from "./standard-site-updates.ts";

const PRODUCT_DID = "did:plc:standard-site-reconcile";
const OTHER_DID = "did:plc:other-standard-site-reconcile";

Deno.test("complete Standard.site reconciliation tombstones only missing document URIs", async () => {
  const db = createClient({ url: "file::memory:" });
  await db.execute(`CREATE TABLE profile_update (
    uri TEXT PRIMARY KEY,
    project_did TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL
  )`);

  const liveUri = standardDocumentUri(PRODUCT_DID, "live");
  const missingUri = standardDocumentUri(PRODUCT_DID, "missing");
  const alreadyRemovedUri = standardDocumentUri(PRODUCT_DID, "removed");
  const indexedAfterScanUri = standardDocumentUri(PRODUCT_DID, "concurrent");
  const legacySameRkeyUri = `at://${PRODUCT_DID}/${UPDATE_NSID}/missing`;
  const otherProductUri = standardDocumentUri(OTHER_DID, "missing");
  const rows: Array<[string, string, string, number]> = [
    [liveUri, PRODUCT_DID, "visible", 1],
    [missingUri, PRODUCT_DID, "visible", 1],
    [alreadyRemovedUri, PRODUCT_DID, "removed", 1],
    [indexedAfterScanUri, PRODUCT_DID, "visible", 2],
    [legacySameRkeyUri, PRODUCT_DID, "visible", 1],
    [otherProductUri, OTHER_DID, "visible", 1],
  ];
  for (const [uri, projectDid, status, indexedAt] of rows) {
    await db.execute({
      sql: `INSERT INTO profile_update VALUES (?, ?, ?, 1, ?)`,
      args: [uri, projectDid, status, indexedAt],
    });
  }

  const removed = await markMissingStandardSiteProfileUpdatesRemovedInDb(
    db as unknown as DbClient,
    PRODUCT_DID,
    new Set([liveUri]),
    2,
  );
  assertEquals(removed, 1);

  const result = await db.execute(
    `SELECT uri, status FROM profile_update ORDER BY uri`,
  );
  assertEquals(
    result.rows.map((row) => [row.uri, row.status]),
    [
      [legacySameRkeyUri, "visible"],
      [indexedAfterScanUri, "visible"],
      [liveUri, "visible"],
      [missingUri, "removed"],
      [alreadyRemovedUri, "removed"],
      [otherProductUri, "visible"],
    ].sort(([left], [right]) => String(left).localeCompare(String(right))),
  );

  assertEquals(
    await markMissingStandardSiteProfileUpdatesRemovedInDb(
      db as unknown as DbClient,
      PRODUCT_DID,
      new Set([liveUri]),
      2,
    ),
    0,
  );
  db.close();
});

function standardDocumentUri(did: string, rkey: string): string {
  return `at://${did}/${STANDARD_SITE_DOCUMENT_NSID}/${rkey}`;
}
