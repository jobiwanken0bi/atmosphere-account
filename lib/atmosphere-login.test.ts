import {
  ATMOSPHERE_LOGIN_MANIFEST_VERSION,
  buildLoginAppIdentityChecks,
  evaluateLoginAppDomainManifest,
  isUnregisteredDevLoginReturnAllowed,
  type LoginApp,
  loginAppManifestUrl,
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

function app(overrides: Partial<LoginApp> = {}): LoginApp {
  return {
    clientId: "https://app.example.com/oauth/client-metadata.json",
    appName: "Example App",
    appUri: "https://app.example.com",
    logoUri: "https://app.example.com/icon.png",
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
    contactDid: "did:plc:owner",
    preferredAccountHost: null,
    registered: true,
    ...overrides,
  };
}

const preferredHost = {
  ...listSeededAccountHostFallback()[0],
  host: "accounts.example.com",
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

Deno.test("preferred account host registration requires the app owner's claim", async () => {
  const verified = await verifyPreferredAccountHostForOwner(
    "did:plc:owner",
    preferredHost.host,
    {
      getHost: () => Promise.resolve(preferredHost),
      getClaim: () => Promise.resolve(preferredClaim),
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
      },
    );
    throw new Error("Expected preferred host verification to fail");
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
    },
  );
  assertEquals(resolved?.host, preferredHost.host);

  const revoked = await resolveVerifiedPreferredAccountHost(
    app({ preferredAccountHost: preferredHost.host }),
    {
      getHost: () => Promise.resolve(preferredHost),
      getClaim: () => Promise.resolve(null),
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
  url.searchParams.set("client_id", `https://app.example/${"a".repeat(2100)}`);
  url.searchParams.set("return_uri", "https://app.example/callback");
  url.searchParams.set("state", "state");

  try {
    readLoginRequest(url);
    throw new Error("Expected readLoginRequest to throw");
  } catch (err) {
    if (!(err instanceof LoginRequestError)) throw err;
    assertEquals(err.message, "client_id is too long");
  }
});

Deno.test("readLoginRequest rejects oversized return URIs", () => {
  const url = new URL("https://atmosphereaccount.com/login/select");
  url.searchParams.set("client_id", "https://app.example/client.json");
  url.searchParams.set("return_uri", `https://app.example/${"a".repeat(2100)}`);
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
      returnUri: "https://app.example/callback",
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
      clientId: "https://app.example/client.json",
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
    clientId: "https://app.example/client.json#ignored",
    returnUri: "https://app.example/callback#ignored",
    state: "state",
    scope: null,
  }, {
    getLoginApp: (clientId) => {
      lookedUpClientId = clientId;
      return Promise.resolve(app({
        clientId,
        allowedReturnUris: ["https://app.example/callback"],
      }));
    },
  });

  assertEquals(lookedUpClientId, "https://app.example/client.json");
  assertEquals(resolved.app.clientId, "https://app.example/client.json");
  assertEquals(resolved.returnUri.toString(), "https://app.example/callback");
});

Deno.test("resolveLoginAppForRequest keeps query strings exact for registered callbacks", async () => {
  const resolved = await resolveLoginAppForRequest({
    clientId: "https://app.example/client.json",
    returnUri: "https://app.example/callback?mode=popup#ignored",
    state: "state",
    scope: null,
  }, {
    getLoginApp: (clientId) =>
      Promise.resolve(app({
        clientId,
        allowedReturnUris: ["https://app.example/callback?mode=popup"],
      })),
  });

  assertEquals(
    resolved.returnUri.toString(),
    "https://app.example/callback?mode=popup",
  );
});

Deno.test("resolveLoginAppForRequest uses generic icon for registered reference app", async () => {
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
        appName: "Atmosphere Login reference app",
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
    "https://atmosphereaccount.com/app-icon.svg",
  );
});

Deno.test("resolveLoginAppForRequest rejects registered callbacks with mismatched query strings", async () => {
  try {
    await resolveLoginAppForRequest({
      clientId: "https://app.example/client.json",
      returnUri: "https://app.example/callback?mode=popup",
      state: "state",
      scope: null,
    }, {
      getLoginApp: (clientId) =>
        Promise.resolve(app({
          clientId,
          allowedReturnUris: ["https://app.example/callback?mode=redirect"],
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
