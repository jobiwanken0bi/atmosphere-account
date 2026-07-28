import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type CredentialDeviceType,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { LoginRequest } from "./atmosphere-login.ts";
import type { DbClient } from "./db.ts";
import { b64uDecode, b64uEncode, randomB64u, sha256B64u } from "./jose.ts";

const CEREMONY_TTL_MS = 5 * 60_000;
const CEREMONY_TOKEN_BYTES = 24;
const USER_HANDLE_BYTES = 32;
const CEREMONY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_LOGIN_REQUEST_JSON_BYTES = 8_192;
const MAX_PASSKEY_NAME_LENGTH = 80;

export type PasskeyCeremonyKind = "registration" | "authentication";

export interface PasskeyRpConfig {
  rpId: string;
  origin: string;
  rpName?: string;
}

export interface PasskeySummary {
  credentialId: string;
  did: string;
  name: string | null;
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  transports: AuthenticatorTransportFuture[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface StoredPasskeyCredential extends PasskeySummary {
  publicKey: string;
  counter: number;
}

export interface PasskeyAccount {
  did: string;
  userHandle: string;
  createdAt: number;
  updatedAt: number;
}

export interface PasskeyCeremony {
  codeHash: string;
  kind: PasskeyCeremonyKind;
  challenge: string;
  did: string | null;
  rpId: string;
  origin: string;
  loginRequest: LoginRequest | null;
  createdAt: number;
  expiresAt: number;
}

export interface SaveCredentialInput {
  credentialId: string;
  did: string;
  publicKey: string;
  counter: number;
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  transports: AuthenticatorTransportFuture[];
  name: string | null;
  now: number;
}

export interface AuthenticationUpdate {
  credentialId: string;
  did: string;
  previousCounter: number;
  newCounter: number;
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  now: number;
}

export interface PasskeyStore {
  getOrCreateAccount(did: string, now: number): Promise<PasskeyAccount>;
  getAccount(did: string): Promise<PasskeyAccount | null>;
  listCredentials(
    did: string,
    options?: { includeRevoked?: boolean },
  ): Promise<StoredPasskeyCredential[]>;
  getCredential(credentialId: string): Promise<StoredPasskeyCredential | null>;
  saveCredential(input: SaveCredentialInput): Promise<void>;
  updateCredentialAfterAuthentication(
    input: AuthenticationUpdate,
  ): Promise<boolean>;
  revokeCredential(
    did: string,
    credentialId: string,
    now: number,
  ): Promise<boolean>;
  saveCeremony(ceremony: PasskeyCeremony): Promise<void>;
  consumeCeremony(
    codeHash: string,
    now: number,
  ): Promise<PasskeyCeremony | null>;
}

export interface PasskeyWebAuthnAdapter {
  generateRegistrationOptions: typeof generateRegistrationOptions;
  verifyRegistrationResponse: typeof verifyRegistrationResponse;
  generateAuthenticationOptions: typeof generateAuthenticationOptions;
  verifyAuthenticationResponse: typeof verifyAuthenticationResponse;
}

const defaultWebAuthn: PasskeyWebAuthnAdapter = {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
};

export type PasskeyErrorCode =
  | "invalid_input"
  | "ceremony_invalid_or_expired"
  | "ceremony_conflict"
  | "credential_not_found"
  | "credential_conflict"
  | "verification_failed"
  | "concurrent_authentication";

export class PasskeyError extends Error {
  code: PasskeyErrorCode;

  constructor(code: PasskeyErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PasskeyError";
    this.code = code;
  }
}

export interface RegistrationOptionsResult {
  ceremonyToken: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

export async function createPasskeyRegistrationOptions(input: {
  did: string;
  handle: string;
  displayName?: string | null;
  rp: PasskeyRpConfig;
  now?: number;
  store?: PasskeyStore;
  webAuthn?: PasskeyWebAuthnAdapter;
}): Promise<RegistrationOptionsResult> {
  const did = validDid(input.did);
  const handle = requiredText(input.handle, "handle", 253);
  const displayName = optionalText(input.displayName, 100) ?? handle;
  const rp = normalizeRpConfig(input.rp);
  const now = input.now ?? Date.now();
  const store = input.store ?? dbPasskeyStore;
  const webAuthn = input.webAuthn ?? defaultWebAuthn;
  const [account, credentials] = await Promise.all([
    store.getOrCreateAccount(did, now),
    store.listCredentials(did),
  ]);

  const options = await webAuthn.generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpId,
    userID: arrayBufferBytes(account.userHandle),
    userName: handle,
    userDisplayName: displayName,
    attestationType: "none",
    excludeCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports,
    })),
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
  });
  const ceremonyToken = await saveCeremonyWithOpaqueToken(store, {
    kind: "registration",
    challenge: options.challenge,
    did,
    rpId: rp.rpId,
    origin: rp.origin,
    loginRequest: null,
    createdAt: now,
    expiresAt: now + CEREMONY_TTL_MS,
  });
  return { ceremonyToken, options };
}

export async function verifyPasskeyRegistration(input: {
  ceremonyToken: string;
  response: RegistrationResponseJSON;
  rp: PasskeyRpConfig;
  expectedDid?: string;
  name?: string | null;
  now?: number;
  store?: PasskeyStore;
  webAuthn?: PasskeyWebAuthnAdapter;
}): Promise<PasskeySummary> {
  const rp = normalizeRpConfig(input.rp);
  const expectedDid = input.expectedDid == null
    ? null
    : validDid(input.expectedDid);
  const now = input.now ?? Date.now();
  const store = input.store ?? dbPasskeyStore;
  const webAuthn = input.webAuthn ?? defaultWebAuthn;
  const ceremony = await consumeExpectedCeremony(
    store,
    input.ceremonyToken,
    "registration",
    rp,
    now,
  );
  if (!ceremony.did) {
    throw new PasskeyError(
      "ceremony_invalid_or_expired",
      "Passkey registration ceremony was not account-bound.",
    );
  }
  if (expectedDid && ceremony.did !== expectedDid) {
    throw new PasskeyError(
      "verification_failed",
      "Passkey registration does not match the authenticated account.",
    );
  }
  const responseCredentialId = validBase64Url(
    input.response.id,
    "credential ID",
  );
  if (!constantTimeTextEqual(responseCredentialId, input.response.rawId)) {
    throw new PasskeyError(
      "verification_failed",
      "Passkey credential binding could not be verified.",
    );
  }

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await webAuthn.verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: ceremony.origin,
      expectedRPID: ceremony.rpId,
      expectedType: "webauthn.create",
      requireUserPresence: true,
      requireUserVerification: true,
    });
  } catch (cause) {
    throw new PasskeyError(
      "verification_failed",
      "Passkey registration could not be verified.",
      cause,
    );
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new PasskeyError(
      "verification_failed",
      "Passkey registration could not be verified.",
    );
  }
  const info = verification.registrationInfo;
  if (!info.userVerified) {
    throw new PasskeyError(
      "verification_failed",
      "Passkey registration requires user verification.",
    );
  }
  const credentialId = validBase64Url(
    info.credential.id,
    "credential ID",
  );
  if (!constantTimeTextEqual(credentialId, responseCredentialId)) {
    throw new PasskeyError(
      "verification_failed",
      "Passkey credential binding could not be verified.",
    );
  }
  const credential: SaveCredentialInput = {
    credentialId,
    did: ceremony.did,
    publicKey: b64uEncode(info.credential.publicKey),
    counter: nonNegativeInteger(info.credential.counter, "counter"),
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    transports: normalizeTransports(
      info.credential.transports ?? input.response.response.transports ?? [],
    ),
    name: optionalText(input.name, MAX_PASSKEY_NAME_LENGTH),
    now,
  };
  try {
    await store.saveCredential(credential);
  } catch (cause) {
    if (!isUniqueConstraintError(cause)) throw cause;
    throw new PasskeyError(
      "credential_conflict",
      "This passkey is already registered.",
      cause,
    );
  }
  return summaryFromStored({
    ...credential,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    revokedAt: null,
  });
}

export interface AuthenticationOptionsResult {
  ceremonyToken: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

export async function createPasskeyAuthenticationOptions(input: {
  rp: PasskeyRpConfig;
  did?: string | null;
  loginRequest?: LoginRequest | null;
  now?: number;
  store?: PasskeyStore;
  webAuthn?: PasskeyWebAuthnAdapter;
}): Promise<AuthenticationOptionsResult> {
  const rp = normalizeRpConfig(input.rp);
  const did = input.did == null ? null : validDid(input.did);
  const loginRequest = input.loginRequest
    ? validatedLoginRequest(input.loginRequest)
    : null;
  const now = input.now ?? Date.now();
  const store = input.store ?? dbPasskeyStore;
  const webAuthn = input.webAuthn ?? defaultWebAuthn;
  const options = await webAuthn.generateAuthenticationOptions({
    rpID: rp.rpId,
    userVerification: "required",
    // Deliberately omit allowCredentials. This is a discoverable-credential
    // flow, so the authenticator identifies the account after user consent.
  });
  const ceremonyToken = await saveCeremonyWithOpaqueToken(store, {
    kind: "authentication",
    challenge: options.challenge,
    did,
    rpId: rp.rpId,
    origin: rp.origin,
    loginRequest,
    createdAt: now,
    expiresAt: now + CEREMONY_TTL_MS,
  });
  return { ceremonyToken, options };
}

export interface PasskeyAuthenticationResult {
  credential: PasskeySummary;
  did: string;
  loginRequest: LoginRequest | null;
}

export async function verifyPasskeyAuthentication(input: {
  ceremonyToken: string;
  response: AuthenticationResponseJSON;
  rp: PasskeyRpConfig;
  now?: number;
  store?: PasskeyStore;
  webAuthn?: PasskeyWebAuthnAdapter;
}): Promise<PasskeyAuthenticationResult> {
  const rp = normalizeRpConfig(input.rp);
  const now = input.now ?? Date.now();
  const store = input.store ?? dbPasskeyStore;
  const webAuthn = input.webAuthn ?? defaultWebAuthn;
  const ceremony = await consumeExpectedCeremony(
    store,
    input.ceremonyToken,
    "authentication",
    rp,
    now,
  );
  const credentialId = validBase64Url(input.response.id, "credential ID");
  if (!constantTimeTextEqual(credentialId, input.response.rawId)) {
    throw new PasskeyError(
      "verification_failed",
      "Passkey credential binding could not be verified.",
    );
  }
  const credential = await store.getCredential(credentialId);
  if (!credential || credential.revokedAt !== null) {
    throw new PasskeyError(
      "credential_not_found",
      "Passkey is unavailable.",
    );
  }
  if (ceremony.did && ceremony.did !== credential.did) {
    throw new PasskeyError(
      "verification_failed",
      "Passkey does not match the requested account.",
    );
  }
  const account = await store.getAccount(credential.did);
  if (!account) {
    throw new PasskeyError(
      "credential_not_found",
      "Passkey account is unavailable.",
    );
  }
  const returnedUserHandle = input.response.response.userHandle;
  if (
    !returnedUserHandle ||
    !constantTimeTextEqual(returnedUserHandle, account.userHandle)
  ) {
    throw new PasskeyError(
      "verification_failed",
      "Passkey account binding could not be verified.",
    );
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await webAuthn.verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: ceremony.origin,
      expectedRPID: ceremony.rpId,
      expectedType: "webauthn.get",
      requireUserVerification: true,
      advancedFIDOConfig: { userVerification: "required" },
      credential: {
        id: credential.credentialId,
        publicKey: arrayBufferBytes(credential.publicKey),
        // Synced credentials can legitimately be used concurrently across
        // devices, so their sign counters are observations rather than a hard
        // monotonic lock. Device-bound credentials retain strict counter
        // enforcement in SimpleWebAuthn.
        counter: credential.deviceType === "multiDevice"
          ? 0
          : credential.counter,
        transports: credential.transports,
      },
    });
  } catch (cause) {
    throw new PasskeyError(
      "verification_failed",
      "Passkey authentication could not be verified.",
      cause,
    );
  }
  const info = verification.authenticationInfo;
  if (
    !verification.verified || !info.userVerified ||
    !constantTimeTextEqual(info.credentialID, credential.credentialId)
  ) {
    throw new PasskeyError(
      "verification_failed",
      "Passkey authentication requires user verification.",
    );
  }
  const updated = await store.updateCredentialAfterAuthentication({
    credentialId: credential.credentialId,
    did: credential.did,
    previousCounter: credential.counter,
    newCounter: nonNegativeInteger(info.newCounter, "counter"),
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    now,
  });
  if (!updated) {
    throw new PasskeyError(
      "concurrent_authentication",
      "Passkey state changed during authentication. Try again.",
    );
  }
  return {
    did: credential.did,
    loginRequest: ceremony.loginRequest,
    credential: summaryFromStored({
      ...credential,
      counter: info.newCounter,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      updatedAt: now,
      lastUsedAt: now,
    }),
  };
}

export async function listPasskeys(
  did: string,
  options: {
    includeRevoked?: boolean;
    store?: PasskeyStore;
  } = {},
): Promise<PasskeySummary[]> {
  return (await (options.store ?? dbPasskeyStore).listCredentials(
    validDid(did),
    { includeRevoked: options.includeRevoked },
  )).map(summaryFromStored);
}

export async function hasActivePasskey(
  did: string,
  options: { store?: PasskeyStore } = {},
): Promise<boolean> {
  const credentials = await (options.store ?? dbPasskeyStore).listCredentials(
    validDid(did),
  );
  return credentials.length > 0;
}

export async function revokePasskey(input: {
  did: string;
  credentialId: string;
  now?: number;
  store?: PasskeyStore;
}): Promise<boolean> {
  return await (input.store ?? dbPasskeyStore).revokeCredential(
    validDid(input.did),
    validBase64Url(input.credentialId, "credential ID"),
    input.now ?? Date.now(),
  );
}

async function consumeExpectedCeremony(
  store: PasskeyStore,
  token: string,
  kind: PasskeyCeremonyKind,
  rp: Required<PasskeyRpConfig>,
  now: number,
): Promise<PasskeyCeremony> {
  if (!CEREMONY_TOKEN_PATTERN.test(token)) {
    throw new PasskeyError(
      "ceremony_invalid_or_expired",
      "Passkey ceremony is invalid or expired.",
    );
  }
  const ceremony = await store.consumeCeremony(await sha256B64u(token), now);
  if (
    !ceremony || ceremony.kind !== kind || ceremony.expiresAt <= now ||
    ceremony.origin !== rp.origin || ceremony.rpId !== rp.rpId
  ) {
    throw new PasskeyError(
      "ceremony_invalid_or_expired",
      "Passkey ceremony is invalid or expired.",
    );
  }
  return ceremony;
}

async function saveCeremonyWithOpaqueToken(
  store: PasskeyStore,
  ceremony: Omit<PasskeyCeremony, "codeHash">,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = randomB64u(CEREMONY_TOKEN_BYTES);
    try {
      await store.saveCeremony({
        ...ceremony,
        codeHash: await sha256B64u(token),
      });
      return token;
    } catch (cause) {
      if (!isUniqueConstraintError(cause) || attempt === 2) {
        throw new PasskeyError(
          "ceremony_conflict",
          "Could not create a passkey ceremony.",
          cause,
        );
      }
    }
  }
  throw new PasskeyError(
    "ceremony_conflict",
    "Could not create a passkey ceremony.",
  );
}

function normalizeRpConfig(
  config: PasskeyRpConfig,
): Required<PasskeyRpConfig> {
  const rpId = config.rpId.trim().toLowerCase().replace(/\.$/, "");
  if (
    !rpId || rpId.includes(":") || rpId.includes("/") ||
    !/^[a-z0-9.-]+$/.test(rpId)
  ) {
    throw new PasskeyError("invalid_input", "Invalid passkey RP ID.");
  }
  let originUrl: URL;
  try {
    originUrl = new URL(config.origin);
  } catch {
    throw new PasskeyError("invalid_input", "Invalid passkey origin.");
  }
  if (
    originUrl.origin !== config.origin.replace(/\/$/, "") ||
    originUrl.username || originUrl.password || originUrl.pathname !== "/" ||
    originUrl.search || originUrl.hash
  ) {
    throw new PasskeyError("invalid_input", "Invalid passkey origin.");
  }
  const originHost = originUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback = originHost === "localhost" || originHost === "127.0.0.1" ||
    originHost === "::1";
  if (
    originUrl.protocol !== "https:" &&
    !(originUrl.protocol === "http:" && loopback)
  ) {
    throw new PasskeyError(
      "invalid_input",
      "Passkey origin must be HTTPS or loopback development HTTP.",
    );
  }
  if (originHost !== rpId && !originHost.endsWith(`.${rpId}`)) {
    throw new PasskeyError(
      "invalid_input",
      "Passkey RP ID is not valid for this origin.",
    );
  }
  return {
    rpId,
    origin: originUrl.origin,
    rpName: optionalText(config.rpName, 80) ?? "Atmosphere",
  };
}

function validDid(value: string): string {
  const did = value.trim();
  if (!/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(did) || did.length > 512) {
    throw new PasskeyError("invalid_input", "Invalid account DID.");
  }
  return did;
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = optionalText(value, maxLength);
  if (!normalized) {
    throw new PasskeyError("invalid_input", `${label} is required.`);
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function validBase64Url(value: string, label: string): string {
  if (!value || value.length > 2048 || !BASE64URL_PATTERN.test(value)) {
    throw new PasskeyError("invalid_input", `Invalid ${label}.`);
  }
  return value;
}

function arrayBufferBytes(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(b64uDecode(value));
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PasskeyError("verification_failed", `Invalid ${label}.`);
  }
  return value;
}

function normalizeTransports(
  values: AuthenticatorTransportFuture[],
): AuthenticatorTransportFuture[] {
  const allowed = new Set<AuthenticatorTransportFuture>([
    "ble",
    "cable",
    "hybrid",
    "internal",
    "nfc",
    "smart-card",
    "usb",
  ]);
  return [...new Set(values.filter((value) => allowed.has(value)))];
}

function validatedLoginRequest(request: LoginRequest): LoginRequest {
  if (
    typeof request?.clientId !== "string" ||
    typeof request.returnUri !== "string" ||
    typeof request.state !== "string" ||
    !request.clientId.trim() || !request.returnUri.trim() ||
    !request.state.trim() || request.clientId.length > 2_048 ||
    request.returnUri.length > 2_048 || request.state.length > 500 ||
    (request.scope !== null && typeof request.scope !== "string")
  ) {
    throw new PasskeyError(
      "invalid_input",
      "Invalid validated Atmosphere Login request.",
    );
  }
  if (request.scope && request.scope.length > 1_000) {
    throw new PasskeyError(
      "invalid_input",
      "Invalid validated Atmosphere Login request.",
    );
  }
  const normalized = {
    clientId: request.clientId,
    returnUri: request.returnUri,
    state: request.state,
    scope: request.scope,
  };
  if (
    new TextEncoder().encode(JSON.stringify(normalized)).byteLength >
      MAX_LOGIN_REQUEST_JSON_BYTES
  ) {
    throw new PasskeyError(
      "invalid_input",
      "Atmosphere Login request is too large.",
    );
  }
  return normalized;
}

function summaryFromStored(
  credential: StoredPasskeyCredential,
): PasskeySummary {
  return {
    credentialId: credential.credentialId,
    did: credential.did,
    name: credential.name,
    deviceType: credential.deviceType,
    backedUp: credential.backedUp,
    transports: credential.transports,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
    lastUsedAt: credential.lastUsedAt,
    revokedAt: credential.revokedAt,
  };
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique|duplicate|primary key/i.test(message);
}

function rowsAffected(result: { rowsAffected?: number | bigint }): number {
  return Number(result.rowsAffected ?? 0);
}

function rowToAccount(row: Record<string, unknown>): PasskeyAccount {
  return {
    did: String(row.did ?? ""),
    userHandle: String(row.user_handle ?? ""),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

function rowToCredential(
  row: Record<string, unknown>,
): StoredPasskeyCredential {
  let transports: unknown = [];
  try {
    transports = JSON.parse(String(row.transports ?? "[]"));
  } catch {
    transports = [];
  }
  return {
    credentialId: String(row.credential_id ?? ""),
    did: String(row.did ?? ""),
    publicKey: String(row.public_key ?? ""),
    counter: Number(row.counter ?? 0),
    deviceType: row.device_type === "multiDevice"
      ? "multiDevice"
      : "singleDevice",
    backedUp: Number(row.backed_up ?? 0) === 1 || row.backed_up === true,
    transports: normalizeTransports(
      Array.isArray(transports)
        ? transports.filter((value): value is AuthenticatorTransportFuture =>
          typeof value === "string"
        )
        : [],
    ),
    name: typeof row.name === "string" && row.name ? row.name : null,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
    revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
  };
}

function rowToCeremony(row: Record<string, unknown>): PasskeyCeremony {
  if (row.kind !== "registration" && row.kind !== "authentication") {
    throw new PasskeyError(
      "ceremony_invalid_or_expired",
      "Passkey ceremony is invalid or expired.",
    );
  }
  let loginRequest: LoginRequest | null = null;
  if (typeof row.login_request_json === "string" && row.login_request_json) {
    try {
      const parsed = JSON.parse(row.login_request_json) as LoginRequest;
      loginRequest = validatedLoginRequest(parsed);
    } catch (cause) {
      throw new PasskeyError(
        "ceremony_invalid_or_expired",
        "Passkey ceremony is invalid or expired.",
        cause,
      );
    }
  }
  return {
    codeHash: String(row.code_hash ?? ""),
    kind: row.kind,
    challenge: String(row.challenge ?? ""),
    did: typeof row.did === "string" && row.did ? row.did : null,
    rpId: String(row.rp_id ?? ""),
    origin: String(row.origin ?? ""),
    loginRequest,
    createdAt: Number(row.created_at ?? 0),
    expiresAt: Number(row.expires_at ?? 0),
  };
}

export function createDbPasskeyStore(
  run: <T>(fn: (client: DbClient) => Promise<T>) => Promise<T> = defaultWithDb,
): PasskeyStore {
  return {
    async getOrCreateAccount(did, now) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await this.getAccount(did);
        if (existing) return existing;
        const userHandle = randomB64u(USER_HANDLE_BYTES);
        await run(async (client) => {
          await client.execute({
            sql: `
              INSERT INTO passkey_account (
                did, user_handle, created_at, updated_at
              ) VALUES (?, ?, ?, ?)
              ON CONFLICT(did) DO NOTHING
            `,
            args: [did, userHandle, now, now],
          });
        }).catch((error) => {
          if (!isUniqueConstraintError(error)) throw error;
        });
      }
      const account = await this.getAccount(did);
      if (!account) throw new Error("could not create passkey account");
      return account;
    },

    async getAccount(did) {
      return await run(async (client) => {
        const result = await client.execute({
          sql: `
            SELECT did, user_handle, created_at, updated_at
            FROM passkey_account
            WHERE did = ?
            LIMIT 1
          `,
          args: [did],
        });
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return row ? rowToAccount(row) : null;
      });
    },

    async listCredentials(did, options = {}) {
      return await run(async (client) => {
        const result = await client.execute({
          sql: `
            SELECT credential_id, did, public_key, counter, device_type,
                   backed_up, transports, name, created_at, updated_at,
                   last_used_at, revoked_at
            FROM passkey_credential
            WHERE did = ?
              ${options.includeRevoked ? "" : "AND revoked_at IS NULL"}
            ORDER BY created_at DESC, credential_id
          `,
          args: [did],
        });
        return result.rows.map((row) =>
          rowToCredential(row as Record<string, unknown>)
        );
      });
    },

    async getCredential(credentialId) {
      return await run(async (client) => {
        const result = await client.execute({
          sql: `
            SELECT credential_id, did, public_key, counter, device_type,
                   backed_up, transports, name, created_at, updated_at,
                   last_used_at, revoked_at
            FROM passkey_credential
            WHERE credential_id = ?
            LIMIT 1
          `,
          args: [credentialId],
        });
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return row ? rowToCredential(row) : null;
      });
    },

    async saveCredential(input) {
      await run(async (client) => {
        await client.execute({
          sql: `
            INSERT INTO passkey_credential (
              credential_id, did, public_key, counter, device_type,
              backed_up, transports, name, created_at, updated_at,
              last_used_at, revoked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
          `,
          args: [
            input.credentialId,
            input.did,
            input.publicKey,
            input.counter,
            input.deviceType,
            input.backedUp ? 1 : 0,
            JSON.stringify(input.transports),
            input.name,
            input.now,
            input.now,
          ],
        });
        await client.execute({
          sql: `UPDATE passkey_account SET updated_at = ? WHERE did = ?`,
          args: [input.now, input.did],
        });
      });
    },

    async updateCredentialAfterAuthentication(input) {
      return await run(async (client) => {
        const result = await client.execute({
          sql: `
            UPDATE passkey_credential
            SET counter = ?, device_type = ?, backed_up = ?,
                updated_at = ?, last_used_at = ?
            WHERE credential_id = ? AND did = ? AND revoked_at IS NULL
              AND counter = ?
          `,
          args: [
            input.newCounter,
            input.deviceType,
            input.backedUp ? 1 : 0,
            input.now,
            input.now,
            input.credentialId,
            input.did,
            input.previousCounter,
          ],
        });
        return rowsAffected(result) > 0;
      });
    },

    async revokeCredential(did, credentialId, now) {
      return await run(async (client) => {
        const result = await client.execute({
          sql: `
            UPDATE passkey_credential
            SET revoked_at = ?, updated_at = ?
            WHERE credential_id = ? AND did = ? AND revoked_at IS NULL
          `,
          args: [now, now, credentialId, did],
        });
        return rowsAffected(result) > 0;
      });
    },

    async saveCeremony(ceremony) {
      await run(async (client) => {
        await client.execute({
          sql: `
            INSERT INTO passkey_ceremony (
              code_hash, kind, challenge, did, rp_id, origin,
              login_request_json, created_at, expires_at, consumed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
          `,
          args: [
            ceremony.codeHash,
            ceremony.kind,
            ceremony.challenge,
            ceremony.did,
            ceremony.rpId,
            ceremony.origin,
            ceremony.loginRequest
              ? JSON.stringify(ceremony.loginRequest)
              : null,
            ceremony.createdAt,
            ceremony.expiresAt,
          ],
        });
      });
    },

    async consumeCeremony(codeHash, now) {
      return await run(async (client) => {
        const result = await client.execute({
          sql: `
            SELECT code_hash, kind, challenge, did, rp_id, origin,
                   login_request_json, created_at, expires_at
            FROM passkey_ceremony
            WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
            LIMIT 1
          `,
          args: [codeHash, now],
        });
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (!row) return null;
        const consumed = await client.execute({
          sql: `
            UPDATE passkey_ceremony
            SET consumed_at = ?
            WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
          `,
          args: [now, codeHash, now],
        });
        return rowsAffected(consumed) > 0 ? rowToCeremony(row) : null;
      });
    },
  };
}

async function defaultWithDb<T>(
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const { withDb } = await import("./db.ts");
  return await withDb(fn);
}

const dbPasskeyStore = createDbPasskeyStore();
