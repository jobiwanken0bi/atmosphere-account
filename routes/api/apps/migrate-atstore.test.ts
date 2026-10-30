import { assertEquals } from "jsr:@std/assert@1";
import { lookupAtstoreMigrationOwnership } from "../../../lib/atstore-migration.ts";

Deno.test("legacy migration fails closed when authoritative PDS discovery fails", async () => {
  const result = await lookupAtstoreMigrationOwnership(
    "did:plc:app",
    "https://pds.example",
    () => Promise.reject(new Error("offline")),
  );
  assertEquals(result, { ok: false });
});

Deno.test("legacy migration still accepts an existing shared app target", async () => {
  const existing = {
    uri: "at://did:plc:app/fyi.atstore.listing.detail/3mzzzzzzzzzzz",
    cid: "bafyexisting",
    rkey: "3mzzzzzzzzzzz",
    value: { productAccountDid: "did:plc:app" },
  };
  const result = await lookupAtstoreMigrationOwnership(
    "did:plc:app",
    "https://pds.example",
    () => Promise.resolve(existing),
  );
  assertEquals(result, { ok: true, record: existing });
});
