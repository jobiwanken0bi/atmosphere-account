import { createClient } from "@libsql/client";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { LoginRequest } from "./atmosphere-login.ts";
import type { DbClient } from "./db.ts";
import { b64uDecode, b64uEncode, sha256B64u } from "./jose.ts";
import {
  type AuthenticationUpdate,
  createDbPasskeyStore,
  createPasskeyAuthenticationOptions,
  createPasskeyRegistrationOptions,
  hasActivePasskey,
  type PasskeyAccount,
  type PasskeyCeremony,
  PasskeyError,
  type PasskeyStore,
  type PasskeyWebAuthnAdapter,
  revokePasskey,
  type SaveCredentialInput,
  type StoredPasskeyCredential,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from "./passkeys.ts";

const DID = "did:plc:alice123";
const OTHER_DID = "did:plc:bob456";
const CREDENTIAL_1 = "Y3JlZGVudGlhbC0x";
const CREDENTIAL_2 = "Y3JlZGVudGlhbC0y";
const NOW = 1_700_000_000_000;
const RP = {
  rpId: "localhost",
  origin: "http://localhost:5173",
  rpName: "Atmosphere",
};

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

async function assertRejectsCode(
  fn: () => Promise<unknown>,
  code: PasskeyError["code"],
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof PasskeyError, String(error));
    assertEquals(error.code, code);
    return;
  }
  throw new Error(`Expected promise to reject with ${code}`);
}

function cloneAccount(account: PasskeyAccount): PasskeyAccount {
  return { ...account };
}

function cloneCredential(
  credential: StoredPasskeyCredential,
): StoredPasskeyCredential {
  return { ...credential, transports: [...credential.transports] };
}

function cloneCeremony(ceremony: PasskeyCeremony): PasskeyCeremony {
  return {
    ...ceremony,
    loginRequest: ceremony.loginRequest ? { ...ceremony.loginRequest } : null,
  };
}

class MemoryPasskeyStore implements PasskeyStore {
  readonly accounts = new Map<string, PasskeyAccount>();
  readonly credentials = new Map<string, StoredPasskeyCredential>();
  readonly ceremonies = new Map<string, PasskeyCeremony>();
  private nextAccount = 1;

  getOrCreateAccount(did: string, now: number): Promise<PasskeyAccount> {
    const existing = this.accounts.get(did);
    if (existing) return Promise.resolve(cloneAccount(existing));
    const bytes = new Uint8Array(32);
    bytes.fill(this.nextAccount++);
    const account = {
      did,
      userHandle: b64uEncode(bytes),
      createdAt: now,
      updatedAt: now,
    };
    this.accounts.set(did, account);
    return Promise.resolve(cloneAccount(account));
  }

  getAccount(did: string): Promise<PasskeyAccount | null> {
    const account = this.accounts.get(did);
    return Promise.resolve(account ? cloneAccount(account) : null);
  }

  listCredentials(
    did: string,
    options: { includeRevoked?: boolean } = {},
  ): Promise<StoredPasskeyCredential[]> {
    const credentials = [...this.credentials.values()]
      .filter((credential) =>
        credential.did === did &&
        (options.includeRevoked || credential.revokedAt === null)
      )
      .sort((left, right) =>
        right.createdAt - left.createdAt ||
        left.credentialId.localeCompare(right.credentialId)
      )
      .map(cloneCredential);
    return Promise.resolve(credentials);
  }

  getCredential(
    credentialId: string,
  ): Promise<StoredPasskeyCredential | null> {
    const credential = this.credentials.get(credentialId);
    return Promise.resolve(credential ? cloneCredential(credential) : null);
  }

  saveCredential(input: SaveCredentialInput): Promise<void> {
    if (this.credentials.has(input.credentialId)) {
      throw new Error("UNIQUE constraint failed: credential_id");
    }
    this.credentials.set(input.credentialId, {
      credentialId: input.credentialId,
      did: input.did,
      publicKey: input.publicKey,
      counter: input.counter,
      deviceType: input.deviceType,
      backedUp: input.backedUp,
      transports: [...input.transports],
      name: input.name,
      createdAt: input.now,
      updatedAt: input.now,
      lastUsedAt: null,
      revokedAt: null,
    });
    return Promise.resolve();
  }

  updateCredentialAfterAuthentication(
    input: AuthenticationUpdate,
  ): Promise<boolean> {
    const credential = this.credentials.get(input.credentialId);
    if (
      !credential || credential.did !== input.did ||
      credential.revokedAt !== null ||
      credential.counter !== input.previousCounter
    ) return Promise.resolve(false);
    this.credentials.set(input.credentialId, {
      ...credential,
      counter: input.newCounter,
      deviceType: input.deviceType,
      backedUp: input.backedUp,
      updatedAt: input.now,
      lastUsedAt: input.now,
    });
    return Promise.resolve(true);
  }

  revokeCredential(
    did: string,
    credentialId: string,
    now: number,
  ): Promise<boolean> {
    const credential = this.credentials.get(credentialId);
    if (
      !credential || credential.did !== did || credential.revokedAt !== null
    ) return Promise.resolve(false);
    this.credentials.set(credentialId, {
      ...credential,
      revokedAt: now,
      updatedAt: now,
    });
    return Promise.resolve(true);
  }

  saveCeremony(ceremony: PasskeyCeremony): Promise<void> {
    if (this.ceremonies.has(ceremony.codeHash)) {
      throw new Error("UNIQUE constraint failed: code_hash");
    }
    this.ceremonies.set(ceremony.codeHash, cloneCeremony(ceremony));
    return Promise.resolve();
  }

  consumeCeremony(
    codeHash: string,
    now: number,
  ): Promise<PasskeyCeremony | null> {
    const ceremony = this.ceremonies.get(codeHash);
    if (!ceremony || ceremony.expiresAt <= now) return Promise.resolve(null);
    this.ceremonies.delete(codeHash);
    return Promise.resolve(cloneCeremony(ceremony));
  }
}

interface FakeWebAuthn extends PasskeyWebAuthnAdapter {
  registrationOptionCalls: Parameters<
    typeof generateRegistrationOptions
  >[0][];
  registrationVerificationCalls: Parameters<
    typeof verifyRegistrationResponse
  >[0][];
  authenticationOptionCalls: Parameters<
    typeof generateAuthenticationOptions
  >[0][];
  authenticationVerificationCalls: Parameters<
    typeof verifyAuthenticationResponse
  >[0][];
  registrationCredentialId: string;
  registrationUserVerified: boolean;
  authenticationUserVerified: boolean;
  nextCounter: number;
}

function createFakeWebAuthn(): FakeWebAuthn {
  const fake: FakeWebAuthn = {
    registrationOptionCalls: [],
    registrationVerificationCalls: [],
    authenticationOptionCalls: [],
    authenticationVerificationCalls: [],
    registrationCredentialId: CREDENTIAL_1,
    registrationUserVerified: true,
    authenticationUserVerified: true,
    nextCounter: 1,

    async generateRegistrationOptions(options) {
      fake.registrationOptionCalls.push(options);
      return await generateRegistrationOptions(options);
    },

    verifyRegistrationResponse(options) {
      fake.registrationVerificationCalls.push(options);
      return Promise.resolve({
        verified: true,
        registrationInfo: {
          fmt: "none",
          aaguid: "00000000-0000-0000-0000-000000000000",
          credential: {
            id: fake.registrationCredentialId,
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ["internal"],
          },
          credentialType: "public-key",
          attestationObject: new Uint8Array(),
          userVerified: fake.registrationUserVerified,
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
          origin: String(options.expectedOrigin),
          rpID: String(options.expectedRPID),
        },
      });
    },

    async generateAuthenticationOptions(options) {
      fake.authenticationOptionCalls.push(options);
      return await generateAuthenticationOptions(options);
    },

    verifyAuthenticationResponse(options) {
      fake.authenticationVerificationCalls.push(options);
      return Promise.resolve({
        verified: true,
        authenticationInfo: {
          credentialID: options.credential.id,
          newCounter: fake.nextCounter,
          userVerified: fake.authenticationUserVerified,
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
          origin: String(options.expectedOrigin),
          rpID: String(options.expectedRPID),
        },
      });
    },
  };
  return fake;
}

function registrationResponse(
  credentialId = CREDENTIAL_1,
): RegistrationResponseJSON {
  return {
    id: credentialId,
    rawId: credentialId,
    response: {
      clientDataJSON: "AA",
      attestationObject: "AA",
      transports: ["internal"],
    },
    clientExtensionResults: {},
    type: "public-key",
  };
}

function authenticationResponse(
  credentialId: string,
  userHandle: string,
): AuthenticationResponseJSON {
  return {
    id: credentialId,
    rawId: credentialId,
    response: {
      clientDataJSON: "AA",
      authenticatorData: "AA",
      signature: "AA",
      userHandle,
    },
    clientExtensionResults: {},
    type: "public-key",
  };
}

async function enroll(
  store: MemoryPasskeyStore,
  webAuthn: FakeWebAuthn,
  credentialId = CREDENTIAL_1,
  now = NOW,
) {
  webAuthn.registrationCredentialId = credentialId;
  const creation = await createPasskeyRegistrationOptions({
    did: DID,
    handle: "alice.example",
    rp: RP,
    now,
    store,
    webAuthn,
  });
  return await verifyPasskeyRegistration({
    ceremonyToken: creation.ceremonyToken,
    response: registrationResponse(credentialId),
    rp: RP,
    expectedDid: DID,
    name: "My passkey",
    now: now + 1,
    store,
    webAuthn,
  });
}

Deno.test("registration requires a discoverable UV credential and a stable opaque user handle", async () => {
  const store = new MemoryPasskeyStore();
  const webAuthn = createFakeWebAuthn();
  const account = await store.getOrCreateAccount(DID, NOW);
  await store.saveCredential({
    credentialId: CREDENTIAL_1,
    did: DID,
    publicKey: "AQID",
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
    transports: ["internal"],
    name: null,
    now: NOW,
  });
  await store.saveCredential({
    credentialId: CREDENTIAL_2,
    did: DID,
    publicKey: "BAUG",
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
    transports: ["usb"],
    name: null,
    now: NOW,
  });
  await store.revokeCredential(DID, CREDENTIAL_2, NOW + 1);

  const first = await createPasskeyRegistrationOptions({
    did: DID,
    handle: "alice.example",
    displayName: "Alice",
    rp: RP,
    now: NOW + 2,
    store,
    webAuthn,
  });
  const second = await createPasskeyRegistrationOptions({
    did: DID,
    handle: "alice.example",
    rp: RP,
    now: NOW + 3,
    store,
    webAuthn,
  });

  assertEquals(first.options.attestation, "none");
  assertEquals(first.options.authenticatorSelection, {
    residentKey: "required",
    requireResidentKey: true,
    userVerification: "required",
  });
  assertEquals(first.options.rp.id, RP.rpId);
  assertEquals(first.options.user.id, second.options.user.id);
  assertEquals(first.options.user.id, account.userHandle);
  assert(first.options.user.id !== DID);
  assertEquals(b64uDecode(first.options.user.id).byteLength, 32);
  assertEquals(first.options.excludeCredentials, [{
    id: CREDENTIAL_1,
    transports: ["internal"],
    type: "public-key",
  }]);
  assertEquals(first.ceremonyToken.length, 32);
  assert(first.ceremonyToken !== second.ceremonyToken);
  const hash = await sha256B64u(first.ceremonyToken);
  assert(store.ceremonies.has(hash));
  assert(!store.ceremonies.has(first.ceremonyToken));
  assertEquals(store.ceremonies.get(hash)?.expiresAt, NOW + 2 + 5 * 60_000);
});

Deno.test("registration is DID-bound, one-use, and supports multiple passkeys", async () => {
  const store = new MemoryPasskeyStore();
  const webAuthn = createFakeWebAuthn();
  const wrongAccountAttempt = await createPasskeyRegistrationOptions({
    did: DID,
    handle: "alice.example",
    rp: RP,
    now: NOW,
    store,
    webAuthn,
  });
  await assertRejectsCode(
    () =>
      verifyPasskeyRegistration({
        ceremonyToken: wrongAccountAttempt.ceremonyToken,
        response: registrationResponse(),
        rp: RP,
        expectedDid: OTHER_DID,
        now: NOW + 1,
        store,
        webAuthn,
      }),
    "verification_failed",
  );
  assertEquals(webAuthn.registrationVerificationCalls.length, 0);

  const first = await enroll(store, webAuthn);
  assertEquals(first, {
    credentialId: CREDENTIAL_1,
    did: DID,
    name: "My passkey",
    deviceType: "multiDevice",
    backedUp: true,
    transports: ["internal"],
    createdAt: NOW + 1,
    updatedAt: NOW + 1,
    lastUsedAt: null,
    revokedAt: null,
  });
  assertEquals(store.credentials.get(CREDENTIAL_1)?.publicKey, "AQID");
  const verification = webAuthn.registrationVerificationCalls[0];
  assertEquals(verification.expectedOrigin, RP.origin);
  assertEquals(verification.expectedRPID, RP.rpId);
  assertEquals(verification.expectedType, "webauthn.create");
  assertEquals(verification.requireUserPresence, true);
  assertEquals(verification.requireUserVerification, true);

  webAuthn.registrationCredentialId = CREDENTIAL_2;
  const secondCreation = await createPasskeyRegistrationOptions({
    did: DID,
    handle: "alice.example",
    rp: RP,
    now: NOW + 2,
    store,
    webAuthn,
  });
  await verifyPasskeyRegistration({
    ceremonyToken: secondCreation.ceremonyToken,
    response: registrationResponse(CREDENTIAL_2),
    rp: RP,
    expectedDid: DID,
    now: NOW + 3,
    store,
    webAuthn,
  });
  assertEquals((await store.listCredentials(DID)).length, 2);
  await assertRejectsCode(
    () =>
      verifyPasskeyRegistration({
        ceremonyToken: secondCreation.ceremonyToken,
        response: registrationResponse(CREDENTIAL_2),
        rp: RP,
        expectedDid: DID,
        now: NOW + 4,
        store,
        webAuthn,
      }),
    "ceremony_invalid_or_expired",
  );
});

Deno.test("authentication uses discoverable credentials and restores a validated login request", async () => {
  const store = new MemoryPasskeyStore();
  const webAuthn = createFakeWebAuthn();
  await enroll(store, webAuthn);
  const request: LoginRequest = {
    clientId: "https://app.example/client-metadata.json",
    returnUri: "https://app.example/auth/callback",
    state: "opaque-state",
    scope: "atproto transition:generic",
  };
  const options = await createPasskeyAuthenticationOptions({
    rp: RP,
    loginRequest: request,
    now: NOW + 2,
    store,
    webAuthn,
  });
  assertEquals(options.options.rpId, RP.rpId);
  assertEquals(options.options.userVerification, "required");
  assertEquals(options.options.allowCredentials, undefined);
  assertEquals(
    webAuthn.authenticationOptionCalls[0].allowCredentials,
    undefined,
  );

  const account = await store.getAccount(DID);
  assert(account);
  const result = await verifyPasskeyAuthentication({
    ceremonyToken: options.ceremonyToken,
    response: authenticationResponse(CREDENTIAL_1, account.userHandle),
    rp: RP,
    now: NOW + 3,
    store,
    webAuthn,
  });
  assertEquals(result.did, DID);
  assertEquals(result.loginRequest, request);
  assertEquals(result.credential.lastUsedAt, NOW + 3);
  const verification = webAuthn.authenticationVerificationCalls[0];
  assertEquals(verification.expectedOrigin, RP.origin);
  assertEquals(verification.expectedRPID, RP.rpId);
  assertEquals(verification.expectedType, "webauthn.get");
  assertEquals(verification.requireUserVerification, true);
  assertEquals(verification.advancedFIDOConfig, {
    userVerification: "required",
  });
  assertEquals([...verification.credential.publicKey], [1, 2, 3]);
  assertEquals(verification.credential.counter, 0);
  assertEquals(store.credentials.get(CREDENTIAL_1)?.counter, 1);

  await assertRejectsCode(
    () =>
      verifyPasskeyAuthentication({
        ceremonyToken: options.ceremonyToken,
        response: authenticationResponse(CREDENTIAL_1, account.userHandle),
        rp: RP,
        now: NOW + 4,
        store,
        webAuthn,
      }),
    "ceremony_invalid_or_expired",
  );

  const wrongHandle = await createPasskeyAuthenticationOptions({
    rp: RP,
    now: NOW + 5,
    store,
    webAuthn,
  });
  await assertRejectsCode(
    () =>
      verifyPasskeyAuthentication({
        ceremonyToken: wrongHandle.ceremonyToken,
        response: authenticationResponse(CREDENTIAL_1, "d3Jvbmc"),
        rp: RP,
        now: NOW + 6,
        store,
        webAuthn,
      }),
    "verification_failed",
  );
  assertEquals(webAuthn.authenticationVerificationCalls.length, 1);
});

Deno.test("synced passkey counters are telemetry while device-bound counters stay strict", async () => {
  const syncedStore = new MemoryPasskeyStore();
  const syncedWebAuthn = createFakeWebAuthn();
  await enroll(syncedStore, syncedWebAuthn);
  const synced = syncedStore.credentials.get(CREDENTIAL_1);
  assert(synced);
  syncedStore.credentials.set(CREDENTIAL_1, { ...synced, counter: 9 });
  syncedWebAuthn.nextCounter = 3;
  const syncedAccount = await syncedStore.getAccount(DID);
  assert(syncedAccount);
  const syncedOptions = await createPasskeyAuthenticationOptions({
    rp: RP,
    now: NOW + 10,
    store: syncedStore,
    webAuthn: syncedWebAuthn,
  });
  await verifyPasskeyAuthentication({
    ceremonyToken: syncedOptions.ceremonyToken,
    response: authenticationResponse(CREDENTIAL_1, syncedAccount.userHandle),
    rp: RP,
    now: NOW + 11,
    store: syncedStore,
    webAuthn: syncedWebAuthn,
  });
  assertEquals(
    syncedWebAuthn.authenticationVerificationCalls[0].credential.counter,
    0,
  );
  assertEquals(syncedStore.credentials.get(CREDENTIAL_1)?.counter, 3);

  const boundStore = new MemoryPasskeyStore();
  const boundWebAuthn = createFakeWebAuthn();
  await enroll(boundStore, boundWebAuthn);
  const bound = boundStore.credentials.get(CREDENTIAL_1);
  assert(bound);
  boundStore.credentials.set(CREDENTIAL_1, {
    ...bound,
    counter: 9,
    deviceType: "singleDevice",
    backedUp: false,
  });
  boundWebAuthn.nextCounter = 10;
  const boundAccount = await boundStore.getAccount(DID);
  assert(boundAccount);
  const boundOptions = await createPasskeyAuthenticationOptions({
    rp: RP,
    now: NOW + 12,
    store: boundStore,
    webAuthn: boundWebAuthn,
  });
  await verifyPasskeyAuthentication({
    ceremonyToken: boundOptions.ceremonyToken,
    response: authenticationResponse(CREDENTIAL_1, boundAccount.userHandle),
    rp: RP,
    now: NOW + 13,
    store: boundStore,
    webAuthn: boundWebAuthn,
  });
  assertEquals(
    boundWebAuthn.authenticationVerificationCalls[0].credential.counter,
    9,
  );
});

Deno.test("ceremonies expire at five minutes and bind the exact origin and RP ID", async () => {
  const store = new MemoryPasskeyStore();
  const webAuthn = createFakeWebAuthn();
  const account = await store.getOrCreateAccount(DID, NOW);
  const expired = await createPasskeyAuthenticationOptions({
    rp: RP,
    now: NOW,
    store,
    webAuthn,
  });
  await assertRejectsCode(
    () =>
      verifyPasskeyAuthentication({
        ceremonyToken: expired.ceremonyToken,
        response: authenticationResponse(CREDENTIAL_1, account.userHandle),
        rp: RP,
        now: NOW + 5 * 60_000,
        store,
        webAuthn,
      }),
    "ceremony_invalid_or_expired",
  );

  const mismatched = await createPasskeyAuthenticationOptions({
    rp: RP,
    now: NOW + 1,
    store,
    webAuthn,
  });
  await assertRejectsCode(
    () =>
      verifyPasskeyAuthentication({
        ceremonyToken: mismatched.ceremonyToken,
        response: authenticationResponse(CREDENTIAL_1, account.userHandle),
        rp: { ...RP, origin: "http://localhost:5174" },
        now: NOW + 2,
        store,
        webAuthn,
      }),
    "ceremony_invalid_or_expired",
  );
  await assertRejectsCode(
    () =>
      verifyPasskeyAuthentication({
        ceremonyToken: mismatched.ceremonyToken,
        response: authenticationResponse(CREDENTIAL_1, account.userHandle),
        rp: RP,
        now: NOW + 3,
        store,
        webAuthn,
      }),
    "ceremony_invalid_or_expired",
  );

  const domainRp = {
    rpId: "example.test",
    origin: "https://login.example.test",
    rpName: "Atmosphere",
  };
  const rpMismatch = await createPasskeyAuthenticationOptions({
    rp: domainRp,
    now: NOW + 4,
    store,
    webAuthn,
  });
  await assertRejectsCode(
    () =>
      verifyPasskeyAuthentication({
        ceremonyToken: rpMismatch.ceremonyToken,
        response: authenticationResponse(CREDENTIAL_1, account.userHandle),
        rp: { ...domainRp, rpId: "login.example.test" },
        now: NOW + 5,
        store,
        webAuthn,
      }),
    "ceremony_invalid_or_expired",
  );
});

Deno.test("revocation is soft, account-scoped, and excludes a passkey from sign-in", async () => {
  const store = new MemoryPasskeyStore();
  const webAuthn = createFakeWebAuthn();
  await enroll(store, webAuthn);
  assertEquals(await hasActivePasskey(DID, { store }), true);
  assertEquals(
    await revokePasskey({
      did: OTHER_DID,
      credentialId: CREDENTIAL_1,
      now: NOW + 2,
      store,
    }),
    false,
  );
  assertEquals(
    await revokePasskey({
      did: DID,
      credentialId: CREDENTIAL_1,
      now: NOW + 3,
      store,
    }),
    true,
  );
  assertEquals(await hasActivePasskey(DID, { store }), false);
  assertEquals((await store.listCredentials(DID)).length, 0);
  assertEquals(
    (await store.listCredentials(DID, { includeRevoked: true }))[0].revokedAt,
    NOW + 3,
  );
  assertEquals(
    await revokePasskey({
      did: DID,
      credentialId: CREDENTIAL_1,
      now: NOW + 4,
      store,
    }),
    false,
  );
  const auth = await createPasskeyAuthenticationOptions({
    rp: RP,
    did: DID,
    now: NOW + 5,
    store,
    webAuthn,
  });
  const account = await store.getAccount(DID);
  assert(account);
  await assertRejectsCode(
    () =>
      verifyPasskeyAuthentication({
        ceremonyToken: auth.ceremonyToken,
        response: authenticationResponse(CREDENTIAL_1, account.userHandle),
        rp: RP,
        now: NOW + 6,
        store,
        webAuthn,
      }),
    "credential_not_found",
  );
});

Deno.test("database store persists opaque accounts and atomically consumes ceremonies", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await db.execute(`CREATE TABLE passkey_account (
      did TEXT PRIMARY KEY,
      user_handle TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    await db.execute(`CREATE TABLE passkey_credential (
      credential_id TEXT PRIMARY KEY,
      did TEXT NOT NULL REFERENCES passkey_account(did) ON DELETE CASCADE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      device_type TEXT NOT NULL,
      backed_up INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked_at INTEGER
    )`);
    await db.execute(`CREATE TABLE passkey_ceremony (
      code_hash TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      challenge TEXT NOT NULL,
      did TEXT,
      rp_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      login_request_json TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    )`);
    const store = createDbPasskeyStore((fn) => fn(db as unknown as DbClient));
    const account = await store.getOrCreateAccount(DID, NOW);
    assert(account.userHandle !== DID);
    assertEquals(b64uDecode(account.userHandle).byteLength, 32);
    assertEquals(
      (await store.getOrCreateAccount(DID, NOW + 1)).userHandle,
      account.userHandle,
    );

    const ceremony: PasskeyCeremony = {
      codeHash: "opaque_hash",
      kind: "authentication",
      challenge: "challenge",
      did: null,
      rpId: RP.rpId,
      origin: RP.origin,
      loginRequest: null,
      createdAt: NOW,
      expiresAt: NOW + 1_000,
    };
    await store.saveCeremony(ceremony);
    const attempts = await Promise.all([
      store.consumeCeremony(ceremony.codeHash, NOW + 1),
      store.consumeCeremony(ceremony.codeHash, NOW + 1),
    ]);
    assertEquals(attempts.filter(Boolean).length, 1);
    assertEquals(
      await store.consumeCeremony(ceremony.codeHash, NOW + 1),
      null,
    );

    await store.saveCredential({
      credentialId: CREDENTIAL_1,
      did: DID,
      publicKey: "AQID",
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      transports: ["internal"],
      name: "Laptop",
      now: NOW,
    });
    assertEquals((await store.listCredentials(DID))[0].name, "Laptop");
    assertEquals(
      await store.updateCredentialAfterAuthentication({
        credentialId: CREDENTIAL_1,
        did: DID,
        previousCounter: 0,
        newCounter: 1,
        deviceType: "multiDevice",
        backedUp: true,
        now: NOW + 2,
      }),
      true,
    );
    assertEquals((await store.getCredential(CREDENTIAL_1))?.counter, 1);
  } finally {
    db.close();
  }
});
