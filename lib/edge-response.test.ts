import {
  applyEdgeCachePolicy,
  compressResponse,
  preferredCompressionEncoding,
  publicCacheDescriptorForTest,
} from "./edge-response.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertIncludes(value: string | null, expected: string): void {
  if (!value?.includes(expected)) {
    throw new Error(`Expected ${String(value)} to include ${expected}`);
  }
}

function publicHtml(body = "Atmosphere ".repeat(100)): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      etag: '"page-v1"',
    },
  });
}

Deno.test("compression negotiation honors quality and explicit exclusions", () => {
  assertEquals(preferredCompressionEncoding("gzip, br"), "br");
  assertEquals(
    preferredCompressionEncoding("gzip;q=1, br;q=0.4"),
    "gzip",
  );
  assertEquals(
    preferredCompressionEncoding("br;q=0, gzip;q=0, *;q=1"),
    null,
  );
  assertEquals(preferredCompressionEncoding("*;q=0.5"), "br");
  assertEquals(preferredCompressionEncoding(null), null);
});

Deno.test("text responses are gzip-compressed as a stream with safe validators", async () => {
  const source = "Atmosphere Account ".repeat(200);
  const response = compressResponse(
    new Request("https://atmosphereaccount.com/apps", {
      headers: { "accept-encoding": "gzip" },
    }),
    new Response(source, {
      headers: {
        "content-type": "text/css; charset=utf-8",
        "content-length": String(source.length),
        etag: '"asset-hash"',
        vary: "Accept-Language",
      },
    }),
  );

  assertEquals(response.headers.get("content-encoding"), "gzip");
  assertEquals(response.headers.get("content-length"), null);
  assertEquals(response.headers.get("etag"), 'W/"asset-hash"');
  assertEquals(
    response.headers.get("vary"),
    "Accept-Language, Accept-Encoding",
  );
  const decoded = response.body!.pipeThrough(
    new DecompressionStream("gzip"),
  );
  assertEquals(await new Response(decoded).text(), source);
});

Deno.test("compressible identity responses still vary by Accept-Encoding", async () => {
  const source = "Atmosphere Account ".repeat(200);
  const response = compressResponse(
    new Request("https://atmosphereaccount.com/apps"),
    new Response(source, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        etag: '"page-hash"',
      },
    }),
  );

  assertEquals(response.headers.get("content-encoding"), null);
  assertEquals(response.headers.get("vary"), "Accept-Encoding");
  assertEquals(response.headers.get("etag"), '"page-hash"');
  assertEquals(await response.text(), source);
});

Deno.test("compression preserves range, transformed, and binary responses", () => {
  const request = new Request("https://atmosphereaccount.com/image.png", {
    headers: { "accept-encoding": "br, gzip" },
  });
  const binary = new Response(new Uint8Array(1024), {
    headers: { "content-type": "image/png" },
  });
  assertEquals(compressResponse(request, binary), binary);

  const transformed = new Response("x".repeat(1024), {
    headers: {
      "content-type": "text/plain",
      "cache-control": "public, no-transform",
    },
  });
  assertEquals(compressResponse(request, transformed), transformed);

  const ranged = new Response("x".repeat(1024), {
    headers: {
      "content-type": "text/plain",
      "content-range": "bytes 0-10/1024",
    },
  });
  assertEquals(compressResponse(request, ranged), ranged);

  const eventStream = new Response("data: update\n\n".repeat(100), {
    headers: { "content-type": "text/event-stream" },
  });
  assertEquals(compressResponse(request, eventStream), eventStream);
});

Deno.test("anonymous public HTML gets short deploy-invalidated CDN caching and tags", () => {
  const request = new Request("https://atmosphereaccount.com/apps", {
    headers: { accept: "text/html" },
  });
  const response = applyEdgeCachePolicy(
    request,
    new URL(request.url),
    publicHtml(),
  );

  assertEquals(
    response.headers.get("cache-control"),
    "public, max-age=0, must-revalidate",
  );
  assertEquals(
    response.headers.get("deno-cdn-cache-control"),
    "public, s-maxage=60, stale-while-revalidate=300",
  );
  assertIncludes(response.headers.get("deno-cache-tag"), "atmosphere-public");
  assertIncludes(response.headers.get("deno-cache-tag"), "apps-home");
  assertEquals(response.headers.get("deno-cache-id"), null);
  assertEquals(
    response.headers.get("vary"),
    "Cookie, Accept-Language",
  );
});

Deno.test("any cookie or authorization signal forces the public variant private", () => {
  for (
    const headers of [
      new Headers({
        cookie: "atmo_sid=session.signature",
        accept: "text/html",
      }),
      new Headers({ cookie: "atmo_accounts=signed", accept: "text/html" }),
      new Headers({ cookie: "future_preference=1", accept: "text/html" }),
      new Headers({ authorization: "Bearer token", accept: "text/html" }),
    ]
  ) {
    const request = new Request("https://atmosphereaccount.com/apps", {
      headers,
    });
    const upstream = publicHtml();
    upstream.headers.set("deno-cache-id", "unsafe");
    upstream.headers.set("deno-cache-tag", "unsafe");
    const response = applyEdgeCachePolicy(
      request,
      new URL(request.url),
      upstream,
    );
    assertEquals(response.headers.get("cache-control"), "private, no-store");
    assertEquals(
      response.headers.get("deno-cdn-cache-control"),
      "private, no-store",
    );
    assertEquals(response.headers.get("deno-cache-id"), null);
    assertEquals(response.headers.get("deno-cache-tag"), null);
    assertIncludes(response.headers.get("vary"), "Cookie");
  }
});

Deno.test("Set-Cookie and deliberate private policies can never be broadened", () => {
  const request = new Request("https://atmosphereaccount.com/apps", {
    headers: { accept: "text/html" },
  });
  const withCookie = publicHtml();
  withCookie.headers.append("set-cookie", "atmo_sid=secret; HttpOnly");
  const cookieResponse = applyEdgeCachePolicy(
    request,
    new URL(request.url),
    withCookie,
  );
  assertEquals(cookieResponse.headers.get("deno-cdn-cache-control"), null);

  const privateResponse = publicHtml();
  privateResponse.headers.set("cache-control", "private, no-store");
  const result = applyEdgeCachePolicy(
    request,
    new URL(request.url),
    privateResponse,
  );
  assertEquals(result.headers.get("cache-control"), "private, no-store");
  assertEquals(result.headers.get("deno-cdn-cache-control"), null);
});

Deno.test("cache allowlist excludes stateful paths and cache-polluting queries", () => {
  for (
    const path of [
      "/account",
      "/oauth/login",
      "/apps/manage",
      "/apps/create",
      "/hosts/example.com/claim",
      "/hosts/example.com/manage",
      "/apps/airglow?unexpected=1",
      "/hosts?unexpected=1",
    ]
  ) {
    assertEquals(
      publicCacheDescriptorForTest(
        new URL(path, "https://atmosphereaccount.com"),
      ),
      null,
    );
  }

  assertEquals(
    publicCacheDescriptorForTest(
      new URL("https://atmosphereaccount.com/apps/airglow"),
    )?.scope,
    "apps",
  );
  assertEquals(
    publicCacheDescriptorForTest(
      new URL("https://atmosphereaccount.com/hosts/sprk.so"),
    )?.scope,
    "hosts",
  );
  assertEquals(
    publicCacheDescriptorForTest(
      new URL("https://atmosphereaccount.com/apps/all?q=sky&tag=social"),
    )?.ttlSeconds,
    30,
  );
});
