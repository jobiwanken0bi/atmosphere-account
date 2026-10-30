import {
  readFormDataRequestWithLimit,
  RequestBodyTooLargeError,
} from "./security.ts";

const MAX_HOST_CLAIM_BODY_BYTES = 32_768;

function isHostClaimPath(pathname: string): boolean {
  return /^\/hosts\/[^/]+\/claim$/.test(pathname);
}

export function rejectLegacyHostClaimAction(
  action: string,
): Response | null {
  if (action !== "request_email" && action !== "verify_email") return null;
  return new Response(
    "Email verification is no longer accepted. Verify control with DNS instead.",
    {
      status: 410,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    },
  );
}

export function stripLegacyHostClaimToken(url: URL): Response | null {
  if (!url.searchParams.has("token")) return null;
  const clean = new URL(url);
  clean.searchParams.delete("token");
  clean.searchParams.set("legacy_email", "1");
  return new Response(null, {
    status: 303,
    headers: {
      location: `${clean.pathname}${clean.search}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

/** Enforce the DNS-only rollout before a host-claim request can cross the
 * edge proxy. Retired links and already-open email forms therefore stay
 * disabled while the AppView service is being upgraded. */
export async function legacyHostClaimEdgeResponse(
  url: URL,
  request: Request,
): Promise<Response | null> {
  if (!isHostClaimPath(url.pathname)) return null;
  if (request.method === "GET") return stripLegacyHostClaimToken(url);
  if (request.method !== "POST") return null;

  try {
    const form = await readFormDataRequestWithLimit(
      request.clone(),
      MAX_HOST_CLAIM_BODY_BYTES,
    );
    const action = form?.get("action");
    return rejectLegacyHostClaimAction(
      typeof action === "string" ? action.trim() : "",
    );
  } catch (error) {
    if (!(error instanceof RequestBodyTooLargeError)) return null;
    return new Response("request body too large", {
      status: 413,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
}
