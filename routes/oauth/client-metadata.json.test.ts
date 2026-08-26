import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_OAUTH_SCOPE,
  OAUTH_CLIENT_METADATA_SCOPE,
  scopeForCapabilities,
  scopeTokens,
} from "../../lib/oauth-scopes.ts";
import { handler } from "./client-metadata.json.ts";

Deno.test("OAuth client metadata publishes the maximum, not a per-flow request", async () => {
  const url = new URL(
    "https://atmosphereaccount.com/oauth/client-metadata.json",
  );
  const req = new Request(url);
  const get = handler.GET!;
  const response = await get(
    { req, url } as unknown as Parameters<typeof get>[0],
  );
  const body = await response.json() as {
    client_id: string;
    client_uri: string;
    tos_uri: string;
    policy_uri: string;
    scope?: string;
  };

  assertEquals(
    new URL(body.client_uri).hostname,
    new URL(body.client_id).hostname,
  );
  assertEquals(body.scope, OAUTH_CLIENT_METADATA_SCOPE);
  assertNotEquals(body.scope, DEFAULT_OAUTH_SCOPE);
  assertNotEquals(body.scope, scopeForCapabilities(["review"]));
  assertEquals(body.tos_uri, "https://atmosphereaccount.com/terms");
  assertEquals(body.policy_uri, "https://atmosphereaccount.com/privacy");
  assertEquals(scopeTokens(body.scope).includes("blob:image/*"), true);
  assertEquals(
    scopeTokens(body.scope).includes(
      "repo:account.atmosphere.host.service",
    ),
    true,
  );
  assertEquals(
    scopeTokens(body.scope).includes(
      "repo:site.standard.publication?action=create&action=update",
    ),
    true,
  );
  assertEquals(
    scopeTokens(body.scope).includes(
      "repo:site.standard.document?action=create&action=update&action=delete",
    ),
    true,
  );
});
