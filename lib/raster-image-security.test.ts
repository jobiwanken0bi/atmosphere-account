import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  matchesRasterImageSignature,
  readRasterImageBytesWithLimit,
  secureRasterImageProxyResponse,
} from "./raster-image-security.ts";

Deno.test("raster signatures reject HTML disguised as an image", () => {
  const html = new TextEncoder().encode("<script>alert(1)</script>");
  assertEquals(matchesRasterImageSignature(html, "image/png"), false);
  assert(
    matchesRasterImageSignature(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
      "image/png",
    ),
  );
  assert(
    matchesRasterImageSignature(
      new Uint8Array([0xff, 0xd8, 0xff]),
      "image/jpeg",
    ),
  );
  assert(
    matchesRasterImageSignature(
      new TextEncoder().encode("RIFF0000WEBP"),
      "image/webp",
    ),
  );
});

Deno.test("image proxy forces the validated raster MIME and sandbox", async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
  const response = await secureRasterImageProxyResponse(
    new Response(bytes, { headers: { "content-type": "text/html" } }),
    {
      cid: await rawSha256Cid(bytes),
      declaredMime: "image/png",
      maxBytes: 1024,
      cacheControl: "public, max-age=60",
      etag: "verified-cid",
    },
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "image/png");
  assertEquals(
    response.headers.get("content-security-policy"),
    "default-src 'none'; sandbox",
  );
  assertEquals(response.headers.get("x-content-type-options"), "nosniff");
  assertEquals(new Uint8Array(await response.arrayBuffer()), bytes);
});

Deno.test("image proxy rejects unsupported types and oversized declarations", async () => {
  const unsupported = await secureRasterImageProxyResponse(
    new Response("html", { headers: { "content-type": "text/html" } }),
    { cid: "invalid", maxBytes: 10, cacheControl: "no-store" },
  );
  assertEquals(unsupported.status, 415);

  const tooLarge = await secureRasterImageProxyResponse(
    new Response("small", {
      headers: {
        "content-type": "image/png",
        "content-length": "11",
      },
    }),
    { cid: "invalid", maxBytes: 10, cacheControl: "no-store" },
  );
  assertEquals(tooLarge.status, 413);
});

Deno.test("image proxy rejects chunked bodies at the runtime byte limit", async () => {
  const upstream = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    }),
    { headers: { "content-type": "image/png" } },
  );
  const response = await secureRasterImageProxyResponse(upstream, {
    cid: "invalid",
    maxBytes: 10,
    cacheControl: "no-store",
  });
  assertEquals(response.status, 502);
});

Deno.test("image proxy rejects content substitution and MIME confusion", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
  const cid = await rawSha256Cid(png);
  const substituted = await secureRasterImageProxyResponse(
    new Response(new TextEncoder().encode("substitution"), {
      headers: { "content-type": "image/png" },
    }),
    { cid, maxBytes: 1024, cacheControl: "no-store" },
  );
  assertEquals(substituted.status, 502);

  const html = new TextEncoder().encode("<script>alert(1)</script>");
  const disguised = await secureRasterImageProxyResponse(
    new Response(html, { headers: { "content-type": "image/png" } }),
    {
      cid: await rawSha256Cid(html),
      maxBytes: 1024,
      cacheControl: "no-store",
    },
  );
  assertEquals(disguised.status, 415);
});

Deno.test("server-side image reads reject chunked oversized responses", async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    }),
  );
  assertEquals(await readRasterImageBytesWithLimit(response, 12), null);
});

async function rawSha256Cid(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return `b${base32(new Uint8Array([0x01, 0x55, 0x12, 0x20, ...digest]))}`;
}

function base32(bytes: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let output = "";
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(accumulator >>> bits) & 31];
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0) output += alphabet[(accumulator << (5 - bits)) & 31];
  return output;
}
