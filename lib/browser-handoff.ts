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

export function browserHandoffDocument(redirectUrl: string): Response {
  const href = escapeHtmlAttribute(redirectUrl);
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <meta name="referrer" content="no-referrer">
    <title>Continue with Atmosphere</title>
    <link rel="stylesheet" href="/styles.css">
    <script type="module" src="/login-handoff.js"></script>
  </head>
  <body>
    <main class="login-handoff-page">
      <img src="/union.svg" alt="" width="36" height="36">
      <p>Returning you to the app</p>
      <a data-login-handoff-target href="${href}">Continue</a>
    </main>
  </body>
</html>`,
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex, nofollow",
      },
    },
  );
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

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
