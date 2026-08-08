import { sessionSecret } from "./env.ts";
import { b64uDecode, b64uEncode } from "./jose.ts";

const FORMAT_PREFIX = "enc:v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

interface StorageKey {
  id: string;
  key: CryptoKey;
}

let cachedKeySource: string | null = null;
let cachedKeyring: Promise<StorageKey[]> | null = null;

function configuredKeySource(): string {
  try {
    return Deno.env.get("OAUTH_STORAGE_KEYS")?.trim() || "";
  } catch {
    return "";
  }
}

async function derivedFallbackKey(): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret()),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("atmosphereaccount.com/oauth-storage/v1"),
      info: encoder.encode("OAuth flow and grant encryption"),
    },
    material,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function configuredKeys(source: string): Uint8Array[] {
  if (!source) return [];
  return source.split(",").map((part) => {
    const encoded = part.trim();
    if (!encoded) throw new Error("OAUTH_STORAGE_KEYS contains an empty key");
    let bytes: Uint8Array;
    try {
      bytes = b64uDecode(encoded);
    } catch {
      throw new Error("OAUTH_STORAGE_KEYS contains invalid base64url");
    }
    if (bytes.byteLength !== KEY_BYTES) {
      throw new Error("Every OAUTH_STORAGE_KEYS entry must decode to 32 bytes");
    }
    return bytes;
  });
}

async function importStorageKey(bytes: Uint8Array): Promise<StorageKey> {
  const raw = bytes.slice().buffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  return {
    id: b64uEncode(digest.slice(0, 12)),
    key: await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    ),
  };
}

async function storageKeyring(): Promise<StorageKey[]> {
  const source = configuredKeySource();
  if (cachedKeyring && cachedKeySource === source) return await cachedKeyring;
  cachedKeySource = source;
  cachedKeyring = (async () => {
    const configured = configuredKeys(source);
    const materials = configured.length > 0
      ? configured
      : [await derivedFallbackKey()];
    const keys = await Promise.all(materials.map(importStorageKey));
    if (new Set(keys.map((entry) => entry.id)).size !== keys.length) {
      throw new Error("OAUTH_STORAGE_KEYS contains duplicate keys");
    }
    return keys;
  })();
  return await cachedKeyring;
}

/** Encrypt a database value and bind it to its table/row identity. */
export async function encryptStoredSecret(
  plaintext: string,
  associatedData: string,
): Promise<string> {
  const [active] = await storageKeyring();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(associatedData),
      tagLength: 128,
    },
    active.key,
    encoder.encode(plaintext),
  );
  return `${FORMAT_PREFIX}:${active.id}:${b64uEncode(iv)}:${
    b64uEncode(ciphertext)
  }`;
}

export interface DecryptedStoredSecret {
  plaintext: string;
  /** Plain JSON rows from pre-encryption deployments are upgraded on read. */
  needsUpgrade: boolean;
}

export async function decryptStoredSecret(
  stored: string,
  associatedData: string,
): Promise<DecryptedStoredSecret> {
  if (!stored.startsWith(`${FORMAT_PREFIX}:`)) {
    return { plaintext: stored, needsUpgrade: true };
  }
  const parts = stored.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("encrypted storage value has an invalid format");
  }
  const [, , keyId, encodedIv, encodedCiphertext] = parts;
  const key = (await storageKeyring()).find((entry) => entry.id === keyId);
  if (!key) throw new Error("encrypted storage value uses an unavailable key");
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    iv = b64uDecode(encodedIv);
    ciphertext = b64uDecode(encodedCiphertext);
  } catch {
    throw new Error("encrypted storage value has invalid encoding");
  }
  if (iv.byteLength !== IV_BYTES || ciphertext.byteLength < 17) {
    throw new Error("encrypted storage value has invalid lengths");
  }
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv.slice().buffer,
        additionalData: encoder.encode(associatedData),
        tagLength: 128,
      },
      key.key,
      ciphertext.slice().buffer,
    );
  } catch {
    throw new Error("encrypted storage value could not be authenticated");
  }
  return {
    plaintext: decoder.decode(plaintext),
    needsUpgrade: keyId !== (await storageKeyring())[0].id,
  };
}

export function isEncryptedStoredSecret(value: string): boolean {
  return value.startsWith(`${FORMAT_PREFIX}:`);
}

export const encryptedStoredSecretForTest = isEncryptedStoredSecret;

export function resetStoredSecretKeyCacheForTest(): void {
  cachedKeySource = null;
  cachedKeyring = null;
}
