import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { b64uEncode } from "./jose.ts";
import {
  decryptStoredSecret,
  encryptedStoredSecretForTest,
  encryptStoredSecret,
  resetStoredSecretKeyCacheForTest,
} from "./secret-storage.ts";

function key(fill: number): string {
  return b64uEncode(new Uint8Array(32).fill(fill));
}

async function withStorageKeys(
  value: string | null,
  callback: () => Promise<void>,
): Promise<void> {
  const previous = Deno.env.get("OAUTH_STORAGE_KEYS");
  try {
    if (value === null) Deno.env.delete("OAUTH_STORAGE_KEYS");
    else Deno.env.set("OAUTH_STORAGE_KEYS", value);
    resetStoredSecretKeyCacheForTest();
    await callback();
  } finally {
    if (previous === undefined) Deno.env.delete("OAUTH_STORAGE_KEYS");
    else Deno.env.set("OAUTH_STORAGE_KEYS", previous);
    resetStoredSecretKeyCacheForTest();
  }
}

Deno.test("OAuth storage encryption hides and authenticates secrets", async () => {
  await withStorageKeys(key(1), async () => {
    const plaintext = JSON.stringify({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      dpopPrivateJwk: { d: "private-key-secret" },
    });
    const stored = await encryptStoredSecret(
      plaintext,
      "oauth_grant:grant-a",
    );
    assertEquals(encryptedStoredSecretForTest(stored), true);
    assertEquals(stored.includes("access-secret"), false);
    assertEquals(stored.includes("refresh-secret"), false);
    assertEquals(stored.includes("private-key-secret"), false);
    assertEquals(
      await decryptStoredSecret(stored, "oauth_grant:grant-a"),
      { plaintext, needsUpgrade: false },
    );
    await assertRejects(
      () => decryptStoredSecret(stored, "oauth_grant:grant-b"),
      Error,
      "could not be authenticated",
    );
  });
});

Deno.test("OAuth storage key rotation reads old values and marks them for rewrite", async () => {
  let oldCiphertext = "";
  await withStorageKeys(key(2), async () => {
    oldCiphertext = await encryptStoredSecret("secret", "oauth_state:state");
  });
  await withStorageKeys(`${key(3)},${key(2)}`, async () => {
    assertEquals(
      await decryptStoredSecret(oldCiphertext, "oauth_state:state"),
      { plaintext: "secret", needsUpgrade: true },
    );
    const current = await encryptStoredSecret("secret", "oauth_state:state");
    assertEquals(
      await decryptStoredSecret(current, "oauth_state:state"),
      { plaintext: "secret", needsUpgrade: false },
    );
  });
});

Deno.test("legacy plaintext OAuth rows are accepted only for upgrade", async () => {
  await withStorageKeys(key(4), async () => {
    assertEquals(
      await decryptStoredSecret('{"legacy":true}', "oauth_grant:legacy"),
      { plaintext: '{"legacy":true}', needsUpgrade: true },
    );
  });
});
