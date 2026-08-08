import { assertEquals } from "jsr:@std/assert@1";
import { oauthRetryLocation } from "../routes/oauth/callback.ts";
import { passkeyAuthorizationUrl } from "./passkey-authorization.ts";

Deno.test("passkey management OAuth retains action, account, and identity context", () => {
  const url = new URL(
    passkeyAuthorizationUrl(
      "alice.example",
      "/passkeys?handle=alice.example",
    ),
    "https://atmosphereaccount.com",
  );
  assertEquals(url.pathname, "/oauth/login");
  assertEquals(url.searchParams.get("handle"), "alice.example");
  assertEquals(url.searchParams.get("next"), "/passkeys?handle=alice.example");
  assertEquals(url.searchParams.get("action"), "passkey_manage");
  assertEquals(url.searchParams.get("name"), "alice.example");
  assertEquals(url.searchParams.getAll("capability"), ["identity"]);
});

Deno.test("passkey relink keeps login-picker continuation without showing a DID", () => {
  const url = new URL(
    passkeyAuthorizationUrl(
      "did:plc:alice",
      "/login/select?client_id=https%3A%2F%2Fapp.example",
      { continuation: "login_selection" },
    ),
    "https://atmosphereaccount.com",
  );
  assertEquals(url.searchParams.get("action"), "passkey_manage");
  assertEquals(url.searchParams.get("name"), null);
  assertEquals(url.searchParams.get("continuation"), "login_selection");
  assertEquals(url.searchParams.getAll("capability"), ["identity"]);
});

Deno.test("passkey management pins a chosen account by DID but keeps handle copy", () => {
  const url = new URL(
    passkeyAuthorizationUrl(
      "did:plc:alice",
      "/passkeys?handle=alice.example",
      { targetName: "alice.example" },
    ),
    "https://atmosphereaccount.com",
  );
  assertEquals(url.searchParams.get("handle"), "did:plc:alice");
  assertEquals(url.searchParams.get("name"), "alice.example");
});

Deno.test("passkey provider denial returns with passkey-specific context", () => {
  const retry = new URL(
    oauthRetryLocation({
      next: "/passkeys?handle=alice.example",
      permission: "denied",
      capabilities: ["identity"],
      action: "passkey_manage",
      targetName: "alice.example",
      handle: "alice.example",
    }),
    "https://atmosphereaccount.com",
  );
  assertEquals(retry.pathname, "/signin");
  assertEquals(retry.searchParams.get("action"), "passkey_manage");
  assertEquals(retry.searchParams.get("name"), "alice.example");
  assertEquals(retry.searchParams.get("handle"), "alice.example");
  assertEquals(retry.searchParams.getAll("capability"), ["identity"]);
});
