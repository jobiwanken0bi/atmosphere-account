import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  passkeyRelyingPartyForRequest,
  passkeyRelyingPartyForTest,
  productionPasskeyRpIdForTest,
} from "./passkey-rp.ts";
import { loginOrigin } from "./env.ts";
import {
  createProxyClientKey,
  PROXY_CLIENT_KEY_HEADER,
} from "./proxy-client-key.ts";

Deno.test("passkey RP accepts its exact host and controlled subdomains", () => {
  assertEquals(
    passkeyRelyingPartyForTest(
      "https://login.atmosphereaccount.com",
      "login.atmosphereaccount.com",
    ).id,
    "login.atmosphereaccount.com",
  );
  assertEquals(
    passkeyRelyingPartyForTest(
      "https://auth.login.atmosphereaccount.com",
      "login.atmosphereaccount.com",
    ).id,
    "login.atmosphereaccount.com",
  );
});

Deno.test("passkey RP rejects sibling and lookalike hosts", () => {
  assertThrows(() =>
    passkeyRelyingPartyForTest(
      "https://evil.atmosphereaccount.com",
      "login.atmosphereaccount.com",
    )
  );
  assertThrows(() =>
    passkeyRelyingPartyForTest(
      "https://login.atmosphereaccount.com.evil.example",
      "login.atmosphereaccount.com",
    )
  );
});

Deno.test("production passkeys cannot widen the dedicated login RP", () => {
  const origin = "https://login.atmosphereaccount.com";
  assertEquals(
    productionPasskeyRpIdForTest(origin),
    "login.atmosphereaccount.com",
  );
  assertEquals(
    productionPasskeyRpIdForTest(origin, "login.atmosphereaccount.com"),
    "login.atmosphereaccount.com",
  );
  assertThrows(() =>
    productionPasskeyRpIdForTest(origin, "atmosphereaccount.com")
  );
  assertThrows(() =>
    productionPasskeyRpIdForTest(origin, "evil.atmosphereaccount.com")
  );
});

Deno.test("appview forwarding needs an edge-signed caller key for passkey origins", async () => {
  const appviewUrl = new URL(
    "https://appview.example/api/login/passkeys/options",
  );
  const forwardedOrigin = loginOrigin();
  const unsigned = new Headers({
    "x-atmosphere-public-origin": forwardedOrigin,
  });
  await assertRejects(() =>
    passkeyRelyingPartyForRequest(appviewUrl, unsigned)
  );

  const signed = new Headers(unsigned);
  signed.set(
    PROXY_CLIENT_KEY_HEADER,
    await createProxyClientKey(
      new Headers({ "x-forwarded-for": "203.0.113.10" }),
    ),
  );
  assertEquals(
    (await passkeyRelyingPartyForRequest(appviewUrl, signed)).origin,
    forwardedOrigin,
  );
});
