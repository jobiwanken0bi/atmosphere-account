import { hostPdsDomain } from "./host-friendly.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("hostPdsDomain uses the public service endpoint hostname", () => {
  assertEquals(
    hostPdsDomain({
      host: "bsky.network",
      serviceEndpoint: "https://BSKY.SOCIAL/xrpc",
    }),
    "bsky.social",
  );
});

Deno.test("hostPdsDomain falls back to the inventory host", () => {
  assertEquals(
    hostPdsDomain({ host: "example.host", serviceEndpoint: null }),
    "example.host",
  );
  assertEquals(
    hostPdsDomain({ host: "example.host", serviceEndpoint: "not a URL" }),
    "example.host",
  );
});
