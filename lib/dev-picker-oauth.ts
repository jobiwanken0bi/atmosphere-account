import { withDb } from "./db.ts";
import {
  type DevPickerAccount,
  devPickerAccountForIdentifier,
} from "./dev-picker-demo.ts";
import { IS_DEV } from "./env.ts";
import { generateEs256KeyPair } from "./jose.ts";
import type { OAuthAction } from "./oauth-action.ts";
import { type OAuthCapability, scopeForCapabilities } from "./oauth-scopes.ts";
import { peekSessionUser } from "./session.ts";

const DEV_PICKER_GRANT_TTL_MS = 12 * 60 * 60_000;

interface DevPickerGrantPolicyInput {
  isDev: boolean;
  enabled: string | undefined;
  backend: string | undefined;
  databaseUrl: string | undefined;
  action: OAuthAction | null;
}

/**
 * Synthetic picker identities have no public DID document or OAuth server.
 * Let the local host-claim lab exercise its post-authorization UI without
 * weakening or bypassing any hosted authorization path.
 */
export async function grantDevPickerHostClaimAuthorization(
  request: Request,
  input: {
    identifier: string;
    action: OAuthAction | null;
    capabilities: readonly OAuthCapability[];
  },
): Promise<DevPickerAccount | null> {
  if (
    !devPickerHostClaimGrantAllowed({
      isDev: IS_DEV,
      enabled: Deno.env.get("ATMOSPHERE_ENABLE_DEV_LOGIN"),
      backend: Deno.env.get("ATMOSPHERE_DB_BACKEND"),
      databaseUrl: Deno.env.get("TURSO_DATABASE_URL"),
      action: input.action,
    })
  ) return null;

  const account = devPickerAccountForIdentifier(input.identifier);
  if (!account) return null;
  const current = await peekSessionUser(request);
  if (!current || current.did !== account.did) return null;

  const now = Date.now();
  const expiresAt = now + DEV_PICKER_GRANT_TTL_MS;
  const dpop = await generateEs256KeyPair();
  const session = {
    did: account.did,
    handle: account.handle,
    // Deliberately empty: the DNS preview needs capability state, while any
    // operation that actually writes to a PDS must keep using a real account.
    pdsUrl: "",
    asIssuer: "https://dev-auth.invalid",
    accessToken: "dev-picker-host-claim-access",
    refreshToken: "dev-picker-host-claim-refresh",
    expiresAt,
    dpopPrivateJwk: dpop.privateJwk,
    dpopPublicJwk: dpop.publicJwk,
    identityCheckedAt: now,
    scope: scopeForCapabilities(input.capabilities),
  };
  await withDb(async (client) => {
    await client.execute({
      sql: `INSERT INTO oauth_session (did, value, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(did) DO UPDATE SET
          value = excluded.value,
          expires_at = excluded.expires_at`,
      args: [account.did, JSON.stringify(session), expiresAt],
    });
  });
  return account;
}

function devPickerHostClaimGrantAllowed(
  input: DevPickerGrantPolicyInput,
): boolean {
  return input.isDev && input.enabled === "1" &&
    input.backend?.trim().toLowerCase() === "turso" &&
    !!input.databaseUrl?.trim().startsWith("file:") &&
    (input.action === "host_claim" || input.action === "host_transfer");
}

export const devPickerHostClaimGrantAllowedForTest =
  devPickerHostClaimGrantAllowed;
