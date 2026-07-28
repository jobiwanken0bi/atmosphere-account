import { assertEquals } from "jsr:@std/assert@1";
import { PasskeyError } from "../../../../lib/passkeys.ts";
import { publicPasskeyAuthenticationFailure } from "./verify.ts";

Deno.test("passkey assertion failures do not reveal credential membership", () => {
  const missing = publicPasskeyAuthenticationFailure(
    new PasskeyError("credential_not_found", "Passkey is unavailable."),
  );
  const invalid = publicPasskeyAuthenticationFailure(
    new PasskeyError("verification_failed", "Signature failed."),
  );
  assertEquals(missing, invalid);
  assertEquals(missing, {
    status: 401,
    message: "Passkey verification was not accepted.",
  });
});
