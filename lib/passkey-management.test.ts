import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildPasskeyManagementCookie,
  isPasskeyManagementReturnTo,
  passkeyManagementTicketTtlMsForTest,
  readPasskeyManagementTicket,
} from "./passkey-management.ts";

Deno.test("passkey management ticket is signed, DID-bound, and expires", async () => {
  const now = Date.now();
  const did = "did:plc:passkeyaccount";
  const cookie = await buildPasskeyManagementCookie(did, now);
  const request = new Request("https://login.atmosphereaccount.com/passkeys", {
    headers: { cookie: cookie.split(";")[0] },
  });
  assertEquals((await readPasskeyManagementTicket(request, now))?.did, did);
  assertEquals(
    await readPasskeyManagementTicket(
      request,
      now + passkeyManagementTicketTtlMsForTest() + 1,
    ),
    null,
  );

  const value = cookie.split(";")[0];
  const signatureStart = value.lastIndexOf(".") + 1;
  const firstSignatureCharacter = value[signatureStart];
  const tampered = `${value.slice(0, signatureStart)}${
    firstSignatureCharacter === "A" ? "B" : "A"
  }${value.slice(signatureStart + 1)}`;
  assertEquals(
    await readPasskeyManagementTicket(
      new Request(request.url, { headers: { cookie: tampered } }),
      now,
    ),
    null,
  );
});

Deno.test("passkey management return path is narrowly matched", () => {
  assert(isPasskeyManagementReturnTo("/passkeys"));
  assert(isPasskeyManagementReturnTo("/passkeys?enroll=1"));
  assertEquals(isPasskeyManagementReturnTo("/passkeys/other"), false);
  assertEquals(isPasskeyManagementReturnTo("//evil.example/passkeys"), false);
  assertEquals(
    isPasskeyManagementReturnTo("https://evil.example/passkeys"),
    false,
  );
});
