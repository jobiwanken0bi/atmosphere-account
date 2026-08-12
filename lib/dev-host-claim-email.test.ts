import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  DEV_HOST_CLAIM_EMAIL_HOSTS,
  devHostClaimEmailOptions,
} from "./dev-host-claim-email.ts";

const safe = {
  isDev: true,
  enabled: "1",
  backend: "turso",
  databaseUrl: "file:local.db",
};

Deno.test("dev contact-email fixtures require every local safety gate", () => {
  const host = DEV_HOST_CLAIM_EMAIL_HOSTS.available;
  assert(devHostClaimEmailOptions(host, safe));
  assertEquals(
    devHostClaimEmailOptions(host, { ...safe, isDev: false }),
    undefined,
  );
  assertEquals(
    devHostClaimEmailOptions(host, { ...safe, enabled: "0" }),
    undefined,
  );
  assertEquals(
    devHostClaimEmailOptions(host, { ...safe, backend: "postgres" }),
    undefined,
  );
  assertEquals(
    devHostClaimEmailOptions(host, {
      ...safe,
      databaseUrl: "libsql://production.example",
    }),
    undefined,
  );
  assertEquals(devHostClaimEmailOptions("other.example", safe), undefined);
});

Deno.test("dev contact-email fixtures distinguish published and absent contact", async () => {
  for (
    const [host, expectedEmail] of [
      [DEV_HOST_CLAIM_EMAIL_HOSTS.available, "host-operator@example.test"],
      [DEV_HOST_CLAIM_EMAIL_HOSTS.unavailable, null],
      [DEV_HOST_CLAIM_EMAIL_HOSTS.recovery, "host-operator@example.test"],
    ] as const
  ) {
    const options = devHostClaimEmailOptions(host, safe);
    assert(options?.fetchImpl);
    const response = await options.fetchImpl(
      `https://${host}/xrpc/com.atproto.server.describeServer`,
    );
    assertEquals(response.status, 200);
    const description = await response.json();
    assertEquals(description.did, `did:web:${host}`);
    assertEquals(description.contact?.email ?? null, expectedEmail);
  }
});
