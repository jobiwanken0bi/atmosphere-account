import { handleLocaleRequestForTest } from "./locale.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("locale changes require a bounded POST form", async () => {
  const response = await handleLocaleRequestForTest(
    new Request("https://atmosphereaccount.com/api/locale", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "to=en&return=%2Fapps%3Fsort%3Dnew%23results",
    }),
  );

  assertEquals(response.status, 303);
  assertEquals(response.headers.get("location"), "/apps?sort=new#results");
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(
    response.headers.get("set-cookie")?.includes("HttpOnly"),
    true,
  );
});

Deno.test("locale changes reject ambiguous and oversized forms", async () => {
  const duplicate = await handleLocaleRequestForTest(
    new Request("https://atmosphereaccount.com/api/locale", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "to=en&to=en",
    }),
  );
  assertEquals(duplicate.status, 400);

  const oversized = await handleLocaleRequestForTest(
    new Request("https://atmosphereaccount.com/api/locale", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `to=en&return=/${"x".repeat(3_000)}`,
    }),
  );
  assertEquals(oversized.status, 413);
});

Deno.test("locale changes reject external return destinations", async () => {
  const response = await handleLocaleRequestForTest(
    new Request("https://atmosphereaccount.com/api/locale", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "to=en&return=https%3A%2F%2Fevil.example%2F",
    }),
  );
  assertEquals(response.headers.get("location"), "/");
});
