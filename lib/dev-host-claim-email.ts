import {
  type HostContactEmailOptions,
  LOCAL_PREVIEW_CAPABILITY,
} from "./host-claim-email.ts";
import { IS_DEV } from "./env.ts";

export const DEV_HOST_CLAIM_EMAIL_HOSTS = {
  available: "email-claim-preview.atmosphereaccount.com",
  unavailable: "email-unavailable-preview.atmosphereaccount.com",
  recovery: "email-recovery-preview.atmosphereaccount.com",
} as const;

const DESCRIBE_SERVER_PATH = "/xrpc/com.atproto.server.describeServer";

/**
 * Inject deterministic describeServer responses only for the named local UX
 * fixtures. This is deliberately gated independently of the route so importing
 * it can never weaken production contact discovery or exact-origin checks.
 */
export function devHostClaimEmailOptions(
  host: string,
  overrides: {
    isDev?: boolean;
    enabled?: string | undefined;
    backend?: string | undefined;
    databaseUrl?: string | undefined;
  } = {},
): HostContactEmailOptions | undefined {
  const normalized = host.trim().toLowerCase();
  if (
    !(overrides.isDev ?? IS_DEV) ||
    (overrides.enabled ?? Deno.env.get("ATMOSPHERE_ENABLE_DEV_LOGIN")) !==
      "1" ||
    (overrides.backend ?? Deno.env.get("ATMOSPHERE_DB_BACKEND"))?.trim()
        .toLowerCase() !== "turso" ||
    !(overrides.databaseUrl ?? Deno.env.get("TURSO_DATABASE_URL"))?.trim()
      .startsWith("file:") ||
    !Object.values(DEV_HOST_CLAIM_EMAIL_HOSTS).includes(
      normalized as (typeof DEV_HOST_CLAIM_EMAIL_HOSTS)[
        keyof typeof DEV_HOST_CLAIM_EMAIL_HOSTS
      ],
    )
  ) return undefined;

  return {
    previewVerificationUrl: LOCAL_PREVIEW_CAPABILITY,
    fetchImpl: (input) => {
      const url = input instanceof Request
        ? new URL(input.url)
        : new URL(String(input));
      if (
        url.origin !== `https://${normalized}` ||
        url.pathname !== DESCRIBE_SERVER_PATH || url.search
      ) {
        return Promise.resolve(new Response("Not found", { status: 404 }));
      }
      const contact = normalized === DEV_HOST_CLAIM_EMAIL_HOSTS.unavailable
        ? undefined
        : { email: "host-operator@example.test" };
      return Promise.resolve(Response.json({
        did: `did:web:${normalized}`,
        availableUserDomains: [`.${normalized}`],
        ...(contact ? { contact } : {}),
      }, {
        headers: { "cache-control": "no-store" },
      }));
    },
  };
}
