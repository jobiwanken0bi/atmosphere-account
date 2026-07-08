import {
  listSeededAccountHostFallback,
  lookupAccountHostHint,
  normalizeAccountHostPublicHttpsUrl,
  normalizeAccountHostPublicServiceEndpoint,
  validateAccountHostRegistrationInput,
} from "./account-hosts.ts";

function assert(condition: unknown, message = "Assertion failed"): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("seeded account host fallback includes known public hosts", () => {
  const hosts = listSeededAccountHostFallback();
  assert(hosts.length >= 9);
  assert(hosts.some((host) => host.host === "bsky.network"));
  assert(hosts.some((host) => host.host === "blacksky.community"));
  assert(hosts.some((host) => host.host === "pckt.cafe"));
});

Deno.test("seeded account host fallback searches friendly host fields", () => {
  assertEquals(
    listSeededAccountHostFallback({ query: "blacksky" }).map((host) =>
      host.host
    ),
    ["blacksky.community"],
  );
  assertEquals(
    listSeededAccountHostFallback({ query: "pckt.blog" }).map((host) =>
      host.host
    ),
    ["pckt.cafe"],
  );
  assertEquals(
    listSeededAccountHostFallback({ query: "Europe" }).map((host) => host.host),
    ["eurosky.social"],
  );
});

Deno.test("seeded account host fallback preserves real empty search states", () => {
  assertEquals(listSeededAccountHostFallback({ query: "zzzz-no-host" }), []);
});

Deno.test("account host hints resolve known Bluesky endpoints without DB hydration", () => {
  assertEquals(lookupAccountHostHint("https://bsky.social"), {
    host: "bsky.network",
    displayName: "Bluesky",
    endpoint: "https://bsky.social",
    verificationStatus: "observed",
  });
  assertEquals(
    lookupAccountHostHint("https://shimeji.us-east.host.bsky.network"),
    {
      host: "bsky.network",
      displayName: "Bluesky",
      endpoint: "https://shimeji.us-east.host.bsky.network",
      verificationStatus: "observed",
    },
  );
});

Deno.test("account host hints fall back to observed endpoint names", () => {
  assertEquals(lookupAccountHostHint("https://pds.example.com"), {
    host: "pds.example.com",
    displayName: "pds.example.com",
    endpoint: "https://pds.example.com",
    verificationStatus: "observed",
  });
  assertEquals(lookupAccountHostHint(null), null);
});

Deno.test("account host public URL normalizer rejects unsafe account links", () => {
  assertEquals(
    normalizeAccountHostPublicHttpsUrl("https://example.host/account#settings"),
    "https://example.host/account",
  );
  for (
    const unsafe of [
      "/account",
      "http://example.host/account",
      "https://user:pass@example.host/account",
      "https://localhost/account",
      "https://127.0.0.1/account",
      "https://10.0.0.8/account",
      "https://[::1]/account",
    ]
  ) {
    assertEquals(normalizeAccountHostPublicHttpsUrl(unsafe), null);
  }
});

Deno.test("account host service endpoint normalizer rejects unsafe origins", () => {
  assertEquals(
    normalizeAccountHostPublicServiceEndpoint("https://pds.example.host/"),
    "https://pds.example.host",
  );
  for (
    const unsafe of [
      "http://pds.example.host",
      "https://user:pass@pds.example.host",
      "https://localhost",
      "https://192.168.1.10",
      "https://[fd00::1]",
    ]
  ) {
    assertEquals(normalizeAccountHostPublicServiceEndpoint(unsafe), null);
  }
});

Deno.test("account host registration validation rejects unsafe fields before publish", () => {
  const user = { did: "did:plc:host", handle: "pckt.cafe" };
  assertEquals(
    validateAccountHostRegistrationInput({
      host: "pckt.cafe",
      displayName: "Pckt",
      serviceEndpoint: "https://127.0.0.1",
      signupStatus: "open",
    }, user),
    {
      ok: false,
      reason: "invalid_service_endpoint",
      message: "Use an HTTPS origin for the host PDS service endpoint.",
    },
  );
  assertEquals(
    validateAccountHostRegistrationInput({
      host: "pckt.cafe",
      displayName: "Pckt",
      serviceEndpoint: "https://pds.pckt.cafe",
      accountManagementUrl: "/account",
      signupStatus: "open",
    }, user),
    {
      ok: false,
      reason: "invalid_account_management_url",
      message: "Use an HTTPS URL for the host account management page.",
    },
  );
});
