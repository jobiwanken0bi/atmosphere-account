import {
  listSeededAccountHostFallback,
  lookupAccountHostHint,
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
