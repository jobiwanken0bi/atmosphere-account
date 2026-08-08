import { assertEquals } from "jsr:@std/assert@1";
import {
  passkeyManagementFailure,
  passkeyManagementReauthorization,
  passkeyMutationSucceeded,
  passkeyReconfirmationHref,
} from "./PasskeyManager.tsx";

Deno.test("passkey reconfirmation stays contextual and locked to its account", () => {
  const authorization = passkeyManagementReauthorization(
    "alice.example",
    "/passkeys?handle=alice.example",
  );

  assertEquals(authorization?.action, "passkey_manage");
  assertEquals(authorization?.capabilities, ["identity"]);
  assertEquals(authorization?.targetName, "alice.example");
  assertEquals(authorization?.returnTo, "/passkeys?handle=alice.example");
  const fallback = new URL(
    authorization?.fallbackHref ?? "",
    "https://atmosphere.invalid",
  );
  assertEquals(fallback.pathname, "/signin");
  assertEquals(fallback.searchParams.get("permission"), "required");
});

Deno.test("passkey no-JS recovery ignores an untrusted API URL", () => {
  const href = passkeyReconfirmationHref(
    "https://evil.example/steal",
    "did:plc:alice",
    "alice.example",
    "/passkeys?handle=alice.example",
  );
  const url = new URL(href, "https://atmosphere.invalid");

  assertEquals(url.pathname, "/oauth/login");
  assertEquals(url.searchParams.get("handle"), "did:plc:alice");
  assertEquals(url.searchParams.get("name"), "alice.example");
  assertEquals(url.searchParams.get("action"), "passkey_manage");
  assertEquals(url.searchParams.getAll("capability"), ["identity"]);
});

Deno.test("an origin failure is not presented as expired permission", () => {
  assertEquals(passkeyManagementFailure(403, null), {
    message: "Passkeys are not available on this account address.",
    needsReconfirmation: false,
    recoveryUrl: null,
  });
  assertEquals(
    passkeyManagementFailure(403, "/oauth/login?handle=alice.example")
      .needsReconfirmation,
    true,
  );
});

Deno.test("passkey removal does not trust a malformed success body", () => {
  assertEquals(passkeyMutationSucceeded({ ok: true }), true);
  assertEquals(passkeyMutationSucceeded({}), false);
});
