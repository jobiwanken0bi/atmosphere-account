import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import Nav from "./Nav.tsx";

Deno.test("anonymous navigation shows only remembered accounts", () => {
  const html = renderToString(
    <Nav
      active="apps"
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
  assertStringIncludes(html, 'href="#main-content"');
  assertStringIncludes(html, "Skip to main content");
  assertStringIncludes(html, 'href="/apps"');
  assertEquals(html.includes('href="/docs"'), false);
  assertStringIncludes(html, 'aria-current="page"');
  assertStringIncludes(html, "nav-account");
  assertStringIncludes(html, "remembered.example");
  assertStringIncludes(html, "Continue as @remembered.example");
  assertStringIncludes(html, 'aria-label="Account options"');
  assertEquals(html.includes("Login with Atmosphere"), false);
  assertEquals(html.includes('href="/signin"'), false);
});

Deno.test("anonymous navigation without saved accounts has no login control", () => {
  const html = renderToString(<Nav account={{ user: null }} />);

  assertEquals(html.includes("nav-account"), false);
  assertStringIncludes(html, 'id="account-nav-slot"');
  assertStringIncludes(
    html,
    'data-account-state-url="/api/account/nav-state"',
  );
  assertEquals(html.includes('href="/signin"'), false);
  assertEquals(html.includes("Login with Atmosphere"), false);
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

Deno.test("narrow navigation keeps every state collision-free and accessible", async () => {
  const css = await Deno.readTextFile(
    new URL("../static/styles.css", import.meta.url),
  );
  for (
    const fragment of [
      "@media (max-width: 420px)",
      ".account-menu-trigger-label",
    ]
  ) {
    assertStringIncludes(css, fragment);
  }

  for (
    const account of [
      {
        user: null,
        rememberedAccounts: [{
          did: "did:plc:remembered",
          handle: "remembered.example",
        }],
      },
      {
        user: { did: "did:plc:alice", handle: "alice.example" },
        rememberedAccounts: [],
      },
    ]
  ) {
    const html = renderToString(<Nav account={account} />);
    assertStringIncludes(html, 'href="/hosts"');
    assertStringIncludes(html, 'href="/apps"');
    assertEquals(html.includes('href="/docs"'), false);
    assertStringIncludes(html, "nav-account");
  }

  const firstVisitHtml = renderToString(<Nav account={{ user: null }} />);
  assertEquals(firstVisitHtml.includes("nav-account"), false);
});
