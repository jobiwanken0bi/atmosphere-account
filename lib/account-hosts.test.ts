import {
  accountHostAvailability,
  DEFAULT_ACCOUNT_HOST_SORT,
  isAccountHostPubliclyListable,
  listSeededAccountHostFallback,
  lookupAccountHostHint,
  normalizeAccountHostPublicHttpsUrl,
  normalizeAccountHostPublicServiceEndpoint,
  profileHandleCandidatesForHost,
  sortAccountHostsForDirectory,
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
  assert(hosts.length >= 14);
  assert(hosts.some((host) => host.host === "bsky.network"));
  assert(hosts.some((host) => host.host === "blacksky.community"));
  assert(hosts.some((host) => host.host === "pckt.cafe"));
  assertEquals(
    hosts.find((host) => host.host === "atproto.brid.gy")?.profileHandle,
    "ap.brid.gy",
  );
  assertEquals(
    hosts.find((host) => host.host === "pds.wsocial.network")?.profileHandle,
    "wsocial.eu",
  );
  assertEquals(
    hosts.find((host) => host.host === "roomy.chat")?.profileHandle,
    "roomy.space",
  );
  assertEquals(
    hosts.find((host) => host.host === "northsky.social")?.profileHandle,
    "transrights.northsky.social",
  );
  assertEquals(
    hosts.find((host) => host.host === "bookhive.social")?.profileHandle,
    "bookhive.buzz",
  );
});

Deno.test("seeded social identities preserve their separate PDS domains", () => {
  const hosts = listSeededAccountHostFallback();
  const bridgy = hosts.find((host) => host.host === "atproto.brid.gy");
  const wsocial = hosts.find((host) => host.host === "pds.wsocial.network");
  assertEquals(bridgy?.serviceEndpoint, "https://atproto.brid.gy");
  assertEquals(wsocial?.serviceEndpoint, "https://pds.wsocial.network");
  assertEquals(wsocial?.signupStatus, "invite_required");
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

Deno.test("host directory sorts providers by total accounts", () => {
  const [first, second, third] = listSeededAccountHostFallback().slice(0, 3);
  assert(first && second && third, "expected seeded hosts");
  const hosts = [
    { ...first, observedAccountCount: 20, observedActiveAccountCount: 4 },
    { ...second, observedAccountCount: 5, observedActiveAccountCount: 5 },
    { ...third, observedAccountCount: 40, observedActiveAccountCount: 1 },
  ];
  assertEquals(
    sortAccountHostsForDirectory(hosts, "accounts").map((host) => host.host),
    [third.host, first.host, second.host],
  );
});

Deno.test("default host sort prioritizes account count before claims", () => {
  const [first, second, third, fourth] = listSeededAccountHostFallback().slice(
    0,
    4,
  );
  assert(first && second && third && fourth, "expected seeded hosts");
  const observedActive = {
    ...first,
    verificationStatus: "observed" as const,
    observedAccountCount: 10_000,
    observedActiveAccountCount: 10_000,
  };
  const claimedInactive = {
    ...second,
    verificationStatus: "claimed" as const,
    observedAccountCount: 100,
    observedActiveAccountCount: 0,
  };
  const claimedActiveSmall = {
    ...third,
    verificationStatus: "claimed" as const,
    observedAccountCount: 5,
    observedActiveAccountCount: 5,
  };
  const verifiedActiveLarge = {
    ...fourth,
    verificationStatus: "verified" as const,
    observedAccountCount: 50,
    observedActiveAccountCount: 10,
  };

  assertEquals(
    sortAccountHostsForDirectory([
      observedActive,
      claimedInactive,
      claimedActiveSmall,
      verifiedActiveLarge,
    ], DEFAULT_ACCOUNT_HOST_SORT).map((host) => host.host),
    [
      observedActive.host,
      claimedInactive.host,
      verifiedActiveLarge.host,
      claimedActiveSmall.host,
    ],
  );

  assertEquals(
    sortAccountHostsForDirectory([
      { ...observedActive, observedAccountCount: 100 },
      { ...claimedInactive, observedAccountCount: 100 },
      { ...claimedActiveSmall, observedAccountCount: 100 },
    ], DEFAULT_ACCOUNT_HOST_SORT).map((host) => host.host),
    [
      claimedInactive.host,
      claimedActiveSmall.host,
      observedActive.host,
    ],
  );
});

Deno.test("public host policy requires recent reachability and public intent", () => {
  const now = 1_000_000_000;
  const base = {
    ...listSeededAccountHostFallback()[0],
    source: "observed" as const,
    verificationStatus: "observed" as const,
    signupUrl: null,
    serviceRecordUri: null,
    observedActiveAccountCount: 1,
    lastIndexedAccountAt: now,
    lastActiveAt: now,
  };
  assertEquals(isAccountHostPubliclyListable(base, now), false);
  assertEquals(
    isAccountHostPubliclyListable(
      { ...base, serviceRecordUri: "at://host" },
      now,
    ),
    false,
  );
  assertEquals(
    isAccountHostPubliclyListable({
      ...base,
      signupUrl: "https://host.example/signup",
    }, now),
    true,
  );
  assertEquals(
    isAccountHostPubliclyListable({
      ...base,
      serviceRecordUri: "at://host",
      lastIndexedAccountAt: 0,
    }, now),
    false,
  );
  assertEquals(
    isAccountHostPubliclyListable({
      ...base,
      publicIntentStatus: "detected",
      publicIntentSource: "pds_open_signup",
      publicIntentCheckedAt: now,
    }, now),
    true,
  );
  assertEquals(
    isAccountHostPubliclyListable({
      ...base,
      publicIntentStatus: "detected",
      publicIntentSource: "pds_open_signup",
      publicIntentCheckedAt: 0,
    }, now),
    false,
  );
});

Deno.test("claimed hosts receive a short inactivity grace period", () => {
  const now = 1_000_000_000;
  const base = {
    ...listSeededAccountHostFallback()[0],
    source: "manual" as const,
    verificationStatus: "claimed" as const,
    observedActiveAccountCount: 0,
    lastIndexedAccountAt: now,
    lastActiveAt: now - 60 * 60 * 1000,
  };
  assertEquals(isAccountHostPubliclyListable(base, now), true);
  assertEquals(
    isAccountHostPubliclyListable({ ...base, lastActiveAt: 0 }, now),
    false,
  );
  assertEquals(
    isAccountHostPubliclyListable({
      ...base,
      lastActiveAt: 0,
      conformanceStatus: "passed",
      conformanceExpiresAt: now + 1,
    }, now),
    true,
  );
});

Deno.test("host availability distinguishes directory baseline from grace exceptions", () => {
  const now = 1_000_000_000;
  const host = {
    ...listSeededAccountHostFallback()[0],
    verificationStatus: "claimed" as const,
    observedActiveAccountCount: 4,
    lastIndexedAccountAt: now,
    lastActiveAt: now,
  };
  assertEquals(accountHostAvailability(host, now), "relay_active");
  assertEquals(
    accountHostAvailability({
      ...host,
      observedActiveAccountCount: 0,
      conformanceStatus: "passed",
      conformanceExpiresAt: now + 1,
    }, now),
    "reachable",
  );
  assertEquals(
    accountHostAvailability({
      ...host,
      observedActiveAccountCount: 0,
    }, now),
    "grace",
  );
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

Deno.test("account host hints aggregate known provider PDS aliases", () => {
  assertEquals(lookupAccountHostHint("https://blacksky.app"), {
    host: "blacksky.community",
    displayName: "Blacksky",
    endpoint: "https://blacksky.app",
    verificationStatus: "observed",
  });
  assertEquals(lookupAccountHostHint("https://tngl.sh"), {
    host: "tangled.org",
    displayName: "Tangled",
    endpoint: "https://tngl.sh",
    verificationStatus: "observed",
  });
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

Deno.test("host profile refresh checks the host-domain handle before the configured social handle", () => {
  assertEquals(
    profileHandleCandidatesForHost({
      host: "pckt.cafe",
      profileHandle: "pckt.blog",
    }),
    ["pckt.cafe", "pckt.blog"],
  );
  assertEquals(
    profileHandleCandidatesForHost({
      host: "sprk.so",
      profileHandle: "sprk.so",
    }),
    ["sprk.so"],
  );
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
      signupUrl: "https://127.0.0.1/signup",
      serviceEndpoint: "https://pds.pckt.cafe",
      signupStatus: "open",
    }, user),
    {
      ok: false,
      reason: "invalid_signup_url",
      message: "Use an HTTPS URL for the host signup flow.",
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
