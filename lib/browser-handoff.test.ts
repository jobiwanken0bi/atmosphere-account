import {
  browserHandoffDocument,
  browserHandoffError,
  browserHandoffResponse,
  wantsBrowserHandoffJson,
} from "./browser-handoff.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("browser handoff negotiates JSON without weakening native redirects", async () => {
  const jsonRequest = new Request("https://login.example/select", {
    headers: { accept: "application/json" },
  });
  assertEquals(wantsBrowserHandoffJson(jsonRequest), true);

  const json = browserHandoffResponse("https://app.example/callback", {
    json: true,
    headers: { "set-cookie": "session=one; Path=/; HttpOnly" },
  });
  assertEquals(json.status, 200);
  assertEquals(await json.json(), {
    redirectUrl: "https://app.example/callback",
  });
  assertEquals(json.headers.get("cache-control"), "no-store");
  assertEquals(json.headers.getSetCookie().length, 1);

  const native = browserHandoffResponse("/account", { json: false });
  assertEquals(native.status, 303);
  assertEquals(native.headers.get("location"), "/account");
});

Deno.test("browser handoff document keeps the callback in a safe link", async () => {
  const callback =
    "https://app.example/callback?state=one&selection_token=a%22b<c>";
  const response = browserHandoffDocument(callback);
  const html = await response.text();

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(response.headers.get("referrer-policy"), "no-referrer");
  assertEquals(html.includes('src="/login-handoff.js"'), true);
  assertEquals(
    html.includes(
      'href="https://app.example/callback?state=one&amp;selection_token=a%22b&lt;c&gt;"',
    ),
    true,
  );
});

Deno.test("browser handoff errors match the requested response mode", async () => {
  const json = browserHandoffError("try again", 429, true, {
    "retry-after": "30",
  });
  assertEquals(json.status, 429);
  assertEquals(await json.json(), { error: "try again" });
  assertEquals(json.headers.get("retry-after"), "30");

  const native = browserHandoffError("not available", 403, false);
  assertEquals(native.status, 403);
  assertEquals(await native.text(), "not available");
});
