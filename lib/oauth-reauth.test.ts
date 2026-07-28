import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  oauthReauthenticationPromptForTest,
  OAuthReauthenticationUnsupportedError,
} from "./oauth.ts";

Deno.test("passkey management requests an advertised OAuth login prompt", () => {
  assertEquals(
    oauthReauthenticationPromptForTest(["none", "login", "consent"], true),
    "login",
  );
  assertEquals(
    oauthReauthenticationPromptForTest(undefined, false),
    undefined,
  );
});

Deno.test("passkey management rejects hosts without an OAuth login prompt", () => {
  assertThrows(
    () => oauthReauthenticationPromptForTest(["consent", "create"], true),
    OAuthReauthenticationUnsupportedError,
  );
  assertThrows(
    () => oauthReauthenticationPromptForTest(undefined, true),
    OAuthReauthenticationUnsupportedError,
  );
});
