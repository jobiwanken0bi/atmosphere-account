import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import Nav from "./Nav.tsx";

Deno.test("anonymous navigation has public destinations and no sign-in control", () => {
  const html = renderToString(
    <Nav
      active="hosts"
      account={{
        user: null,
        rememberedAccounts: [{
          did: "did:plc:remembered",
          handle: "remembered.example",
        }],
      }}
    />,
  );

  assertStringIncludes(html, 'href="/hosts"');
  assertStringIncludes(html, 'href="/apps"');
  assertStringIncludes(
    html,
    'href="/hosts" class="nav-btn nav-btn-ghost" aria-current="page"',
  );
  assertEquals(html.includes('href="/docs"'), false);
  assertEquals(html.includes("nav-account"), false);
  assertEquals(html.includes('href="/signin"'), false);
});

Deno.test("authenticated navigation retains the account menu", () => {
  const html = renderToString(
    <Nav
      account={{
        user: { did: "did:plc:alice", handle: "alice.example" },
        rememberedAccounts: [],
      }}
    />,
  );

  assertStringIncludes(html, "nav-account");
  assertStringIncludes(html, "alice.example");
});
