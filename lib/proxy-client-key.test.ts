import {
  callerRequestIdentity,
  createProxyClientKey,
  PROXY_CLIENT_KEY_HEADER,
  readProxyClientKey,
} from "./proxy-client-key.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

const options = {
  now: 1_700_000_000_000,
  identitySecret: "identity-secret",
  signingSecret: "signing-secret",
};

Deno.test("proxy client keys are opaque, signed, and stable for one caller", async () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.10" });
  const first = await createProxyClientKey(headers, options);
  const second = await createProxyClientKey(headers, options);
  assertEquals(first, second);
  assertEquals(first.includes("203.0.113.10"), false);

  const request = new Request("https://appview.example/account", {
    headers: { [PROXY_CLIENT_KEY_HEADER]: first },
  });
  const key = await readProxyClientKey(request, options);
  assertEquals(typeof key, "string");
  assertEquals(key?.length, 43);
  assertEquals(
    await callerRequestIdentity(request, options),
    `edge:${key}`,
  );
});

Deno.test("proxy client keys reject forgery, wrong secrets, and expiry", async () => {
  const token = await createProxyClientKey(
    new Headers({ "x-real-ip": "198.51.100.20" }),
    options,
  );
  const forged = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  const request = (value: string) =>
    new Request("https://appview.example/account", {
      headers: { [PROXY_CLIENT_KEY_HEADER]: value },
    });

  assertEquals(await readProxyClientKey(request(forged), options), null);
  assertEquals(
    await readProxyClientKey(request(token), {
      ...options,
      signingSecret: "other-secret",
    }),
    null,
  );
  assertEquals(
    await readProxyClientKey(request(token), {
      ...options,
      now: options.now + 121_000,
    }),
    null,
  );
});
