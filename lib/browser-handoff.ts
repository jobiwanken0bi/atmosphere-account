export function wantsBrowserHandoffJson(req: Request): boolean {
  return req.headers.get("x-atmosphere-login") === "1" ||
    (req.headers.get("accept") ?? "").includes("application/json");
}

export function browserHandoffResponse(
  redirectUrl: string,
  options: { json: boolean; headers?: HeadersInit },
): Response {
  const headers = new Headers(options.headers);
  headers.set("cache-control", "no-store");
  if (options.json) {
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(JSON.stringify({ redirectUrl }), {
      status: 200,
      headers,
    });
  }
  headers.set("location", redirectUrl);
  return new Response(null, { status: 303, headers });
}

export function browserHandoffError(
  message: string,
  status: number,
  json: boolean,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set(
    "content-type",
    json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
  );
  return new Response(json ? JSON.stringify({ error: message }) : message, {
    status,
    headers: responseHeaders,
  });
}
