import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import Nav from "./Nav.tsx";

Deno.test("anonymous navigation keeps the saved-account login control", () => {
  const html = renderToString(
    <Nav
      active="docs"
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
  assertStringIncludes(html, 'href="/docs"');
  assertStringIncludes(html, "nav-docs-link");
  assertStringIncludes(html, "nav-docs-icon");
  assertStringIncludes(html, 'aria-label="Docs"');
  assertStringIncludes(html, 'aria-current="page"');
  assertStringIncludes(html, "nav-account");
  assertStringIncludes(html, "account-menu-trigger--signed-out");
});

Deno.test("anonymous navigation without saved accounts keeps login available", () => {
  const html = renderToString(<Nav account={{ user: null }} />);

  assertStringIncludes(html, "nav-account");
  assertStringIncludes(html, 'href="/signin"');
  assertStringIncludes(html, "Login with Atmosphere");
  assertStringIncludes(html, "account-menu-login-label-compact");
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
      ".nav-docs-link",
      ".nav-docs-icon",
      ".nav-docs-label,",
      ".account-menu-login-label-full",
      ".account-menu-login-label-compact",
    ]
  ) {
    assertStringIncludes(css, fragment);
  }

  for (
    const account of [
      { user: null },
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
    assertStringIncludes(html, 'href="/docs"');
    assertStringIncludes(html, 'aria-label="Docs"');
    assertStringIncludes(html, "nav-account");
    assertEquals(html.includes("nav-docs-link"), true);
  }
});
