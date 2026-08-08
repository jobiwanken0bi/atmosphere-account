import {
  assertPublicDnsHostnameForTest,
  didWebDocumentUrlForTest,
  discoverAuthServer,
  findPdsEndpoint,
  isHandle,
  isProductionHandleAllowedForTest,
  normalizeServiceEndpoint,
  resolveDidDocument,
  resolveHandle,
  resolveIdentity,
} from "./identity.ts";

Deno.test("isHandle enforces ATProto-style DNS handle syntax", () => {
  const accepted = [
    "you.com",
    "blacksky.community",
    "sub.example.co",
    "xn--bcher-kva.com",
  ];
  for (const handle of accepted) {
    if (!isHandle(handle)) throw new Error(`expected valid handle: ${handle}`);
  }

  const rejected = [
    "localhost",
    "example",
    "Example.com",
    "-example.com",
    "example-.com",
    "example..com",
    "example.123",
    "has_underscore.com",
    `${"a".repeat(64)}.com`,
  ];
  for (const handle of rejected) {
    if (isHandle(handle)) throw new Error(`expected invalid handle: ${handle}`);
  }
});

Deno.test("production handles and did:web identifiers reject special-use authority", () => {
  for (
    const handle of [
      "app.test",
      "app.invalid",
      "app.example",
      "app.localhost",
      "app.local",
    ]
  ) {
    if (isProductionHandleAllowedForTest(handle)) {
      throw new Error(`expected reserved handle rejection: ${handle}`);
    }
  }
  if (!isProductionHandleAllowedForTest("app.example.com")) {
    throw new Error("expected public handle acceptance");
  }
  if (
    didWebDocumentUrlForTest("did:web:identity.example.com") !==
      "https://identity.example.com/.well-known/did.json"
  ) {
    throw new Error("unexpected origin-only did:web URL");
  }
  for (
    const did of [
      "did:web:identity.example.com:path",
      "did:web:identity.example.com%3A8443",
      "did:web:identity.test",
    ]
  ) {
    let rejected = false;
    try {
      didWebDocumentUrlForTest(did);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`expected did:web rejection: ${did}`);
  }
  if (
    didWebDocumentUrlForTest("did:web:localhost%3A3000", true) !==
      "http://localhost:3000/.well-known/did.json"
  ) {
    throw new Error("unexpected loopback development did:web URL");
  }
  let rejectedDevelopmentPath = false;
  try {
    didWebDocumentUrlForTest("did:web:identity.example.com:path", true);
  } catch {
    rejectedDevelopmentPath = true;
  }
  if (!rejectedDevelopmentPath) {
    throw new Error("generic path-based did:web must remain rejected in dev");
  }
});

Deno.test("public DNS guard rejects any private or special-use address answer", async () => {
  await assertPublicDnsHostnameForTest(
    "pds.example.com",
    (_hostname, type) => Promise.resolve(type === "A" ? ["8.8.8.8"] : []),
  );

  let rejected = false;
  try {
    await assertPublicDnsHostnameForTest(
      "rebind.example.com",
      (_hostname, type) =>
        Promise.resolve(type === "A" ? ["8.8.8.8", "127.0.0.1"] : []),
    );
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("expected mixed private DNS rejection");
});

Deno.test("PDS endpoints reject credentials, paths, queries, and fragments", () => {
  for (
    const endpoint of [
      "https://user:secret@pds.example",
      "https://pds.example/base/",
      "https://pds.example/?ignored=1",
      "https://pds.example/#fragment",
    ]
  ) {
    let rejected = false;
    try {
      normalizeServiceEndpoint(endpoint);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`expected endpoint rejection: ${endpoint}`);
  }
  if (
    normalizeServiceEndpoint("https://pds.example/") !== "https://pds.example"
  ) {
    throw new Error("expected origin normalization");
  }
});

Deno.test("resolveHandle prefers DNS and joins split TXT strings", async () => {
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  try {
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      seen.push(url);
      if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
        return Promise.resolve(
          Response.json({
            Answer: [{ data: '"did=did:plc:abc" "123"' }],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const did = await resolveHandle("Example.com");
    if (did !== "did:plc:abc123") {
      throw new Error(`unexpected DID: ${did}`);
    }
    if (seen.length !== 1 || !seen[0].includes("_atproto.example.com")) {
      throw new Error(`DNS lookup was not first and decisive: ${seen}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("conflicting DNS handle claims fail instead of trusting another source", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
        return Promise.resolve(Response.json({
          Answer: [
            { data: '"did=did:plc:first"' },
            { data: '"did=did:plc:second"' },
          ],
        }));
      }
      if (url === "https://conflict.example/.well-known/atproto-did") {
        return Promise.resolve(
          new Response("did:plc:wellknown", {
            headers: { "content-type": "text/plain" },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    let rejected = false;
    try {
      await resolveHandle("conflict.example");
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("expected conflicting claims to fail");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("resolveIdentity verifies DID alsoKnownAs handles before display", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://plc.directory/did:plc:owner") {
        return Promise.resolve(Response.json({
          id: "did:plc:owner",
          alsoKnownAs: ["at://owner.example"],
          service: [{
            id: "#atproto_pds",
            type: "AtprotoPersonalDataServer",
            serviceEndpoint: "https://pds.example",
          }],
        }));
      }
      if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
        return Promise.resolve(Response.json({
          Answer: [{ data: '"did=did:plc:owner"' }],
        }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const identity = await resolveIdentity("did:plc:owner");
    if (identity.handle !== "owner.example") {
      throw new Error(`unexpected handle: ${identity.handle}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("resolveIdentity falls back to DID when alsoKnownAs is stale", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://plc.directory/did:plc:owner") {
        return Promise.resolve(Response.json({
          id: "did:plc:owner",
          alsoKnownAs: ["at://old.example"],
          service: [{
            id: "#atproto_pds",
            type: "AtprotoPersonalDataServer",
            serviceEndpoint: "https://pds.example",
          }],
        }));
      }
      if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
        return Promise.resolve(Response.json({
          Answer: [{ data: '"did=did:plc:someoneelse"' }],
        }));
      }
      if (
        url ===
          "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=old.example"
      ) {
        return Promise.resolve(Response.json({ did: "did:plc:someoneelse" }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const identity = await resolveIdentity("did:plc:owner");
    if (identity.handle !== "did:plc:owner") {
      throw new Error(`unexpected handle: ${identity.handle}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("the first valid at:// claim is authoritative", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://plc.directory/did:plc:owner") {
        return Promise.resolve(Response.json({
          id: "did:plc:owner",
          alsoKnownAs: [
            "not-an-at-uri",
            "at://wrong.example",
            "at://right.example",
          ],
          service: [{
            id: "#atproto_pds",
            type: "AtprotoPersonalDataServer",
            serviceEndpoint: "https://pds.example",
          }],
        }));
      }
      if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
        const name = new URL(url).searchParams.get("name") ?? "";
        return Promise.resolve(Response.json({
          Answer: [{
            data: name.includes("right.example")
              ? '"did=did:plc:owner"'
              : '"did=did:plc:someoneelse"',
          }],
        }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const fromDid = await resolveIdentity("did:plc:owner");
    if (fromDid.handle !== "did:plc:owner") {
      throw new Error("later alias must not override the first valid claim");
    }
    let rejected = false;
    try {
      await resolveIdentity("right.example");
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error("expected non-authoritative alias rejection");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("PDS service selection requires the canonical id and type together", () => {
  for (
    const service of [
      {
        id: "#other",
        type: "AtprotoPersonalDataServer",
        serviceEndpoint: "https://pds.example",
      },
      {
        id: "#atproto_pds",
        type: "OtherService",
        serviceEndpoint: "https://pds.example",
      },
    ]
  ) {
    let rejected = false;
    try {
      findPdsEndpoint({ id: "did:plc:test", service: [service] });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("expected ambiguous PDS service rejection");
  }
  const absolute = findPdsEndpoint({
    id: "did:plc:test",
    service: [{
      id: "did:plc:test#atproto_pds",
      type: "AtprotoPersonalDataServer",
      serviceEndpoint: "https://pds.example",
    }],
  });
  if (absolute !== "https://pds.example") {
    throw new Error("expected absolute canonical PDS service id acceptance");
  }
});

Deno.test("OAuth discovery preserves advertised create prompts", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://pds.example/.well-known/oauth-protected-resource") {
        return Promise.resolve(Response.json({
          resource: "https://pds.example",
          authorization_servers: ["https://auth.example"],
        }));
      }
      if (
        url ===
          "https://auth.example/.well-known/oauth-authorization-server"
      ) {
        return Promise.resolve(Response.json({
          ...validOAuthServerMetadata(),
          issuer: "https://auth.example",
          authorization_endpoint: "https://auth.example/oauth/authorize",
          token_endpoint: "https://auth.example/oauth/token",
          pushed_authorization_request_endpoint:
            "https://auth.example/oauth/par",
          prompt_values_supported: ["login", "create"],
        }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const metadata = await discoverAuthServer("https://pds.example");
    if (!metadata.prompt_values_supported?.includes("create")) {
      throw new Error("expected OAuth create prompt capability");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OAuth discovery rejects servers missing mandatory DPoP support", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://pds.example/.well-known/oauth-protected-resource") {
        return Promise.resolve(Response.json({
          resource: "https://pds.example",
          authorization_servers: ["https://auth.example"],
        }));
      }
      if (
        url ===
          "https://auth.example/.well-known/oauth-authorization-server"
      ) {
        const metadata = validOAuthServerMetadata();
        metadata.dpop_signing_alg_values_supported = [];
        return Promise.resolve(Response.json(metadata));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    let rejected = false;
    try {
      await discoverAuthServer("https://pds.example");
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("expected non-DPoP OAuth server rejection");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OAuth discovery fails closed on missing or ambiguous protected-resource metadata", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let mode:
      | "missing"
      | "non_200"
      | "missing_resource"
      | "wrong_resource"
      | "multiple"
      | "path" = "missing";
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== "https://pds.example/.well-known/oauth-protected-resource") {
        throw new Error(`unexpected fallback fetch: ${url}`);
      }
      if (mode === "missing") {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      const metadata = {
        ...(mode === "missing_resource" ? {} : {
          resource: mode === "wrong_resource"
            ? "https://other.example"
            : "https://pds.example",
        }),
        authorization_servers: mode === "multiple"
          ? ["https://one.example", "https://two.example"]
          : ["https://auth.example/path"],
      };
      return Promise.resolve(Response.json(metadata, {
        status: mode === "non_200" ? 201 : 200,
      }));
    }) as typeof fetch;

    for (
      const next of [
        "missing",
        "non_200",
        "missing_resource",
        "wrong_resource",
        "multiple",
        "path",
      ] as const
    ) {
      mode = next;
      let rejected = false;
      try {
        await discoverAuthServer("https://pds.example");
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error(`expected ${next} metadata rejection`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function validOAuthServerMetadata(): Record<string, unknown> {
  return {
    issuer: "https://auth.example",
    authorization_endpoint: "https://auth.example/oauth/authorize",
    token_endpoint: "https://auth.example/oauth/token",
    pushed_authorization_request_endpoint: "https://auth.example/oauth/par",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["ES256"],
    scopes_supported: ["atproto"],
    authorization_response_iss_parameter_supported: true,
    require_pushed_authorization_requests: true,
    dpop_signing_alg_values_supported: ["ES256"],
    client_id_metadata_document_supported: true,
  };
}

Deno.test("DID resolution rejects redirects, oversized bodies, and substituted documents", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let mode: "redirect" | "oversized" | "substituted" = "redirect";
    globalThis.fetch = ((
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (init?.redirect !== "manual") {
        throw new Error("identity fetch did not disable automatic redirects");
      }
      if (mode === "redirect") {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://127.0.0.1/did.json" },
          }),
        );
      }
      if (mode === "oversized") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "did:plc:bounded",
              padding: "x".repeat(300_000),
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(Response.json({
        id: "did:plc:someone-else",
        service: [],
      }));
    }) as typeof fetch;

    for (const next of ["redirect", "oversized", "substituted"] as const) {
      mode = next;
      let rejected = false;
      try {
        await resolveDidDocument("did:plc:bounded");
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error(`expected ${next} response rejection`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
