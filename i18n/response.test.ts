import {
  isLocalizedDocumentResponse,
  withLocaleResponseHeaders,
} from "./response.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("locale response metadata preserves existing cache variance", () => {
  const response = withLocaleResponseHeaders(
    new Response("ok", {
      headers: { vary: "Accept-Encoding, accept-language" },
    }),
    "en",
    true,
  );
  assertEquals(response.headers.get("content-language"), "en");
  assertEquals(
    response.headers.get("vary"),
    "Accept-Encoding, accept-language, Cookie",
  );
});

Deno.test("wildcard cache variance remains a wildcard", () => {
  const response = withLocaleResponseHeaders(
    new Response("ok", { headers: { vary: "*" } }),
    "en",
    true,
  );
  assertEquals(response.headers.get("vary"), "*");
});

Deno.test("single-locale responses do not reduce cacheability", () => {
  const response = withLocaleResponseHeaders(new Response("ok"), "en", false);
  assertEquals(response.headers.get("content-language"), "en");
  assertEquals(response.headers.get("vary"), null);
});

Deno.test("locale metadata preserves response status, body, and cookies", async () => {
  const headers = new Headers({ "content-type": "text/html" });
  headers.append("set-cookie", "session=one; Path=/; HttpOnly");
  headers.append("set-cookie", "locale=en; Path=/; Secure");
  const response = withLocaleResponseHeaders(
    new Response("<p>created</p>", {
      status: 201,
      statusText: "Created",
      headers,
    }),
    "en",
    false,
  );

  assertEquals(response.status, 201);
  assertEquals(response.statusText, "Created");
  assertEquals(await response.text(), "<p>created</p>");
  assertEquals(response.headers.getSetCookie().length, 2);
  assertEquals(
    response.headers.getSetCookie()[0],
    "session=one; Path=/; HttpOnly",
  );
  assertEquals(response.headers.getSetCookie()[1], "locale=en; Path=/; Secure");
});

Deno.test("language metadata is limited to localized documents", () => {
  assertEquals(
    isLocalizedDocumentResponse(
      new Response("<html></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    ),
    true,
  );
  assertEquals(
    isLocalizedDocumentResponse(
      Response.json({ error: "machine-readable response" }),
    ),
    false,
  );
});
