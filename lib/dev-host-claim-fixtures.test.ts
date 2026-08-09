import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  DEV_HOST_CLAIM_ACCOUNTS,
  DEV_HOST_CLAIM_HOSTS,
  isSafeDevHostClaimFixtureDatabaseForTest,
} from "./dev-host-claim-fixtures.ts";

Deno.test("host claim lab has stable, distinct accounts and hosts", () => {
  const accounts = Object.values(DEV_HOST_CLAIM_ACCOUNTS);
  const hosts = Object.values(DEV_HOST_CLAIM_HOSTS);
  assertEquals(new Set(accounts.map((account) => account.did)).size, 3);
  assertEquals(new Set(accounts.map((account) => account.handle)).size, 3);
  assertEquals(new Set(hosts.map((host) => host.host)).size, hosts.length);
  assert(DEV_HOST_CLAIM_HOSTS.localUnclaimed.host.endsWith(".test"));
  assert(DEV_HOST_CLAIM_HOSTS.appUnclaimed.host.endsWith(".test"));
  assert(DEV_HOST_CLAIM_HOSTS.appLinked.host.endsWith(".test"));
  assert(!DEV_HOST_CLAIM_HOSTS.detectedDns.host.endsWith(".test"));
  assert(!DEV_HOST_CLAIM_HOSTS.transferClaimed.host.endsWith(".test"));
});

Deno.test("host claim fixtures refuse hosted and remote databases", () => {
  assertEquals(
    isSafeDevHostClaimFixtureDatabaseForTest({
      isDev: true,
      backend: "turso",
      databaseUrl: "file:./local.db",
    }),
    true,
  );
  for (
    const input of [
      { isDev: false, backend: "turso", databaseUrl: "file:./local.db" },
      { isDev: true, backend: "postgres", databaseUrl: "file:./local.db" },
      {
        isDev: true,
        backend: "turso",
        databaseUrl: "libsql://production.example",
      },
      { isDev: true, backend: "turso", databaseUrl: null },
    ]
  ) {
    assertEquals(isSafeDevHostClaimFixtureDatabaseForTest(input), false);
  }
});
