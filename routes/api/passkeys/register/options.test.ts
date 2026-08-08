import { assertEquals } from "jsr:@std/assert@1";
import { PasskeyError } from "../../../../lib/passkeys.ts";
import { RequestBodyTooLargeError } from "../../../../lib/security.ts";
import { publicPasskeyRegistrationOptionsFailure } from "./options.ts";

const INTERNAL_ERROR =
  "postgresql://operator:secret@passkeys.internal/db registration options";

Deno.test("passkey registration options expose only stable failures", () => {
  const invalid = publicPasskeyRegistrationOptionsFailure(
    new PasskeyError("invalid_input", INTERNAL_ERROR),
  );
  assertEquals(invalid, {
    status: 400,
    body: {
      error: "Passkey enrollment request is invalid.",
      code: "invalid_passkey_request",
      retryable: false,
    },
  });

  for (
    const error of [
      new Error(INTERNAL_ERROR),
      new PasskeyError("ceremony_conflict", INTERNAL_ERROR),
    ]
  ) {
    const failure = publicPasskeyRegistrationOptionsFailure(error);
    assertEquals(failure.status, 503);
    assertEquals(failure.body.code, "passkey_enrollment_unavailable");
    assertEquals(failure.body.retryable, true);
    assertEquals(JSON.stringify(failure).includes(INTERNAL_ERROR), false);
  }

  assertEquals(
    publicPasskeyRegistrationOptionsFailure(
      new RequestBodyTooLargeError(),
    ).status,
    413,
  );
});
