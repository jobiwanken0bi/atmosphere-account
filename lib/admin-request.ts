import {
  readFormDataRequestWithLimit,
  readJsonRequestWithLimit,
  RequestBodyTooLargeError,
} from "./security.ts";

export const MAX_ADMIN_JSON_BODY_BYTES = 64_000;
export const MAX_ADMIN_FORM_BODY_BYTES = 16_384;

type BoundedRequest<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

export async function readAdminJsonRequest(
  req: Request,
  maxBytes = MAX_ADMIN_JSON_BODY_BYTES,
): Promise<BoundedRequest<Record<string, unknown>>> {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return { ok: false, response: jsonError(415, "json_required") };
  }
  try {
    const value = await readJsonRequestWithLimit(req, maxBytes);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, response: jsonError(400, "invalid_body") };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (error) {
    return {
      ok: false,
      response: jsonError(
        error instanceof RequestBodyTooLargeError ? 413 : 400,
        error instanceof RequestBodyTooLargeError
          ? "request_body_too_large"
          : "invalid_body",
      ),
    };
  }
}

export async function readAdminFormRequest(
  req: Request,
  maxBytes = MAX_ADMIN_FORM_BODY_BYTES,
): Promise<BoundedRequest<FormData>> {
  try {
    const value = await readFormDataRequestWithLimit(req, maxBytes);
    return value
      ? { ok: true, value }
      : { ok: false, response: new Response("invalid form", { status: 400 }) };
  } catch (error) {
    return {
      ok: false,
      response: new Response(
        error instanceof RequestBodyTooLargeError
          ? "request body too large"
          : "invalid form",
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      ),
    };
  }
}

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
