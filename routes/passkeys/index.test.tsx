import { assertStringIncludes } from "jsr:@std/assert@1";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { signedOutPasskeySigninHref, SignedOutPasskeyState } from "./index.tsx";

Deno.test("signed-out passkey verification carries identity-only action context", () => {
  const html = renderToString(h(SignedOutPasskeyState, {
    initialHandle: "alice.example",
    returnTo: "/passkeys?handle=alice.example",
  }));
  assertStringIncludes(html, 'aria-haspopup="dialog"');
  assertStringIncludes(html, "Verify with account host");
  assertStringIncludes(
    html,
    'href="/signin?next=%2Fpasskeys%3Fhandle%3Dalice.example&amp;action=passkey_manage&amp;name=%40alice.example&amp;capability=identity&amp;handle=alice.example"',
  );
});

Deno.test("signed-out passkey verification keeps a complete no-JS fallback", () => {
  assertStringIncludes(
    signedOutPasskeySigninHref(undefined, "/passkeys"),
    "/signin?next=%2Fpasskeys&action=passkey_manage&capability=identity",
  );
});
