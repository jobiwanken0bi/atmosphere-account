import { assertEquals } from "jsr:@std/assert@1";
import { OAUTH_ACTIONS, type OAuthAction } from "../../lib/oauth-action.ts";
import {
  enforceDirectAccountCreationAction,
  oauthAccountCreationFailureResponse,
} from "./create.ts";

const ACCOUNT_CREATION_POLICY = {
  account: true,
  review: true,
  review_manage: false,
  legacy_review: true,
  legacy_review_manage: false,
  review_response: false,
  report_review: true,
  favorite: true,
  app: true,
  host_claim: false,
  host_manage: false,
  app_host: false,
  profile: true,
  developer: true,
  passkey_manage: false,
  relationship_confirm: false,
  admin: false,
} as const satisfies Record<OAuthAction, boolean>;

Deno.test("direct account creation enforces every action policy", async () => {
  for (const action of OAUTH_ACTIONS) {
    const result = enforceDirectAccountCreationAction(action);
    if (ACCOUNT_CREATION_POLICY[action]) {
      assertEquals(result, action, action);
      continue;
    }
    assertEquals(result instanceof Response, true, action);
    const response = result as Response;
    assertEquals(response.status, 400, action);
    assertEquals(
      await response.text(),
      "This action requires an existing account. Sign in instead.",
      action,
    );
  }
});

Deno.test("direct account creation normalizes a missing action to account", () => {
  assertEquals(enforceDirectAccountCreationAction(undefined), "account");
});

Deno.test("account-creation failures do not expose provider details", async () => {
  const response = oauthAccountCreationFailureResponse();
  const body = await response.text();
  assertEquals(response.status, 400);
  assertEquals(
    body,
    "Couldn’t create the account with this host. Choose another host or try again.",
  );
  assertEquals(body.includes("account creation failed"), false);
});
