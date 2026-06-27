import { isHandle, resolveHandle } from "./identity.ts";

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
