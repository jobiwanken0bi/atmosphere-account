/**
 * Minimal JWT/JWK helpers built on Web Crypto. Used for atproto OAuth
 * confidential client assertions, DPoP proofs, and HMAC-signed cookies.
 *
 * Supports only the algorithms we actually need:
 *   - ES256  (ECDSA P-256, raw r||s signature for JWTs)
 *   - HS256  (HMAC-SHA256, for cookie signing)
 */

export function b64uEncode(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

export function b64uDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "====".slice(padded.length % 4);
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomB64u(byteLen = 32): string {
  return b64uEncode(crypto.getRandomValues(new Uint8Array(byteLen)));
}

export async function sha256B64u(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return b64uEncode(digest);
}

/* ---------------- ES256 (ECDSA P-256) ---------------- */

let _privateKeyPromise: Promise<CryptoKey> | null = null;

export function importEs256PrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

export function importEs256PublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
}

export function loadClientPrivateKey(
  privateJwkJson: string,
): Promise<CryptoKey> {
  if (!_privateKeyPromise) {
    const jwk = JSON.parse(privateJwkJson) as JsonWebKey;
    _privateKeyPromise = importEs256PrivateKey(jwk);
  }
  return _privateKeyPromise;
}

export async function generateEs256KeyPair(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    privateJwk,
    publicJwk,
  };
}

interface SignEs256Options {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  privateKey: CryptoKey;
}

export async function signEs256({
  header,
  payload,
  privateKey,
}: SignEs256Options): Promise<string> {
  const finalHeader = { ...header, alg: "ES256" };
  const encodedHeader = b64uEncode(JSON.stringify(finalHeader));
  const encodedPayload = b64uEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const sigBuf = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64uEncode(sigBuf)}`;
}

/** Public JWK (no private key components) usable in DPoP `jwk` header. */
export function publicJwkOnly(jwk: JsonWebKey): JsonWebKey {
  const { kty, crv, x, y, e, n } = jwk;
  const out: JsonWebKey = { kty, crv, x, y };
  if (e) out.e = e;
  if (n) out.n = n;
  return out;
}

/* ---------------- HMAC (HS256) for cookies ---------------- */

let _hmacKey: CryptoKey | null = null;

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (_hmacKey) return _hmacKey;
  _hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return _hmacKey;
}

export async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return b64uEncode(sig);
}

export async function hmacVerify(
  secret: string,
  data: string,
  signature: string,
): Promise<boolean> {
  const key = await hmacKey(secret);
  const sig = b64uDecode(signature);
  const sigBuf = new ArrayBuffer(sig.byteLength);
  new Uint8Array(sigBuf).set(sig);
  return await crypto.subtle.verify(
    "HMAC",
    key,
    sigBuf,
    new TextEncoder().encode(data),
  );
}
