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

function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

async function getLoginInput(
  req: Request,
  url: URL,
): Promise<{ handle: string | null; next: string | null }> {
  const fromQs = url.searchParams.get("handle");
  const nextFromQs = safeNext(url.searchParams.get("next"));
  if (fromQs) return { handle: fromQs.trim(), next: nextFromQs };
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null) as
      | { handle?: string; next?: string }
      | null;
    return {
      handle: body?.handle?.trim() ?? null,
      next: safeNext(body?.next ?? null),
    };
  }
  if (
    ct.includes("application/x-www-form-urlencoded") ||
    ct.includes("multipart/form-data")
  ) {
    const form = await req.formData().catch(() => null);
    if (!form) return { handle: null, next: nextFromQs };
    const v = form.get("handle");
    const next = form.get("next");
    return {
      handle: typeof v === "string" ? v.trim() : null,
      next: safeNext(typeof next === "string" ? next : null) ?? nextFromQs,
    };
  }
  return { handle: null, next: nextFromQs };
}

async function handle(ctx: { req: Request; url: URL }): Promise<Response> {
  if (!isOAuthConfigured()) {
    return new Response(
      "OAuth is not configured on this deployment. Run `deno task gen:oauth-key` and set OAUTH_PRIVATE_JWK + OAUTH_KID + OAUTH_PUBLIC_JWK.",
      { status: 503 },
    );
  }
  const { handle: handleStr, next: returnTo } = await getLoginInput(
    ctx.req,
    ctx.url,
  );
  if (!handleStr) {
    return new Response("missing handle", { status: 400 });
  }
  try {
    const { redirectUrl } = await startLogin(handleStr, returnTo);
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
