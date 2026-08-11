import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import AccountMenu, { RememberedAccountChooser } from "./AccountMenu.tsx";

Deno.test("account dropdown uses native disclosure keyboard semantics", () => {
  const html = renderToString(h(AccountMenu, {
    user: { did: "did:plc:alice", handle: "alice.example" },
    rememberedAccounts: [],
  }));

  assertStringIncludes(html, 'aria-expanded="false"');
  assertStringIncludes(html, 'aria-controls="account-menu-popup-');
  assertStringIncludes(html, 'aria-haspopup="dialog"');
});

Deno.test("account dropdown does not claim unsupported menu semantics", async () => {
  const source = await Deno.readTextFile(
    new URL("./AccountMenu.tsx", import.meta.url),
  );
  assertEquals(source.includes('role="menu"'), false);
  assertEquals(source.includes('role="menuitem"'), false);
  assertEquals(source.includes('role="dialog"'), true);
  assertStringIncludes(
    source,
    "clearPendingBrowserActionsForOtherOwners(user.did)",
  );
});

Deno.test("one remembered account offers one-click continuation and separate options", () => {
  const html = renderToString(h(AccountMenu, {
    user: null,
    rememberedAccounts: [{
      did: "did:plc:alice",
      handle: "alice.example",
    }],
  }));

  assertStringIncludes(html, 'method="POST" action="/oauth/switch"');
  assertStringIncludes(html, 'name="did" value="did:plc:alice"');
  assertStringIncludes(html, 'data-login-handoff-next-current="true"');
  assertStringIncludes(html, 'data-login-handoff-replace="true"');
  assertStringIncludes(html, "Continue as @alice.example");
  assertStringIncludes(html, 'aria-label="Account options"');
  assertStringIncludes(html, 'aria-expanded="false"');
  assertEquals(html.includes("Login with Atmosphere"), false);
});

Deno.test("multiple remembered accounts open a neutral account chooser", () => {
  const html = renderToString(h(AccountMenu, {
    user: null,
    rememberedAccounts: [
      { did: "did:plc:alice", handle: "alice.example" },
      { did: "did:plc:bob", handle: "bob.example" },
    ],
  }));

  assertStringIncludes(html, "Choose account");
  assertStringIncludes(html, 'class="account-menu-saved-count"');
  assertStringIncludes(html, 'aria-label="Choose from 2 saved accounts"');
  assertEquals(html.includes('action="/oauth/switch"'), false);
  assertEquals(html.includes("alice.example"), false);
  assertEquals(html.includes("bob.example"), false);
});

Deno.test("remembered account chooser labels continuation and another-account paths", () => {
  const html = renderToString(h(RememberedAccountChooser, {
    rememberedAccounts: [
      { did: "did:plc:alice", handle: "alice.example" },
      { did: "did:plc:bob", handle: "bob.example" },
    ],
  }));

  assertStringIncludes(html, "Choose account");
  assertStringIncludes(
    html,
    "You’re signed out. Continue with an account saved on this device.",
  );
  assertStringIncludes(html, "Saved accounts");
  assertStringIncludes(html, "alice.example");
  assertStringIncludes(html, "bob.example");
  assertStringIncludes(html, 'aria-label="Continue as @alice.example"');
  assertStringIncludes(html, 'aria-label="Continue as @bob.example"');
  assertEquals(
    html.match(/data-login-handoff-next-current="true"/g)?.length,
    2,
  );
  assertEquals(
    html.match(/data-login-handoff-replace="true"/g)?.length,
    2,
  );
  assertEquals(html.match(/>Continue<\/span>/g)?.length, 2);
  assertStringIncludes(html, 'href="/oauth/add-account"');
  assertStringIncludes(html, "Use another account");
  assertEquals(html.includes('href="/signin"'), false);
});

Deno.test("remembered account controls retain mobile-safe target sizing", async () => {
  const css = await Deno.readTextFile(
    new URL("../static/styles.css", import.meta.url),
  );

  assertStringIncludes(css, ".account-menu-options-trigger {");
  assertStringIncludes(css, "min-width: 2.75rem;");
  assertStringIncludes(css, "min-height: 2.75rem;");
  assertStringIncludes(css, "max-width: calc(100vw - 1.2rem);");
  assertStringIncludes(
    css,
    ".account-menu-quick-form [data-login-handoff-error]",
  );
});
