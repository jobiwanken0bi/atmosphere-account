import { assertEquals } from "jsr:@std/assert@1";
import { LoginRequestError } from "../../../../lib/atmosphere-login.ts";
import { PasskeyError } from "../../../../lib/passkeys.ts";
import { RequestBodyTooLargeError } from "../../../../lib/security.ts";
import { publicPasskeyAuthenticationOptionsFailure } from "./options.ts";

const INTERNAL_ERROR =
  "postgresql://operator:secret@passkeys.internal/db authentication failure";

Deno.test("passkey authentication options hide request and service errors", () => {
  const forbidden = publicPasskeyAuthenticationOptionsFailure(
    new LoginRequestError(INTERNAL_ERROR, 403),
  );
  assertEquals(forbidden, {
    status: 403,
    body: {
      error: "This app cannot use this sign-in request.",
      code: "login_request_not_allowed",
      retryable: false,
    },
  });

  for (
    const error of [
      new Error(INTERNAL_ERROR),
      new PasskeyError("ceremony_conflict", INTERNAL_ERROR),
    ]
  ) {
    const failure = publicPasskeyAuthenticationOptionsFailure(error);
    assertEquals(failure.status, 503);
    assertEquals(failure.body.code, "passkey_service_unavailable");
    assertEquals(failure.body.retryable, true);
    assertEquals(JSON.stringify(failure).includes(INTERNAL_ERROR), false);
  }

  assertEquals(
    publicPasskeyAuthenticationOptionsFailure(
      new RequestBodyTooLargeError(),
    ).status,
    413,
  );
});
