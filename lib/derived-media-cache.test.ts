import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import {
  atprotoDerivedMediaKey,
  cachedDerivedMediaRedirect,
  type DerivedMediaCacheConfig,
  derivedMediaCacheConfig,
  profileDerivedMediaKey,
  storeDerivedMedia,
  storeVerifiedMediaResponse,
  verifyCachedDerivedMedia,
} from "./derived-media-cache.ts";

const config: DerivedMediaCacheConfig = {
  endpoint: new URL("https://media.example.test/storage"),
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret-example",
  bucket: "derived-media",
  region: "iad",
  urlStyle: "path",
};

Deno.test("derived media config is all-or-nothing and HTTPS-only", () => {
  const values = new Map<string, string>([
    ["AWS_ENDPOINT_URL", "https://objects.example.test"],
    ["AWS_ACCESS_KEY_ID", "key"],
    ["AWS_SECRET_ACCESS_KEY", "secret"],
    ["AWS_S3_BUCKET_NAME", "derived-media"],
    ["AWS_DEFAULT_REGION", "iad"],
  ]);
  assertEquals(
    derivedMediaCacheConfig((key) => values.get(key))?.bucket,
    "derived-media",
  );
  values.set("AWS_S3_URL_STYLE", "virtual-host");
  assertEquals(
    derivedMediaCacheConfig((key) => values.get(key))?.urlStyle,
    "virtual-hosted",
  );
  values.delete("AWS_SECRET_ACCESS_KEY");
  assertEquals(derivedMediaCacheConfig((key) => values.get(key)), null);
  values.set("AWS_SECRET_ACCESS_KEY", "secret");
  values.set("AWS_ENDPOINT_URL", "http://objects.example.test");
  assertEquals(derivedMediaCacheConfig((key) => values.get(key)), null);
});

Deno.test("derived media keys are immutable and contain exact identity", () => {
  assertEquals(
    atprotoDerivedMediaKey({
      did: "did:plc:alice",
      cid: "bafy-image",
      width: 800,
    }),
    "v1/atproto/did~3Aplc~3Aalice/bafy-image/w-800.webp",
  );
  assertEquals(
    profileDerivedMediaKey({
      kind: "screenshot",
      did: "did:plc:app",
      cid: "bafy-shot",
      index: 2,
    }),
    "v1/profile/screenshot/did~3Aplc~3Aapp/bafy-shot/i-2/original",
  );
});

Deno.test("cache hit returns bounded signed direct-object redirect", async () => {
  const requests: Request[] = [];
  const response = await cachedDerivedMediaRedirect(
    "v1/profile/banner/did~3Aplc~3Aapp/bafy/original",
    {
      config,
      now: new Date("2026-08-13T12:34:56Z"),
      fetchImpl: (input, init) => {
        requests.push(new Request(input, init));
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    },
  );
  assert(response);
  assertEquals(response.status, 302);
  const head = requests[0];
  assert(head);
  assertEquals(head.method, "HEAD");
  assertStringIncludes(head.url, "/storage/derived-media/v1/profile/banner/");
  assertMatch(head.headers.get("authorization") ?? "", /^AWS4-HMAC-SHA256 /);
  const location = new URL(response.headers.get("location") ?? "");
  assertEquals(location.origin, "https://media.example.test");
  assertEquals(location.searchParams.get("X-Amz-Expires"), "604800");
  assertEquals(
    location.searchParams.get("X-Amz-Algorithm"),
    "AWS4-HMAC-SHA256",
  );
  assert(location.searchParams.get("X-Amz-Signature"));
  assertStringIncludes(
    response.headers.get("cache-control") ?? "",
    "stale-while-revalidate",
  );
});

Deno.test("cache miss and transport errors fall through to canonical source", async () => {
  for (
    const fetchImpl of [
      () => Promise.resolve(new Response(null, { status: 404 })),
      () => Promise.reject(new Error("offline")),
    ]
  ) {
    assertEquals(
      await cachedDerivedMediaRedirect("v1/a/b", { config, fetchImpl }),
      null,
    );
  }
});

Deno.test("verified media upload is signed and immutable", async () => {
  const requests: Request[] = [];
  const stored = await storeDerivedMedia({
    config,
    key: "v1/atproto/did~3Aplc~3Aalice/bafy/w-800.webp",
    bytes: new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46,
      0,
      0,
      0,
      0,
      0x57,
      0x45,
      0x42,
      0x50,
    ]),
    contentType: "image/webp",
    filename: "image.webp",
    now: new Date("2026-08-13T12:34:56Z"),
    fetchImpl: (input, init) => {
      requests.push(new Request(input, init));
      return Promise.resolve(new Response(null, { status: 200 }));
    },
  });
  assert(stored);
  const put = requests[0];
  assert(put);
  assertEquals(put.method, "PUT");
  assertEquals(put.headers.get("content-type"), "image/webp");
  assertEquals(
    put.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
  assertStringIncludes(
    put.headers.get("authorization") ?? "",
    "SignedHeaders=cache-control;content-disposition;content-type;host;x-amz-content-sha256;x-amz-date",
  );
});

Deno.test("invalid media keys and types never contact storage", async () => {
  let calls = 0;
  const fetchImpl = () => {
    calls++;
    return Promise.resolve(new Response(null, { status: 200 }));
  };
  assertEquals(
    await cachedDerivedMediaRedirect("../secret", { config, fetchImpl }),
    null,
  );
  assertEquals(
    await storeDerivedMedia({
      config,
      key: "v1/safe/key",
      bytes: new Uint8Array([1]),
      contentType: "text/html",
      fetchImpl,
    }),
    false,
  );
  assertEquals(
    await storeDerivedMedia({
      config,
      key: "v1/safe/key.jpg",
      bytes: new TextEncoder().encode("<script>alert(1)</script>"),
      contentType: "image/jpeg",
      fetchImpl,
    }),
    false,
  );
  assertEquals(calls, 0);
});

Deno.test("destructive backfill verification compares exact stored bytes", async () => {
  const expected = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  assertEquals(
    await verifyCachedDerivedMedia(
      "v1/profile/og/did/cid/1200x630.jpg",
      expected,
      {
        config,
        now: new Date("2026-08-13T12:34:56Z"),
        fetchImpl: () =>
          Promise.resolve(
            new Response(expected, {
              headers: { "content-length": String(expected.byteLength) },
            }),
          ),
      },
    ),
    true,
  );
  assertEquals(
    await verifyCachedDerivedMedia(
      "v1/profile/og/did/cid/1200x630.jpg",
      expected,
      {
        config,
        fetchImpl: () =>
          Promise.resolve(
            new Response(
              new Uint8Array([0xff, 0xd8, 0x00, 0xd9]),
              { headers: { "content-length": String(expected.byteLength) } },
            ),
          ),
      },
    ),
    false,
  );
});

Deno.test("derived media upload refuses oversized bytes", async () => {
  let calls = 0;
  assertEquals(
    await storeDerivedMedia({
      config,
      key: "v1/profile/og/did/cid/1200x630.jpg",
      bytes: new Uint8Array(8_000_001),
      contentType: "image/jpeg",
      fetchImpl: () => {
        calls++;
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    }),
    false,
  );
  assertEquals(calls, 0);
});

Deno.test("only bounded verified responses enter derived storage", async () => {
  const requests: Request[] = [];
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const stored = await storeVerifiedMediaResponse(
    "v1/profile/og/did~3Aplc~3Aapp/bafy/1200x630.jpg",
    new Response(bytes, {
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(bytes.byteLength),
      },
    }),
    "og.jpg",
    {
      config,
      fetchImpl: (input, init) => {
        requests.push(new Request(input, init));
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    },
  );
  assert(stored);
  assertEquals(requests.length, 1);
  assertEquals(
    await storeVerifiedMediaResponse(
      "v1/profile/og/did~3Aplc~3Aapp/bafy/1200x630.jpg",
      new Response(new TextEncoder().encode("not actually a jpeg"), {
        headers: {
          "content-type": "image/jpeg",
          "content-length": "19",
        },
      }),
      undefined,
      { config, fetchImpl: () => Promise.reject(new Error("must not fetch")) },
    ),
    false,
  );
  assertEquals(
    await storeVerifiedMediaResponse(
      "v1/profile/og/did~3Aplc~3Aapp/bafy/1200x630.jpg",
      new Response(bytes, {
        headers: {
          "content-type": "image/jpeg",
          "content-length": "9000000",
        },
      }),
      undefined,
      { config, fetchImpl: () => Promise.reject(new Error("must not fetch")) },
    ),
    false,
  );
});
