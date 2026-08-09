import { assertEquals } from "jsr:@std/assert@1";
import {
  hasImageSignature,
  isValidAtprotoBlobCid,
  verifyAtprotoBlobCid,
} from "./atproto-blob-security.ts";

Deno.test("AT Protocol blob CIDs bind immutable URLs to the returned bytes", async () => {
  const bytes = new TextEncoder().encode("verified blob bytes");
  const cid = await rawSha256Cid(bytes);

  assertEquals(isValidAtprotoBlobCid(cid), true);
  assertEquals(await verifyAtprotoBlobCid(cid, bytes), true);
  assertEquals(
    await verifyAtprotoBlobCid(cid, new TextEncoder().encode("substitution")),
    false,
  );
});

Deno.test("blob CID validation rejects non-canonical and unsupported CIDs", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const valid = await rawSha256Cid(bytes);
  assertEquals(isValidAtprotoBlobCid(`${valid}a`), false);
  assertEquals(isValidAtprotoBlobCid(valid.toUpperCase()), false);
  assertEquals(isValidAtprotoBlobCid(`z${valid.slice(1)}`), false);
  assertEquals(isValidAtprotoBlobCid("QmYwAPJzv5CZsnAzt8auVZRn"), false);
  assertEquals(isValidAtprotoBlobCid("b" + "a".repeat(129)), false);
});

Deno.test("proxied images must match their declared safe media type", () => {
  assertEquals(
    hasImageSignature(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]),
      "image/png",
    ),
    true,
  );
  assertEquals(
    hasImageSignature(
      new TextEncoder().encode("<script>alert(1)</script>"),
      "image/png",
    ),
    false,
  );
  assertEquals(
    hasImageSignature(new TextEncoder().encode("GIF89a..."), "image/gif"),
    true,
  );
  assertEquals(
    hasImageSignature(
      new Uint8Array([
        0,
        0,
        0,
        24,
        102,
        116,
        121,
        112,
        97,
        118,
        105,
        102,
        0,
        0,
        0,
        0,
        109,
        105,
        102,
        49,
        97,
        118,
        105,
        102,
      ]),
      "image/avif",
    ),
    true,
  );
});

async function rawSha256Cid(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", digestInput),
  );
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
