/** Security checks for blobs returned by com.atproto.sync.getBlob.
 *
 * AT Protocol blob references are CIDv1 values using the raw codec and a
 * sha2-256 multihash. Verifying the digest prevents a compromised or buggy PDS
 * from substituting bytes under another account's immutable blob URL.
 */

const CIDV1 = 0x01;
const RAW_CODEC = 0x55;
const SHA2_256 = 0x12;
const SHA2_256_BYTES = 32;
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export async function verifyAtprotoBlobCid(
  cid: string,
  bytes: Uint8Array,
): Promise<boolean> {
  const expected = atprotoBlobDigest(cid);
  if (!expected) return false;
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const actual = new Uint8Array(
    await crypto.subtle.digest("SHA-256", digestInput),
  );
  return constantTimeEqual(actual, expected);
}

export function isValidAtprotoBlobCid(cid: string): boolean {
  return atprotoBlobDigest(cid) !== null;
}

function atprotoBlobDigest(cid: string): Uint8Array | null {
  // A raw sha2-256 CIDv1 is exactly 36 binary bytes and therefore 59
  // characters including its multibase prefix.
  if (
    !cid || cid.length !== 59 || cid[0] !== "b" || cid !== cid.toLowerCase()
  ) {
    return null;
  }
  // AT Protocol blob CIDs are CIDv1 base32 (multibase prefix `b`). CIDv0 is
  // DAG-PB and therefore cannot identify a raw repo blob.
  const decoded = decodeBase32(cid.slice(1));
  if (!decoded) return null;

  let offset = 0;
  const version = readVarint(decoded, offset);
  if (!version || version.value !== CIDV1) return null;
  offset = version.next;
  const codec = readVarint(decoded, offset);
  if (!codec || codec.value !== RAW_CODEC) return null;
  offset = codec.next;
  const hashCode = readVarint(decoded, offset);
  if (!hashCode || hashCode.value !== SHA2_256) return null;
  offset = hashCode.next;
  const hashLength = readVarint(decoded, offset);
  if (!hashLength || hashLength.value !== SHA2_256_BYTES) return null;
  offset = hashLength.next;
  if (decoded.byteLength !== offset + SHA2_256_BYTES) return null;
  return decoded.slice(offset);
}

function decodeBase32(value: string): Uint8Array | null {
  if (!value || /[=\s]/.test(value)) return null;
  const output: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const raw of value) {
    const index = BASE32_ALPHABET.indexOf(raw.toLowerCase());
    if (index < 0) return null;
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >>> bits) & 0xff);
      accumulator &= (1 << bits) - 1;
    }
  }
  // Unused padding bits must be zero, otherwise multiple spellings could map
  // to the same CID and fragment an immutable cache key.
  if (bits > 0 && accumulator !== 0) return null;
  return new Uint8Array(output);
}

function readVarint(
  bytes: Uint8Array,
  start: number,
): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  for (let i = start; i < bytes.length && i < start + 5; i++) {
    const byte = bytes[i];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      // Reject non-minimal varints to preserve one canonical CID structure.
      if (i > start && byte === 0) return null;
      return Number.isSafeInteger(value) ? { value, next: i + 1 } : null;
    }
    shift += 7;
  }
  return null;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let different = 0;
  for (let i = 0; i < a.byteLength; i++) different |= a[i] ^ b[i];
  return different === 0;
}

export function hasImageSignature(
  bytes: Uint8Array,
  contentType: string,
): boolean {
  switch (contentType) {
    case "image/png":
      return startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP");
    case "image/gif":
      return ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a");
    case "image/avif":
      return hasAvifFileType(bytes);
    default:
      return false;
  }
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.byteLength >= prefix.length &&
    prefix.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, value: string): boolean {
  if (bytes.byteLength < offset + value.length) return false;
  for (let i = 0; i < value.length; i++) {
    if (bytes[offset + i] !== value.charCodeAt(i)) return false;
  }
  return true;
}

function hasAvifFileType(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12 || !ascii(bytes, 4, "ftyp")) return false;
  // Major brand plus compatible brands, bounded by the first ISO BMFF box.
  const declaredBoxSize = bytes[0] * 2 ** 24 + bytes[1] * 2 ** 16 +
    bytes[2] * 2 ** 8 + bytes[3];
  const end = Math.min(bytes.byteLength, declaredBoxSize, 64);
  for (let offset = 8; offset + 4 <= end; offset += 4) {
    if (ascii(bytes, offset, "avif") || ascii(bytes, offset, "avis")) {
      return true;
    }
  }
  return false;
}
