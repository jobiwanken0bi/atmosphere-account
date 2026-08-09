import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import AccountMenu from "./AccountMenu.tsx";

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
