import { appHrefForHost, hostHrefForApp } from "./directory-identity-links.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("app-to-host links use the matched account host", () => {
  assertEquals(
    hostHrefForApp({ accountHost: "bsky.network" }),
    "/hosts/bsky.network",
  );
  assertEquals(hostHrefForApp({ accountHost: null }), null);
});

Deno.test("host-to-app links require the same profile DID and host", () => {
  const app = {
    slug: "bluesky",
    productDid: "did:plc:bluesky",
    profileDid: null,
    legacyProfileDid: null,
    accountHost: "bsky.network",
  };

  assertEquals(
    appHrefForHost(
      { host: "bsky.network", profileDid: "did:plc:bluesky" },
      app,
    ),
    "/apps/bluesky",
  );
  assertEquals(
    appHrefForHost(
      { host: "other.example", profileDid: "did:plc:bluesky" },
      app,
    ),
    null,
  );
  assertEquals(
    appHrefForHost(
      { host: "bsky.network", profileDid: "did:plc:other" },
      app,
    ),
    null,
  );
});
