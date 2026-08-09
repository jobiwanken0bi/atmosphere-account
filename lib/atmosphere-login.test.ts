import {
  ATMOSPHERE_LOGIN_MANIFEST_VERSION,
  buildLoginAppIdentityChecks,
  evaluateLoginAppDomainManifest,
  isUnregisteredDevLoginReturnAllowed,
  type LoginApp,
  loginAppManifestUrl,
  loginAppProfileIdentityChanged,
  loginAppProfileIdentityFromListing,
  loginAppStatusAfterProfileIdentityChange,
  loginEnvironmentMatchesRegistrationForTest,
  LoginRequestError,
  readLoginRequest,
  resolveLoginAppForRequest,
  resolveVerifiedPreferredAccountHost,
  verifyLoginAppDomainManifest,
  verifyPreferredAccountHostForOwner,
} from "./atmosphere-login.ts";
import {
  type AccountHostClaim,
  listSeededAccountHostFallback,
} from "./account-hosts.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("exact owner environment retries are idempotent but drift is not", () => {
  const environment = app();
  const desired = {
    ownerDid: "did:plc:owner",
    profileUri: "at://did:plc:owner/app.profile/example",
    allowedReturnUris: [
      "https://app.example.com/auth/atmosphere/selected",
    ],
    preferredAccountHost: null,
  };
  assertEquals(
    loginEnvironmentMatchesRegistrationForTest(environment, desired),
    true,
  );
  assertEquals(
    loginEnvironmentMatchesRegistrationForTest(environment, {
      ...desired,
      allowedReturnUris: ["https://app.example.com/other"],
    }),
    false,
  );
  assertEquals(
    loginEnvironmentMatchesRegistrationForTest({
      ...environment,
      environmentRevision: "environment-2",
    }, desired),
    true,
  );
  assertEquals(
    loginEnvironmentMatchesRegistrationForTest({
      ...environment,
      allowedOrigins: ["https://legacy.example.com"],
    }, desired),
    false,
  );
});

function app(overrides: Partial<LoginApp> = {}): LoginApp {
  return {
    clientId: "https://app.example.com/oauth/client-metadata.json",
    appName: "Example App",
    appUri: "https://app.example.com",
    logoUri: "https://app.example.com/icon.png",
    appDid: "did:plc:owner",
    appProfileUri: "at://did:plc:owner/app.profile/example",
    appProfileSlug: "example",
    linkStatus: "linked",
    identityAvailable: true,
    loginAvailability: "available",
    allowedReturnUris: [
      "https://app.example.com/auth/atmosphere/selected",
    ],
    allowedOrigins: [],
    status: "unverified",
    reviewStatus: "none",
    reviewRequestedAt: null,
    reviewNotes: null,
    reviewDecisionAt: null,
    reviewDecisionBy: null,
    reviewDecisionReason: null,
    reviewRevision: "review-1",
    environmentRevision: "environment-1",
    contactDid: "did:plc:owner",
    preferredAccountHost: null,
    registered: true,
    ...overrides,
  };
}

const preferredHost = {
  ...listSeededAccountHostFallback()[0],
  host: "accounts.example.com",
  source: "manual" as const,
  signupUrl: "https://accounts.example.com/signup",
  signupStatus: "open" as const,
  verificationStatus: "claimed" as const,
};
const preferredClaim: AccountHostClaim = {
  host: preferredHost.host,
  claimantDid: "did:plc:owner",
  claimantHandle: "owner.example.com",
  method: "oauth_atproto_account",
  claimedAt: 1,
  verifiedAt: 1,
  updatedAt: 1,
};

const preferredAppProfile = {
  did: "did:plc:owner",
  listingId: "app-example",
  profileUri: "at://did:plc:owner/app.profile/example",
  slug: "example",
  name: "Example App",
  homepage: "https://app.example.com/",
  logoUri: "https://app.example.com/icon.png",
  updatedAt: 1,
  loginAvailability: "available" as const,
  identityFingerprint: "profile-v1",
};

Deno.test("app profile identity is canonical and versioned for trust invalidation", () => {
  const first = loginAppProfileIdentityFromListing("did:plc:owner", {
    id: "app-example",
    canonicalUri: "at://did:plc:owner/app.profile/example",
    slug: "example",
    name: "Example App",
    primaryUrl: "https://app.example.com",
    iconUrl: "https://app.example.com/icon.png",
    updatedAt: 100,
  });
  const updated = { ...first, identityFingerprint: "new-profile-version" };
  assertEquals(
    loginAppProfileIdentityChanged({
      appName: first.name,
      appUri: first.homepage,
      logoUri: first.logoUri,
      identityFingerprint: first.identityFingerprint,
    }, first),
    false,
  );
  assertEquals(
    loginAppProfileIdentityChanged({
      appName: first.name,
      appUri: first.homepage,
      logoUri: first.logoUri,
      identityFingerprint: first.identityFingerprint,
    }, updated),
    true,
  );
  assertEquals(
    loginAppStatusAfterProfileIdentityChange(
      "trusted",
      "https://app.example.com/client.json",
      ["https://app.example.com/callback"],
    ),
    "unverified",
  );
  assertEquals(
    loginAppStatusAfterProfileIdentityChange(
      "blocked",
      "https://app.example.com/client.json",
      ["https://app.example.com/callback"],
    ),
    "blocked",
  );
});

Deno.test("derived app identity drops non-web profile URLs", () => {
  const identity = loginAppProfileIdentityFromListing("did:plc:owner", {
    id: "app-example",
    canonicalUri: "at://did:plc:owner/app.profile/example",
    slug: "example",
    name: "Example App",
    primaryUrl: "javascript:alert(1)",
    iconUrl: "data:image/svg+xml,<svg/>",
    updatedAt: 100,
  });
  assertEquals(identity.homepage, null);
  assertEquals(identity.logoUri, null);
});

Deno.test("moderation suspends login without erasing the owner-facing app identity", () => {
  const profile = loginAppProfileIdentityFromListing("did:plc:owner", {
    id: "app-example",
    canonicalUri: "at://did:plc:owner/app.profile/example",
    slug: "example",
    name: "Example App",
    primaryUrl: "https://app.example.com",
    iconUrl: "https://app.example.com/icon.png",
    updatedAt: 100,
  }, "moderated");

  assertEquals(profile.name, "Example App");
  assertEquals(profile.profileUri, "at://did:plc:owner/app.profile/example");
  assertEquals(profile.loginAvailability, "moderated");
});

Deno.test("preferred account host registration requires the app owner's claim", async () => {
  const verified = await verifyPreferredAccountHostForOwner(
    "did:plc:owner",
    preferredHost.host,
    {
      getHost: () => Promise.resolve(preferredHost),
      getClaim: () => Promise.resolve(preferredClaim),
      getAppProfile: () => Promise.resolve(preferredAppProfile),
      listVerifiedLinks: () => Promise.resolve([]),
    },
  );
  assertEquals(verified, preferredHost.host);

  try {
    await verifyPreferredAccountHostForOwner(
      "did:plc:different-owner",
      preferredHost.host,
      {
        getHost: () => Promise.resolve(preferredHost),
        getClaim: () => Promise.resolve(preferredClaim),
        getAppProfile: () =>
          Promise.resolve({
            ...preferredAppProfile,
            did: "did:plc:different-owner",
          }),
        listVerifiedLinks: () => Promise.resolve([]),
      },
    );
    throw new Error("Expected preferred host verification to fail");
  } catch (err) {
    if (!(err instanceof LoginRequestError)) throw err;
    assertEquals(err.status, 400);
  }
});

Deno.test("preferred account host registration fails closed when seeded ownership is stale", async () => {
  try {
    await verifyPreferredAccountHostForOwner(
      "did:plc:owner",
      preferredHost.host,
      {
        getHost: () =>
          Promise.resolve({ ...preferredHost, source: "seeded" as const }),
        getClaim: () => Promise.resolve(preferredClaim),
        getAppProfile: () => Promise.resolve(preferredAppProfile),
        verifyOwner: () => Promise.resolve(null),
        listVerifiedLinks: () => Promise.resolve([]),
      },
    );
    throw new Error("Expected stale seeded ownership to be rejected");
  } catch (err) {
    if (!(err instanceof LoginRequestError)) throw err;
    assertEquals(err.status, 400);
  }
});

Deno.test("preferred account host accepts a currently verified app-host relationship", async () => {
  const verified = await verifyPreferredAccountHostForOwner(
    "did:plc:owner",
    preferredHost.host,
    {
      getHost: () => Promise.resolve(preferredHost),
      getClaim: () =>
        Promise.resolve({
          ...preferredClaim,
          claimantDid: "did:plc:host-operator",
        }),
      getAppProfile: () => Promise.resolve(preferredAppProfile),
      verifyOwner: () => Promise.resolve("did:plc:host-operator"),
      listVerifiedLinks: () =>
        Promise.resolve([{
          host: preferredHost.host,
          relationship: "same_operator",
        }]),
    },
  );
  assertEquals(verified, preferredHost.host);
});

Deno.test("host-only directory links cannot recommend a preferred host", async () => {
  try {
    await verifyPreferredAccountHostForOwner(
      "did:plc:owner",
      preferredHost.host,
      {
        getHost: () => Promise.resolve(preferredHost),
        getClaim: () =>
          Promise.resolve({
            ...preferredClaim,
            claimantDid: "did:plc:host-operator",
          }),
        getAppProfile: () => Promise.resolve(preferredAppProfile),
        verifyOwner: () => Promise.resolve("did:plc:host-operator"),
        listVerifiedLinks: () =>
          Promise.resolve([{
            host: preferredHost.host,
            relationship: "host_only",
          }]),
      },
    );
    throw new Error("Expected host-only relationship to be rejected");
  } catch (err) {
    if (!(err instanceof LoginRequestError)) throw err;
    assertEquals(err.status, 400);
  }
});

Deno.test("preferred account host is re-verified when the picker opens", async () => {
  const resolved = await resolveVerifiedPreferredAccountHost(
    app({ preferredAccountHost: preferredHost.host }),
    {
      getHost: () => Promise.resolve(preferredHost),
      getClaim: () => Promise.resolve(preferredClaim),
      getAppProfile: () => Promise.resolve(preferredAppProfile),
      listVerifiedLinks: () => Promise.resolve([]),
    },
  );
  assertEquals(resolved?.host, preferredHost.host);

  const revoked = await resolveVerifiedPreferredAccountHost(
    app({ preferredAccountHost: preferredHost.host }),
    {
      getHost: () => Promise.resolve(preferredHost),
      getClaim: () => Promise.resolve(null),
      getAppProfile: () => Promise.resolve(preferredAppProfile),
      listVerifiedLinks: () => Promise.resolve([]),
    },
  );
  assertEquals(revoked, null);

  const closed = await resolveVerifiedPreferredAccountHost(
    app({ preferredAccountHost: preferredHost.host }),
    {
      getHost: () =>
        Promise.resolve({
          ...preferredHost,
          signupStatus: "closed" as const,
        }),
      getClaim: () => Promise.resolve(preferredClaim),
      getAppProfile: () => Promise.resolve(preferredAppProfile),
      listVerifiedLinks: () => Promise.resolve([]),
    },
  );
  assertEquals(closed, null);
});

Deno.test("evaluateLoginAppDomainManifest accepts an apps-array manifest", () => {
  const check = evaluateLoginAppDomainManifest(app(), {
    version: ATMOSPHERE_LOGIN_MANIFEST_VERSION,
    apps: [
      {
        client_id: "https://other.example/client.json",
        app_name: "Other",
        homepage: "https://other.example",
        allowed_return_uris: ["https://other.example/callback"],
      },
      {
        client_id: "https://app.example.com/oauth/client-metadata.json",
        app_name: "Example App",
        homepage: "https://app.example.com",
        logo_uri: "https://app.example.com/icon.png",
        allowed_return_uris: [
          "https://app.example.com/auth/atmosphere/selected",
        ],
      },
    ],
  }, "https://app.example.com/.well-known/atmosphere-login.json");

  assertEquals(check.status, "pass");
});

Deno.test("evaluateLoginAppDomainManifest fails when the client ID is absent", () => {
  const check = evaluateLoginAppDomainManifest(app(), {
    version: ATMOSPHERE_LOGIN_MANIFEST_VERSION,
    apps: [],
  }, "https://app.example.com/.well-known/atmosphere-login.json");

  assertEquals(check.status, "fail");
});

Deno.test("evaluateLoginAppDomainManifest requires registered callbacks", () => {
  const check = evaluateLoginAppDomainManifest(app(), {
    version: ATMOSPHERE_LOGIN_MANIFEST_VERSION,
    client_id: "https://app.example.com/oauth/client-metadata.json",
    app_name: "Example App",
    homepage: "https://app.example.com",
    logo_uri: "https://app.example.com/icon.png",
    allowed_return_uris: ["https://app.example.com/other"],
  }, "https://app.example.com/.well-known/atmosphere-login.json");

  assertEquals(check.status, "fail");
});

Deno.test("loginAppManifestUrl refuses private network homepages", () => {
  assertEquals(
    loginAppManifestUrl(app({ appUri: "https://127.0.0.1" })),
    null,
  );
  assertEquals(
    loginAppManifestUrl(app({ appUri: "https://192.168.1.20" })),
    null,
  );
  assertEquals(
    loginAppManifestUrl(app({ appUri: "https://app.example.com" })),
    "https://app.example.com/.well-known/atmosphere-login.json",
  );
});

Deno.test("verifyLoginAppDomainManifest does not follow app-controlled redirects", async () => {
  let redirectMode: RequestRedirect | undefined;
  const check = await verifyLoginAppDomainManifest(app(), {
    fetchImpl: (_input, init) => {
      redirectMode = init?.redirect;
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/internal" },
        }),
      );
    },
  });

  assertEquals(redirectMode, "manual");
  assertEquals(check.status, "fail");
});

Deno.test("buildLoginAppIdentityChecks fails private HTTPS production URLs", () => {
  const checks = buildLoginAppIdentityChecks(app({
    appUri: "https://192.168.1.20",
  }));
  const httpsCheck = checks.find((check) => check.key === "https");
  assertEquals(httpsCheck?.status, "fail");
});

Deno.test("isUnregisteredDevLoginReturnAllowed keeps same-origin loopback metadata working", () => {
  assertEquals(
    isUnregisteredDevLoginReturnAllowed(
      "http://127.0.0.1:5173/examples/atmosphere-login/client-metadata.json",
      "http://127.0.0.1:5173/examples/atmosphere-login/callback",
      { dev: true },
    ),
    true,
  );
});

Deno.test("isUnregisteredDevLoginReturnAllowed supports ATProto localhost client IDs", () => {
  assertEquals(
    isUnregisteredDevLoginReturnAllowed(
      "http://localhost/?redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback",
      "http://127.0.0.1:5173/callback",
      { dev: true },
    ),
    true,
  );
});

Deno.test("isUnregisteredDevLoginReturnAllowed rejects undeclared localhost callback paths", () => {
  assertEquals(
    isUnregisteredDevLoginReturnAllowed(
      "http://localhost/",
      "http://127.0.0.1:5173/callback",
      { dev: true },
    ),
    false,
  );
});

Deno.test("isUnregisteredDevLoginReturnAllowed is off outside dev", () => {
  assertEquals(
    isUnregisteredDevLoginReturnAllowed(
      "http://localhost/?redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback",
      "http://127.0.0.1:5173/callback",
      { dev: false },
    ),
    false,
  );
});

Deno.test("readLoginRequest rejects oversized client IDs", () => {
  const url = new URL("https://atmosphereaccount.com/login/select");
  url.searchParams.set(
    "client_id",
    `https://app.example.com/${"a".repeat(2100)}`,
  );
  url.searchParams.set("return_uri", "https://app.example.com/callback");
  url.searchParams.set("state", "state");

  try {
    readLoginRequest(url);
    throw new Error("Expected readLoginRequest to throw");
  } catch (err) {
    if (!(err instanceof LoginRequestError)) throw err;
    assertEquals(err.message, "client_id is too long");
  }
});

Deno.test("readLoginRequest rejects ambiguous security parameters", () => {
  for (
    const query of [
      "client_id=https%3A%2F%2Fone.example&client_id=https%3A%2F%2Ftwo.example&return_uri=https%3A%2F%2Fone.example%2Fcallback&state=state",
      "client_id=https%3A%2F%2Fapp.example&return_uri=https%3A%2F%2Fapp.example%2Fone&redirect_uri=https%3A%2F%2Fapp.example%2Ftwo&state=state",
      "client_id=https%3A%2F%2Fapp.example&return_uri=https%3A%2F%2Fapp.example%2Fcallback&state=one&state=two",
    ]
  ) {
    try {
      readLoginRequest(
        new URL(`https://atmosphereaccount.com/login/select?${query}`),
      );
      throw new Error("Expected readLoginRequest to throw");
    } catch (err) {
      if (!(err instanceof LoginRequestError)) throw err;
    }
  }
});

Deno.test("readLoginRequest rejects oversized return URIs", () => {
  const url = new URL("https://atmosphereaccount.com/login/select");
  url.searchParams.set("client_id", "https://app.example.com/client.json");
  url.searchParams.set(
    "return_uri",
    `https://app.example.com/${"a".repeat(2100)}`,
  );
  url.searchParams.set("state", "state");

  try {
    readLoginRequest(url);
    throw new Error("Expected readLoginRequest to throw");
  } catch (err) {
    if (!(err instanceof LoginRequestError)) throw err;
    assertEquals(err.message, "return_uri is too long");
  }
});

Deno.test("resolveLoginAppForRequest rejects private-network HTTPS client IDs before lookup", async () => {
  try {
    await resolveLoginAppForRequest({
      clientId: "https://192.168.1.20/client.json",
      returnUri: "https://app.example.com/callback",
      state: "state",
      scope: null,
    });
    throw new Error("Expected resolveLoginAppForRequest to throw");
  } catch (err) {
    if (!(err instanceof LoginRequestError)) throw err;
    assertEquals(err.message, "client_id must use a public HTTPS host");
  }
});

Deno.test("resolveLoginAppForRequest rejects private-network HTTPS return URIs before lookup", async () => {
  try {
    await resolveLoginAppForRequest({
      clientId: "https://app.example.com/client.json",
      returnUri: "https://127.0.0.1/callback",
      state: "state",
      scope: null,
    });
    throw new Error("Expected resolveLoginAppForRequest to throw");
  } catch (err) {
    if (!(err instanceof LoginRequestError)) throw err;
    assertEquals(err.message, "return_uri must use a public HTTPS host");
  }
});

Deno.test("resolveLoginAppForRequest normalizes client IDs before registered lookup", async () => {
  let lookedUpClientId: string | null = null;
  const resolved = await resolveLoginAppForRequest({
    clientId: "https://app.example.com/client.json#ignored",
    returnUri: "https://app.example.com/callback#ignored",
    state: "state",
    scope: null,
  }, {
    getLoginApp: (clientId) => {
      lookedUpClientId = clientId;
      return Promise.resolve(app({
        clientId,
        allowedReturnUris: ["https://app.example.com/callback"],
      }));
    },
  });

  assertEquals(lookedUpClientId, "https://app.example.com/client.json");
  assertEquals(resolved.app.clientId, "https://app.example.com/client.json");
  assertEquals(
    resolved.returnUri.toString(),
    "https://app.example.com/callback",
  );
});

Deno.test("resolveLoginAppForRequest rejects an orphaned owner registration", async () => {
  try {
    await resolveLoginAppForRequest({
      clientId: "https://app.example.com/client.json",
      returnUri: "https://app.example.com/callback",
      state: "state",
      scope: null,
    }, {
      getLoginApp: (clientId) =>
        Promise.resolve(app({
          clientId,
          appName: "Unlinked login configuration",
          appUri: null,
          logoUri: null,
          appDid: "did:plc:owner",
          appProfileUri: "at://did:plc:owner/app.profile/deleted",
          appProfileSlug: null,
          linkStatus: "linked",
          identityAvailable: false,
          allowedReturnUris: ["https://app.example.com/callback"],
        })),
    });
    throw new Error("Expected orphaned registration to be rejected");
  } catch (err) {
    if (!(err instanceof LoginRequestError)) throw err;
    assertEquals(err.status, 403);
  }
});

for (const availability of ["moderated", "taken_down", "deleted"] as const) {
  Deno.test(`resolveLoginAppForRequest rejects a ${availability} app profile`, async () => {
    try {
      await resolveLoginAppForRequest({
        clientId: "https://app.example.com/client.json",
        returnUri: "https://app.example.com/callback",
        state: "state",
        scope: null,
      }, {
        getLoginApp: (clientId) =>
          Promise.resolve(app({
            clientId,
            loginAvailability: availability,
            allowedReturnUris: ["https://app.example.com/callback"],
          })),
      });
      throw new Error("Expected unavailable app profile to be rejected");
    } catch (err) {
      if (!(err instanceof LoginRequestError)) throw err;
      assertEquals(err.status, 403);
      assertEquals(
        err.message,
        "This app is not available for Login with Atmosphere.",
      );
    }
  });
}

Deno.test("resolveLoginAppForRequest keeps query strings exact for registered callbacks", async () => {
  const resolved = await resolveLoginAppForRequest({
    clientId: "https://app.example.com/client.json",
    returnUri: "https://app.example.com/callback?mode=popup#ignored",
    state: "state",
    scope: null,
  }, {
    getLoginApp: (clientId) =>
      Promise.resolve(app({
        clientId,
        allowedReturnUris: ["https://app.example.com/callback?mode=popup"],
      })),
  });

  assertEquals(
    resolved.returnUri.toString(),
    "https://app.example.com/callback?mode=popup",
  );
});

Deno.test("registered reference-path clients keep canonical app-profile icons", async () => {
  const resolved = await resolveLoginAppForRequest({
    clientId:
      "https://atmosphereaccount.com/examples/atmosphere-login/client-metadata.json",
    returnUri:
      "https://atmosphereaccount.com/examples/atmosphere-login/callback",
    state: "state",
    scope: null,
  }, {
    getLoginApp: (clientId) =>
      Promise.resolve(app({
        clientId,
        appName: "Login with Atmosphere reference app",
        appUri: "https://atmosphereaccount.com/examples/atmosphere-login/app",
        logoUri: "https://atmosphereaccount.com/union.svg",
        allowedReturnUris: [
          "https://atmosphereaccount.com/examples/atmosphere-login/callback",
        ],
        status: "trusted",
      })),
  });

  assertEquals(
    resolved.app.logoUri,
    "https://atmosphereaccount.com/union.svg",
  );
});

Deno.test("resolveLoginAppForRequest rejects registered callbacks with mismatched query strings", async () => {
  try {
    await resolveLoginAppForRequest({
      clientId: "https://app.example.com/client.json",
      returnUri: "https://app.example.com/callback?mode=popup",
      state: "state",
      scope: null,
    }, {
      getLoginApp: (clientId) =>
        Promise.resolve(app({
          clientId,
          allowedReturnUris: [
            "https://app.example.com/callback?mode=redirect",
          ],
        })),
    });
    throw new Error("Expected resolveLoginAppForRequest to throw");
  } catch (err) {
    if (!(err instanceof LoginRequestError)) throw err;
    assertEquals(
      err.message,
      "return_uri must exactly match an allowed return URI for this registered app",
    );
    assertEquals(err.status, 403);
  }
});
