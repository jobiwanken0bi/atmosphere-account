import type {
  AtmosphereSelectionClaims,
  AtmosphereSelectionReplayStore,
  AtmosphereSelectionVerificationResult,
} from "./atmosphere-login-sdk.ts";
import { verifyAtmosphereSelectionToken } from "./atmosphere-login-sdk.ts";

export interface VerifyAtmosphereLoginCallbackOptions {
  url: string | URL;
  publicJwk: JsonWebKey;
  expectedIssuer: string;
  expectedClientId: string;
  expectedReturnUri: string;
  expectedState?: string | null;
  replayStore?: AtmosphereSelectionReplayStore;
}

export type AtmosphereLoginCallbackVerification =
  | {
    ok: true;
    claims: AtmosphereSelectionClaims;
    params: URLSearchParams;
  }
  | {
    ok: false;
    error: string;
    claims?: unknown;
    params: URLSearchParams;
  };

export async function verifyAtmosphereLoginCallback(
  options: VerifyAtmosphereLoginCallbackOptions,
): Promise<AtmosphereLoginCallbackVerification> {
  let url: URL;
  try {
    url = typeof options.url === "string"
      ? new URL(options.url)
      : new URL(options.url);
  } catch {
    return {
      ok: false,
      error: "invalid callback URL",
      params: new URLSearchParams(),
    };
  }
  const params = url.searchParams;
  const token = params.get("selection_token");
  const clientId = params.get("client_id");
  const state = params.get("state");
  if (!token) return { ok: false, error: "missing selection_token", params };
  if (clientId !== options.expectedClientId) {
    return { ok: false, error: "client_id parameter mismatch", params };
  }
  if (options.expectedState && state !== options.expectedState) {
    return { ok: false, error: "state parameter mismatch", params };
  }
  const expectedState = options.expectedState ?? state;
  if (!expectedState) {
    return { ok: false, error: "missing state", params };
  }

  const result: AtmosphereSelectionVerificationResult =
    await verifyAtmosphereSelectionToken({
      token,
      publicJwk: options.publicJwk,
      expectedIssuer: options.expectedIssuer,
      expectedAudience: options.expectedClientId,
      expectedState,
      expectedReturnUri: options.expectedReturnUri,
      replayStore: options.replayStore,
    });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      claims: result.claims,
      params,
    };
  }
  return { ok: true, claims: result.claims, params };
}
