import { appviewReadinessForTest } from "./ready.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function fetchJson(body: unknown, init: ResponseInit = {}): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    )) as typeof fetch;
}

function fetchText(body: string, init: ResponseInit = {}): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(body, {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    )) as typeof fetch;
}

Deno.test("appview readiness is not ready when appview body says ok false", async () => {
  const result = await appviewReadinessForTest(
    "https://appview.example",
    fetchJson({
      ok: false,
      release: { runtime: "railway", gitSha: "abc1234" },
    }),
  );

  assertEquals(result.status, 503);
  assertEquals(result.body.ok, false);
  assertEquals((result.body.appview as Record<string, unknown>).ok, false);
});

Deno.test("appview readiness stays ready when transport and body are healthy", async () => {
  let redirect: RequestRedirect | undefined;
  const result = await appviewReadinessForTest(
    "https://appview.example",
    ((_input, init) => {
      redirect = init?.redirect;
      return fetchJson({
        ok: true,
        release: { runtime: "railway", gitSha: "abc1234" },
      })(_input, init);
    }) as typeof fetch,
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.ok, true);
  assertEquals((result.body.appview as Record<string, unknown>).ok, true);
  assertEquals(
    ((result.body.appview as Record<string, unknown>).release as Record<
      string,
      unknown
    >).gitSha,
    "abc1234",
  );
  assertEquals(redirect, "manual");
});

Deno.test("appview readiness rejects non-object JSON bodies", async () => {
  for (const body of [true, "ready", ["ok"]]) {
    const result = await appviewReadinessForTest(
      "https://appview.example",
      fetchJson(body),
    );

    assertEquals(result.status, 503);
    assertEquals(result.body.ok, false);
    assertEquals(result.body.error, "invalid_appview_readiness_response");
    assertEquals((result.body.appview as Record<string, unknown>).ok, false);
  }
});

Deno.test("appview readiness rejects invalid JSON bodies", async () => {
  const result = await appviewReadinessForTest(
    "https://appview.example",
    fetchText("not json"),
  );

  assertEquals(result.status, 503);
  assertEquals(result.body.ok, false);
  assertEquals(result.body.error, "invalid_appview_readiness_response");
  assertEquals((result.body.appview as Record<string, unknown>).ok, false);
});

Deno.test("appview readiness rejects unhealthy transport even with ok body", async () => {
  const result = await appviewReadinessForTest(
    "https://appview.example",
    fetchJson({ ok: true }, { status: 500 }),
  );

  assertEquals(result.status, 503);
  assertEquals(result.body.ok, true);
  assertEquals((result.body.appview as Record<string, unknown>).ok, false);
});

Deno.test("appview readiness rejects non-JSON and oversized responses", async () => {
  for (
    const response of [
      new Response('{"ok":true}', {
        headers: { "content-type": "text/html" },
      }),
      new Response(
        JSON.stringify({ ok: true, padding: "x".repeat(256 * 1024) }),
        { headers: { "content-type": "application/json" } },
      ),
      new Response(null, {
        status: 302,
        headers: {
          location: "http://127.0.0.1/private",
          "content-type": "application/json",
        },
      }),
    ]
  ) {
    const result = await appviewReadinessForTest(
      "https://appview.example",
      (() => Promise.resolve(response)) as typeof fetch,
    );
    assertEquals(result.status, 503);
    assertEquals((result.body.appview as Record<string, unknown>).ok, false);
  }
});
