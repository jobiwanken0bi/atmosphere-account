/**
 * Initiate the atproto OAuth flow. Accepts a handle (or DID) via either
 *   - GET ?handle=...   (no-JS form submit)
 *   - POST { handle }   (form-urlencoded body or JSON)
 *
 * Resolves the handle, runs PAR against the user's authorization server,
 * and 302s the browser to the consent screen.
 */
import { define } from "../../utils.ts";
import { isOAuthConfigured, startLogin } from "../../lib/oauth.ts";

async function getHandle(req: Request, url: URL): Promise<string | null> {
  const fromQs = url.searchParams.get("handle");
  if (fromQs) return fromQs.trim();
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null) as
      | { handle?: string }
      | null;
    return body?.handle?.trim() ?? null;
  }
  if (
    ct.includes("application/x-www-form-urlencoded") ||
    ct.includes("multipart/form-data")
  ) {
    const form = await req.formData().catch(() => null);
    if (!form) return null;
    const v = form.get("handle");
    return typeof v === "string" ? v.trim() : null;
  }
  return null;
}

async function handle(ctx: { req: Request; url: URL }): Promise<Response> {
  if (!isOAuthConfigured()) {
    return new Response(
      "OAuth is not configured on this deployment. Run `deno task gen:oauth-key` and set OAUTH_PRIVATE_JWK + OAUTH_KID + OAUTH_PUBLIC_JWK.",
      { status: 503 },
    );
  }
  const handleStr = await getHandle(ctx.req, ctx.url);
  if (!handleStr) {
    return new Response("missing handle", { status: 400 });
  }
  try {
    const { redirectUrl } = await startLogin(handleStr);
    return new Response(null, {
      status: 303,
      headers: { location: redirectUrl },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`login failed: ${message}`, { status: 400 });
  }
}

export const handler = define.handlers({ GET: handle, POST: handle });
