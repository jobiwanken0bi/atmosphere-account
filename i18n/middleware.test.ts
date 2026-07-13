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

Deno.test("single-locale responses do not reduce cacheability", () => {
  const response = withLocaleResponseHeaders(new Response("ok"), "en", false);
  assertEquals(response.headers.get("content-language"), "en");
  assertEquals(response.headers.get("vary"), null);
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
