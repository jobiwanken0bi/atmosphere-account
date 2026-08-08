import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import {
  flowMatchesBrowserBindingForTest,
  isAuthedPdsTargetForSessionForTest,
  normalizeDpopHtu,
  readOAuthServerJsonForTest,
} from "./oauth.ts";
import {
  buildOAuthFlowBindingCookie,
  clearOAuthFlowBindingCookie,
  readOAuthFlowBindingCookie,
} from "./oauth-flow-binding.ts";
import { sha256B64u } from "./jose.ts";

const STATE = "s".repeat(32);
const BINDING = "b".repeat(43);

Deno.test("OAuth flow cookies bind a state to exactly one browser secret", () => {
  const setCookie = buildOAuthFlowBindingCookie(STATE, BINDING);
  const cookiePair = setCookie.split(";", 1)[0];
  assertStringIncludes(setCookie, "Path=/");
  assertStringIncludes(setCookie, "HttpOnly");
  assertStringIncludes(setCookie, "SameSite=Lax");

  assertEquals(
    readOAuthFlowBindingCookie(
      new Request("https://atmosphereaccount.com/oauth/callback", {
        headers: { cookie: cookiePair },
      }),
      STATE,
    ),
    BINDING,
  );
  assertEquals(
    readOAuthFlowBindingCookie(
      new Request("https://atmosphereaccount.com/oauth/callback", {
        headers: { cookie: `${cookiePair}; ${cookiePair}` },
      }),
      STATE,
    ),
    null,
  );
  assertStringIncludes(clearOAuthFlowBindingCookie(STATE) ?? "", "Max-Age=0");
});

Deno.test("OAuth state accepts only its initiating browser binding", async () => {
  const hash = await sha256B64u(BINDING);
  assertEquals(
    await flowMatchesBrowserBindingForTest(hash, BINDING),
    true,
  );
  assertEquals(
    await flowMatchesBrowserBindingForTest(hash, "a".repeat(43)),
    false,
  );
  assertEquals(await flowMatchesBrowserBindingForTest(hash, undefined), false);
});

Deno.test("DPoP htu excludes query and fragment per RFC 9449", () => {
  assertEquals(
    normalizeDpopHtu(
      "https://pds.example/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Aalice#ignored",
    ),
    "https://pds.example/xrpc/com.atproto.repo.getRecord",
  );
});

Deno.test("authenticated PDS requests cannot send tokens to another origin", () => {
  assertEquals(
    isAuthedPdsTargetForSessionForTest(
      "https://pds.example",
      "https://pds.example/xrpc/com.atproto.repo.putRecord",
    ),
    true,
  );
  assertEquals(
    isAuthedPdsTargetForSessionForTest(
      "https://pds.example",
      "https://evil.example/collect",
    ),
    false,
  );
  assertEquals(
    isAuthedPdsTargetForSessionForTest(
      "https://pds.example",
      "https://pds.example.evil.test/collect",
    ),
    false,
  );
});

Deno.test("OAuth server JSON is media-type checked and stream bounded", async () => {
  assertEquals(
    await readOAuthServerJsonForTest(Response.json({ ok: true })),
    { ok: true },
  );
  await assertRejects(
    () =>
      readOAuthServerJsonForTest(
        new Response('{"ok":true}', {
          headers: { "content-type": "text/html" },
        }),
      ),
    Error,
    "non-JSON",
  );
  await assertRejects(
    () =>
      readOAuthServerJsonForTest(
        new Response(
          JSON.stringify({
            padding: "x".repeat(70_000),
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    Error,
    "too large",
  );
});
