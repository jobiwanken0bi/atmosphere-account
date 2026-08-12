import { assertMatch } from "jsr:@std/assert@1";

Deno.test("PDS inventory cron closes its persistent database pool", async () => {
  const source = await Deno.readTextFile(
    new URL("./index-relay-pds-inventory.ts", import.meta.url),
  );

  assertMatch(source, /finally\s*\{/);
  assertMatch(source, /await withDb\(closePostgresExecuteClient\)/);
});
