import { define } from "../../utils.ts";
import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
} from "../../i18n/mod.ts";
import { IS_DEV } from "../../lib/env.ts";
import {
  isSafeRelativePath,
  readFormDataRequestWithLimit,
  RequestBodyTooLargeError,
} from "../../lib/security.ts";

const MAX_LOCALE_FORM_BYTES = 2_048;

/**
 * Persist a locale choice as a cookie and bounce the user back to where
 * they came from. This is a POST because changing a preference must not be
 * triggerable by a cross-site image or link.
 *
 * Form fields:
 *   - `to`: target locale tag. Must be a supported locale.
 *   - `return`: relative path to redirect back to (defaults to `/`).
 */
async function handle(ctx: { url: URL; req: Request }): Promise<Response> {
  let form: FormData | null;
  try {
    form = await readFormDataRequestWithLimit(ctx.req, MAX_LOCALE_FORM_BYTES);
  } catch (error) {
    return new Response("Invalid locale request", {
      status: error instanceof RequestBodyTooLargeError ? 413 : 400,
    });
  }
  if (!form || form.getAll("to").length !== 1) {
    return new Response("Invalid locale request", { status: 400 });
  }
  const toValue = form.get("to");
  const to = typeof toValue === "string" ? toValue : null;
  if (!isLocale(to)) {
    return new Response("Unsupported locale", { status: 400 });
  }

  if (form.getAll("return").length > 1) {
    return new Response("Invalid locale request", { status: 400 });
  }
  const returnValue = form.get("return");
  const requested = typeof returnValue === "string" ? returnValue : "/";
  const safeReturn = isSafeRedirect(requested) ? requested : "/";

  const headers = new Headers({
    "cache-control": "no-store",
    location: safeReturn,
    "set-cookie":
      `${LOCALE_COOKIE}=${to}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${
        IS_DEV ? "" : "; Secure"
      }`,
  });
  return new Response(null, { status: 303, headers });
}

/** Only allow same-origin relative paths to avoid open-redirects. */
function isSafeRedirect(value: string): boolean {
  return isSafeRelativePath(value);
}

export function handleLocaleRequestForTest(
  req: Request,
  url = new URL(req.url),
): Promise<Response> {
  return handle({ req, url });
}

export const handler = define.handlers({
  POST: handle,
});
