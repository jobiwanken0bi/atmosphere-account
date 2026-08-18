import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getAppPublicMetadata,
  scopeDescription,
} from "./app-public-metadata.ts";

function response(body: unknown, status = 200): Response {
  const responseBody = status === 204
    ? null
    : typeof body === "string"
    ? body
    : JSON.stringify(body);
  return new Response(responseBody, {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.test("app public metadata reads legal links and OAuth scopes", async () => {
  const calls: Array<[string, string]> = [];
  const publicFetch: typeof fetch = (input, init) => {
    const url = String(input);
    calls.push([url, init?.method ?? "GET"]);
    if (url.endsWith("/oauth-client-metadata.json")) {
      return Promise.resolve(response({
        client_id: url,
        policy_uri: "https://legal.social/privacy",
        tos_uri: "https://legal.social/terms",
        scope: "atproto repo:example.post?action=create account:email",
      }));
    }
    return Promise.resolve(response("not found", 404));
  };

  const metadata = await getAppPublicMetadata({
    primaryUrl: "https://app.social",
    links: [],
  }, { publicFetch });

  assertEquals(metadata.privacyUrl, "https://legal.social/privacy");
  assertEquals(metadata.termsUrl, "https://legal.social/terms");
  assertEquals(metadata.scopes, [
    "atproto",
    "repo:example.post?action=create",
    "account:email",
  ]);
  assertEquals(
    calls.some(([url, method]) =>
      url === "https://app.social/privacy" && method === "HEAD"
    ),
    true,
  );
});

Deno.test("app public metadata falls back to conventional legal pages", async () => {
  const publicFetch: typeof fetch = (input, init) => {
    const url = String(input);
    if (init?.method === "HEAD" && url.endsWith("/privacy")) {
      return Promise.resolve(response("", 204));
    }
    return Promise.resolve(response("not found", 404));
  };
  const metadata = await getAppPublicMetadata({
    primaryUrl: "https://app.social/product",
    links: [],
  }, { publicFetch });

  assertEquals(metadata.privacyUrl, "https://app.social/privacy");
  assertEquals(metadata.termsUrl, null);
  assertEquals(metadata.scopes, []);
});

Deno.test("explicit legal links win and private metadata targets are ignored", async () => {
  let calls = 0;
  const metadata = await getAppPublicMetadata({
    primaryUrl: "https://127.0.0.1/app",
    links: [
      {
        uri: "https://app.social/legal/privacy",
        label: "Privacy policy",
      },
      {
        uri: "https://app.social/legal/terms",
        role: "community.lexicon.app.defs#linkRoleTerms",
      },
    ],
  }, {
    publicFetch: () => {
      calls++;
      return Promise.resolve(response("not found", 404));
    },
  });

  assertEquals(metadata.privacyUrl, "https://app.social/legal/privacy");
  assertEquals(metadata.termsUrl, "https://app.social/legal/terms");
  assertEquals(calls, 0);
});

Deno.test("scope descriptions explain common permission shapes", () => {
  assertStringIncludes(
    scopeDescription("include:events.example.authFull"),
    "permission bundle",
  );
  assertStringIncludes(
    scopeDescription("repo:events.example.post?action=create"),
    "records",
  );
  assertStringIncludes(scopeDescription("transition:generic"), "legacy access");
});
