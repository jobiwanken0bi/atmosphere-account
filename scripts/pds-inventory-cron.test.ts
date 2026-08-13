import { assertMatch } from "jsr:@std/assert@1";

Deno.test("PDS inventory cron is bounded, leased, observable, and closes its pool", async () => {
  const source = await Deno.readTextFile(
    new URL("./index-relay-pds-inventory.ts", import.meta.url),
  );

  assertMatch(source, /finally\s*\{/);
  assertMatch(source, /await withDb\(closePostgresExecuteClient\)/);
  assertMatch(source, /tryAcquireWorkerLease\(/);
  assertMatch(source, /renewWorkerLease\(/);
  assertMatch(source, /releaseWorkerLease\(/);
  assertMatch(source, /PDS_INVENTORY_DEADLINE_MS/);
  assertMatch(source, /pds_inventory_completed/);
  assertMatch(source, /pds_inventory_failed/);
  assertMatch(source, /pds_inventory_forced_exit/);
  assertMatch(source, /if \(fetched\.complete/);
  assertMatch(
    source,
    /maintainAccountHostDirectory\(\{ signal: deadline\.signal \}\)/,
  );
  assertMatch(source, /pds_inventory_directory_maintenance_failed/);
  assertMatch(source, /Deno\.exit\(await runPdsInventory\(\)\)/);
});
