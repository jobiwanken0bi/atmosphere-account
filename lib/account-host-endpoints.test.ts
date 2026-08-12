import {
  accountHostContactEndpoint,
  accountHostContactEndpointIsBound,
  compiledAccountHostServiceEndpoint,
  normalizeAccountHostContactHost,
} from "./account-host-endpoints.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("host contact endpoint is always the normalized host's exact HTTPS origin", () => {
  assertEquals(
    normalizeAccountHostContactHost(" PDS.Example.Social. "),
    "pds.example.social",
  );
  assertEquals(
    accountHostContactEndpoint(" PDS.Example.Social. "),
    "https://pds.example.social",
  );
  assertEquals(
    accountHostContactEndpointIsBound(
      "pds.example.social",
      "https://pds.example.social/",
    ),
    true,
  );
  assertEquals(
    accountHostContactEndpointIsBound(
      "pds.example.social",
      "https://other.example.social/",
    ),
    false,
  );
  assertEquals(
    accountHostContactEndpointIsBound(
      "pds.example.social",
      "https://pds.example.social:444/",
    ),
    false,
  );
  assertEquals(
    accountHostContactEndpointIsBound(
      "pds.example.social",
      "https://pds.example.social/xrpc",
    ),
    false,
  );
});

Deno.test("compiled umbrella mapping is never a contact-proof exception", () => {
  assertEquals(
    compiledAccountHostServiceEndpoint("bsky.network"),
    "https://bsky.social",
  );
  assertEquals(
    accountHostContactEndpoint("bsky.network"),
    "https://bsky.network",
  );
  assertEquals(
    accountHostContactEndpointIsBound("bsky.network", "https://bsky.social"),
    false,
  );
});

Deno.test("host contact endpoint rejects unsafe and malformed hostnames", () => {
  for (
    const value of [
      "localhost",
      "127.0.0.1",
      "169.254.169.254",
      "10.0.0.1",
      "8.8.8.8",
      "host.123",
      "[::1]",
      "2001:4860:4860::8888",
      "pds.local",
      "pds.localhost",
      "pds.test",
      "bad host.social",
      "-bad.example.social",
      "https://pds.example.social",
      "",
    ]
  ) {
    assertEquals(accountHostContactEndpoint(value), null);
  }
});
