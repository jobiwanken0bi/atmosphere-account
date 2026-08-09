import { assertEquals } from "jsr:@std/assert@1";
import { readSecureSvgBlob } from "./svg-blob-security.ts";

Deno.test("SVG blob serving verifies the CID and sanitizes remote bytes", async () => {
  const source = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' +
      '<script>alert(1)</script><path d="M0 0"/></svg>',
  );
  const result = await readSecureSvgBlob(
    new Response(source),
    await rawSha256Cid(source),
  );
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const cleaned = new TextDecoder().decode(result.bytes);
  assertEquals(cleaned.includes("<script"), false);
  assertEquals(cleaned.includes("onload="), false);
  assertEquals(cleaned.includes("<svg"), true);
});

Deno.test("SVG blob serving rejects substitutions and chunked oversize bodies", async () => {
  const expected = new TextEncoder().encode("<svg></svg>");
  const substituted = new TextEncoder().encode("<svg><path/></svg>");
  const mismatch = await readSecureSvgBlob(
    new Response(substituted),
    await rawSha256Cid(expected),
  );
  assertEquals(mismatch.ok, false);
  if (!mismatch.ok) assertEquals(mismatch.status, 502);

  const oversized = await readSecureSvgBlob(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<svg>"));
          controller.enqueue(new Uint8Array(32));
          controller.close();
        },
      }),
    ),
    await rawSha256Cid(expected),
    8,
  );
  assertEquals(oversized.ok, false);
  if (!oversized.ok) assertEquals(oversized.status, 413);
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
