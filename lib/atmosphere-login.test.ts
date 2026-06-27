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
} from "./atmosphere-login.ts";

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
    registered: true,
    ...overrides,
  };
}

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
