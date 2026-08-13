import {
  assert,
  assertEquals,
  assertMatch,
  assertStrictEquals,
} from "jsr:@std/assert@1";
import {
  BANNER_DERIVED_WIDTH,
  bannerDerivedMediaKey,
  deriveVerifiedBannerResponse,
} from "./[did].ts";

const WEBP_BYTES = new Uint8Array([
  0x52,
  0x49,
  0x46,
  0x46,
  0x04,
  0x00,
  0x00,
  0x00,
  0x57,
  0x45,
  0x42,
  0x50,
]);

Deno.test("banner derived cache key never aliases the canonical original", () => {
  const key = bannerDerivedMediaKey("did:plc:banner", "bafybanner");
  assertEquals(BANNER_DERIVED_WIDTH, 1600);
  assertMatch(key, /\/w-1600\.webp$/);
  assert(!key.endsWith("/original"));
});

Deno.test("verified banners become bounded WebP responses", async () => {
  const verified = verifiedBannerResponse();
  let receivedWidth = 0;
  let receivedQuality = 0;
  const derived = await deriveVerifiedBannerResponse(
    verified,
    (_bytes, width, quality) => {
      receivedWidth = width;
      receivedQuality = quality;
      return Promise.resolve(WEBP_BYTES);
    },
    "bafybanner",
  );

  assert(derived.transformed);
  assertEquals(receivedWidth, 1600);
  assertEquals(receivedQuality, 82);
  assertEquals(derived.response.headers.get("content-type"), "image/webp");
  assertEquals(
    derived.response.headers.get("content-length"),
    String(WEBP_BYTES.byteLength),
  );
  assertEquals(
    derived.response.headers.get("content-security-policy"),
    "default-src 'none'; sandbox",
  );
  assertEquals(
    derived.response.headers.get("access-control-allow-origin"),
    "*",
  );
  assertEquals(
    new Uint8Array(await derived.response.arrayBuffer()),
    WEBP_BYTES,
  );
});

Deno.test("failed or invalid transforms preserve the verified original", async () => {
  for (
    const transform of [
      () => Promise.reject(new Error("native transform failed")),
      () => Promise.resolve(new Uint8Array([1, 2, 3])),
    ]
  ) {
    const verified = verifiedBannerResponse();
    const derived = await deriveVerifiedBannerResponse(
      verified,
      transform,
      "bafybanner",
    );
    assert(!derived.transformed);
    assertStrictEquals(derived.response, verified);
    assertEquals(
      new Uint8Array(await derived.response.arrayBuffer()),
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    );
  }
});

function verifiedBannerResponse(): Response {
  return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    headers: {
      "content-type": "image/jpeg",
      "content-length": "4",
      "cache-control":
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}
