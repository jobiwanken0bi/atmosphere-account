import { isHandle, resolveHandle, resolveIdentity } from "./identity.ts";

Deno.test("isHandle enforces ATProto-style DNS handle syntax", () => {
  const accepted = [
    "you.com",
    "blacksky.community",
    "sub.example.co",
    "xn--bcher-kva.example",
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
