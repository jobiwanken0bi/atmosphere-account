import type { AppListing } from "./app-directory.ts";
import { getAppListingById } from "./app-directory.ts";
import { userControlsAppListing } from "./directory-entity-links.ts";
import { sessionSecret } from "./env.ts";
import {
  b64uDecode,
  b64uEncode,
  hmacSign,
  hmacVerify,
  randomB64u,
} from "./jose.ts";

const VERSION = "v2";
const DEFAULT_TTL_MS = 60 * 60_000;
const MAX_TTL_MS = 60 * 60_000;
const MAX_FUTURE_SKEW_MS = 60_000;
const MAX_TOKEN_LENGTH = 2_048;

export type AppHostLinkRelationship = "same_product" | "same_operator";

interface AppHostLinkIntentBase {
  appListingId: string;
  relationship: AppHostLinkRelationship;
  appOwnerDid: string;
  jti: string;
  issuedAt: number;
  expiresAt: number;
}

export interface AppHostLinkSelectorIntent extends AppHostLinkIntentBase {
  kind: "selector";
  host: null;
}

export interface BoundAppHostLinkIntent extends AppHostLinkIntentBase {
  kind: "bound";
  host: string;
}

export type AppHostLinkIntent =
  | AppHostLinkSelectorIntent
  | BoundAppHostLinkIntent;

export interface ResolvedAppHostLinkIntent<
  Intent extends AppHostLinkIntent = AppHostLinkIntent,
> {
  token: string;
  intent: Intent;
  app: AppListing;
}

export type AppHostLinkIntentFailureReason =
  | "missing"
  | "invalid"
  | "expired"
  | "app_unavailable"
  | "owner_changed"
  | "account_mismatch"
  | "wrong_stage"
  | "host_mismatch";

export type AppHostLinkIntentReadResult =
  | { ok: true; value: { token: string; intent: AppHostLinkIntent } }
  | { ok: false; reason: AppHostLinkIntentFailureReason };

interface AppHostLinkIntentOptions {
  now?: number;
  ttlMs?: number;
  signingSecret?: string;
  randomJti?: () => string;
}

interface ResolveAppHostLinkIntentOptions extends AppHostLinkIntentOptions {
  loadApp?: (id: string) => Promise<AppListing | null>;
}

export type AppHostLinkIntentResolution<
  Intent extends AppHostLinkIntent = AppHostLinkIntent,
> =
  | { ok: true; value: ResolvedAppHostLinkIntent<Intent> }
  | { ok: false; reason: AppHostLinkIntentFailureReason };

/**
 * Create an unbound selector capability. It may only be opened while the
 * current session still controls the app; it cannot enter a claim, email, or
 * account-switch flow until the app owner binds it to one exact host.
 */
export async function createAppHostLinkIntent(
  input: {
    appListingId: string;
    relationship: AppHostLinkRelationship;
    appOwnerDid: string;
  },
  options: AppHostLinkIntentOptions = {},
): Promise<string> {
  return await createIntentToken({
    ...input,
    kind: "selector",
    host: null,
  }, options);
}

/** Create an already host-bound capability from an authenticated app action. */
export async function createBoundAppHostLinkIntent(
  input: {
    appListingId: string;
    relationship: AppHostLinkRelationship;
    appOwnerDid: string;
    host: string;
  },
  options: AppHostLinkIntentOptions = {},
): Promise<string> {
  const host = normalizeIntentHost(input.host);
  if (!host) throw new Error("Invalid app-host link intent host.");
  return await createIntentToken({ ...input, kind: "bound", host }, options);
}

/**
 * Replace an unbound selector with a fresh host-bound, one-time capability.
 * Binding never extends the selector's original expiry.
 */
export async function bindAppHostLinkIntent(
  token: string | null | undefined,
  host: string,
  currentDid: string,
  options: ResolveAppHostLinkIntentOptions = {},
): Promise<AppHostLinkIntentResolution<BoundAppHostLinkIntent>> {
  const resolved = await resolveAppHostLinkSelectorIntent(
    token,
    currentDid,
    options,
  );
  if (!resolved.ok) return resolved;
  const normalizedHost = normalizeIntentHost(host);
  if (!normalizedHost) return { ok: false, reason: "invalid" };
  const now = options.now ?? Date.now();
  try {
    const boundToken = await createIntentToken({
      appListingId: resolved.value.intent.appListingId,
      relationship: resolved.value.intent.relationship,
      appOwnerDid: resolved.value.intent.appOwnerDid,
      kind: "bound",
      host: normalizedHost,
    }, {
      ...options,
      now,
      ttlMs: resolved.value.intent.expiresAt - now,
    });
    return await resolveBoundAppHostLinkIntent(boundToken, normalizedHost, {
      ...options,
      now,
    });
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export async function readAppHostLinkIntent(
  token: string | null | undefined,
  options: AppHostLinkIntentOptions = {},
): Promise<AppHostLinkIntentReadResult> {
  return await readSignedAppHostLinkIntent(token, options, false);
}

async function readSignedAppHostLinkIntent(
  token: string | null | undefined,
  options: AppHostLinkIntentOptions,
  acceptExpired: boolean,
): Promise<AppHostLinkIntentReadResult> {
  const raw = token?.trim() ?? "";
  if (!raw) return { ok: false, reason: "missing" };
  if (raw.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "invalid" };
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    return { ok: false, reason: "invalid" };
  }
  const [version, payload, signature] = parts;
  if (
    !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(signature)
  ) {
    return { ok: false, reason: "invalid" };
  }
  const validSignature = await hmacVerify(
    options.signingSecret ?? sessionSecret(),
    signingInput(`${version}.${payload}`),
    signature,
  ).catch(() => false);
  if (!validSignature) return { ok: false, reason: "invalid" };

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(b64uDecode(payload)));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!validIntentShape(value)) return { ok: false, reason: "invalid" };

  const now = options.now ?? Date.now();
  if (
    value.issuedAt > now + MAX_FUTURE_SKEW_MS ||
    value.expiresAt <= value.issuedAt ||
    value.expiresAt - value.issuedAt > MAX_TTL_MS
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (value.expiresAt <= now && !acceptExpired) {
    return { ok: false, reason: "expired" };
  }
  return {
    ok: true,
    value: { token: raw, intent: value },
  };
}

/**
 * Inspect only the signed, host-bound identity of an expired capability. This
 * never reactivates it or resolves the app; it lets a longer-running host DNS
 * claim discard the expired connection step without letting a forged,
 * selector-stage, or different-host token weaken the claim route.
 */
export async function inspectExpiredBoundAppHostLinkIntent(
  token: string | null | undefined,
  expectedHost: string,
  options: AppHostLinkIntentOptions = {},
): Promise<
  | {
    ok: true;
    value: { token: string; intent: BoundAppHostLinkIntent };
  }
  | { ok: false; reason: AppHostLinkIntentFailureReason }
> {
  const checked = await readSignedAppHostLinkIntent(token, options, true);
  if (!checked.ok) return checked;
  const now = options.now ?? Date.now();
  if (checked.value.intent.expiresAt > now) {
    return { ok: false, reason: "invalid" };
  }
  if (checked.value.intent.kind !== "bound") {
    return { ok: false, reason: "wrong_stage" };
  }
  const host = normalizeIntentHost(expectedHost);
  if (!host || host !== checked.value.intent.host) {
    return { ok: false, reason: "host_mismatch" };
  }
  return {
    ok: true,
    value: {
      token: checked.value.token,
      intent: checked.value.intent,
    },
  };
}

export async function resolveAppHostLinkSelectorIntent(
  token: string | null | undefined,
  currentDid: string,
  options: ResolveAppHostLinkIntentOptions = {},
): Promise<AppHostLinkIntentResolution<AppHostLinkSelectorIntent>> {
  const resolved = await resolveAppHostLinkIntent(token, options);
  if (!resolved.ok) return resolved;
  if (resolved.value.intent.kind !== "selector") {
    return { ok: false, reason: "wrong_stage" };
  }
  if (resolved.value.intent.appOwnerDid !== currentDid.trim()) {
    return { ok: false, reason: "account_mismatch" };
  }
  return {
    ok: true,
    value: resolved.value as ResolvedAppHostLinkIntent<
      AppHostLinkSelectorIntent
    >,
  };
}

export async function resolveBoundAppHostLinkIntent(
  token: string | null | undefined,
  expectedHost?: string | null,
  options: ResolveAppHostLinkIntentOptions = {},
): Promise<AppHostLinkIntentResolution<BoundAppHostLinkIntent>> {
  const resolved = await resolveAppHostLinkIntent(token, options);
  if (!resolved.ok) return resolved;
  if (resolved.value.intent.kind !== "bound") {
    return { ok: false, reason: "wrong_stage" };
  }
  if (expectedHost != null) {
    const host = normalizeIntentHost(expectedHost);
    if (!host || host !== resolved.value.intent.host) {
      return { ok: false, reason: "host_mismatch" };
    }
  }
  return {
    ok: true,
    value: resolved.value as ResolvedAppHostLinkIntent<BoundAppHostLinkIntent>,
  };
}

export function appHostLinkIntentErrorMessage(
  reason: AppHostLinkIntentFailureReason,
): string {
  if (reason === "expired") {
    return "This app-to-host setup link has expired. Return to app hosting and start the connection again.";
  }
  if (reason === "owner_changed") {
    return "The app owner changed after this host setup started. Return to app hosting and approve the connection again.";
  }
  if (reason === "app_unavailable") {
    return "The app listing is no longer available. Return to app hosting and start again.";
  }
  if (reason === "account_mismatch") {
    return "This host selector belongs to the app owner account that started it. Return to that account and choose the host before switching accounts.";
  }
  if (reason === "host_mismatch") {
    return "This app connection was approved for a different host. Return to app hosting and choose this host again.";
  }
  if (reason === "wrong_stage") {
    return "This app-to-host setup link is not ready for this step. Return to app hosting and choose the host again.";
  }
  return "This app-to-host setup link is invalid. Return to app hosting and start the connection again.";
}

function signingInput(tokenBody: string): string {
  return `atmosphere-account:app-host-link-intent\n${tokenBody}`;
}

async function resolveAppHostLinkIntent(
  token: string | null | undefined,
  options: ResolveAppHostLinkIntentOptions,
): Promise<AppHostLinkIntentResolution> {
  const checked = await readAppHostLinkIntent(token, options);
  if (!checked.ok) return checked;
  const app = await (options.loadApp ?? ((id) => getAppListingById(id)))(
    checked.value.intent.appListingId,
  ).catch(() => null);
  if (!app) return { ok: false, reason: "app_unavailable" };
  if (!userControlsAppListing(app, checked.value.intent.appOwnerDid)) {
    return { ok: false, reason: "owner_changed" };
  }
  return { ok: true, value: { ...checked.value, app } };
}

async function createIntentToken(
  input: {
    appListingId: string;
    relationship: AppHostLinkRelationship;
    appOwnerDid: string;
    kind: AppHostLinkIntent["kind"];
    host: string | null;
  },
  options: AppHostLinkIntentOptions,
): Promise<string> {
  const now = options.now ?? Date.now();
  const ttlMs = Math.min(
    Math.max(1, options.ttlMs ?? DEFAULT_TTL_MS),
    MAX_TTL_MS,
  );
  const base = {
    appListingId: input.appListingId.trim(),
    relationship: input.relationship,
    appOwnerDid: input.appOwnerDid.trim(),
    jti: (options.randomJti ?? (() => randomB64u(24)))(),
    issuedAt: now,
    expiresAt: now + ttlMs,
  };
  const intent: AppHostLinkIntent = input.kind === "bound"
    ? { ...base, kind: "bound", host: input.host ?? "" }
    : { ...base, kind: "selector", host: null };
  if (!validIntentShape(intent)) {
    throw new Error("Invalid app-host link intent input.");
  }
  const payload = b64uEncode(JSON.stringify(intent));
  const tokenBody = `${VERSION}.${payload}`;
  const signature = await hmacSign(
    options.signingSecret ?? sessionSecret(),
    signingInput(tokenBody),
  );
  return `${tokenBody}.${signature}`;
}

function validIntentShape(value: unknown): value is AppHostLinkIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const bindingIsValid = input.kind === "selector"
    ? input.host === null
    : input.kind === "bound" && typeof input.host === "string" &&
      normalizeIntentHost(input.host) === input.host;
  return bindingIsValid &&
    typeof input.appListingId === "string" &&
    input.appListingId.length > 0 && input.appListingId.length <= 512 &&
    (input.relationship === "same_product" ||
      input.relationship === "same_operator") &&
    typeof input.appOwnerDid === "string" &&
    /^did:[a-z0-9]+:[^\s]{1,500}$/i.test(input.appOwnerDid) &&
    typeof input.jti === "string" &&
    /^[A-Za-z0-9_-]{22,128}$/.test(input.jti) &&
    typeof input.issuedAt === "number" &&
    Number.isSafeInteger(input.issuedAt) &&
    typeof input.expiresAt === "number" &&
    Number.isSafeInteger(input.expiresAt);
}

function normalizeIntentHost(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (host.length < 3 || host.length > 253 || !host.includes(".")) return null;
  return host.split(".").every((label) =>
      label.length > 0 && label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
    ? host
    : null;
}
