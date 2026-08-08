import { assertEquals } from "jsr:@std/assert@1";
import { PasskeyError } from "../../../../lib/passkeys.ts";
import { RequestBodyTooLargeError } from "../../../../lib/security.ts";
import { publicPasskeyRegistrationFailure } from "./verify.ts";

const INTERNAL_ERROR =
  "postgresql://operator:secret@passkeys.internal/db registration verify";

Deno.test("passkey registration verification exposes only stable failures", () => {
  const rejected = publicPasskeyRegistrationFailure(
    new PasskeyError("verification_failed", INTERNAL_ERROR),
  );
  assertEquals(rejected, {
    status: 400,
    body: {
      error: "Passkey enrollment is invalid or expired.",
      code: "passkey_verification_failed",
      retryable: false,
    },
  });

  const conflict = publicPasskeyRegistrationFailure(
    new PasskeyError("credential_conflict", INTERNAL_ERROR),
  );
  assertEquals(conflict.status, 409);
  assertEquals(conflict.body.code, "passkey_already_registered");
  assertEquals(JSON.stringify(conflict).includes(INTERNAL_ERROR), false);

  for (
    const error of [
      new Error(INTERNAL_ERROR),
      new PasskeyError("ceremony_conflict", INTERNAL_ERROR),
    ]
  ) {
    const failure = publicPasskeyRegistrationFailure(error);
    assertEquals(failure.status, 503);
    assertEquals(failure.body.code, "passkey_enrollment_unavailable");
    assertEquals(failure.body.retryable, true);
    assertEquals(JSON.stringify(failure).includes(INTERNAL_ERROR), false);
  }

  assertEquals(
    publicPasskeyRegistrationFailure(new RequestBodyTooLargeError()).status,
    413,
  );
});
