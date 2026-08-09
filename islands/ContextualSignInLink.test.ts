import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { isPlainPrimaryActivation } from "./ContextualSignInLink.tsx";
import { ContextualSignInDialogCard } from "./ContextualSignInDialog.tsx";

function activation(overrides: Partial<{
  button: number;
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}> = {}) {
  return {
    button: 0,
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

Deno.test("contextual dialog keeps modified and non-primary link activations native", () => {
  assertEquals(isPlainPrimaryActivation(activation()), true);
  assertEquals(isPlainPrimaryActivation(activation({ metaKey: true })), false);
  assertEquals(isPlainPrimaryActivation(activation({ ctrlKey: true })), false);
  assertEquals(isPlainPrimaryActivation(activation({ shiftKey: true })), false);
  assertEquals(isPlainPrimaryActivation(activation({ altKey: true })), false);
  assertEquals(isPlainPrimaryActivation(activation({ button: 1 })), false);
  assertEquals(
    isPlainPrimaryActivation(activation({ defaultPrevented: true })),
    false,
  );
});

Deno.test("contextual auth dialog has branded icon, top close, and no bottom cancel", () => {
  const html = renderToString(h(ContextualSignInDialogCard, {
    fallbackHref: "/signin",
    bodyOverride: "Choose the account that will publish this review.",
    onClose: () => {},
    returnTo: "/apps/tangled?review=compose",
    action: "review",
    capabilities: ["review"],
    targetName: "Tangled",
  }));

  assertStringIncludes(html, 'src="/union.svg');
  assertStringIncludes(html, "Login with Atmosphere");
  assertStringIncludes(html, 'aria-label="Close Login with Atmosphere"');
  assertStringIncludes(html, 'role="dialog"');
  assertStringIncludes(html, 'class="auth-dialog-close"');
  assertStringIncludes(
    html,
    '<button type="submit" class="signin-form-submit">Continue</button>',
  );
  assertEquals(html.includes(">Cancel<"), false);
  assertStringIncludes(html, "Create an Atmosphere account");
});

Deno.test("contextual auth close control keeps a 44px target", async () => {
  const css = await Deno.readTextFile(
    new URL("../static/styles.css", import.meta.url),
  );
  const closeRule = css.match(/\.auth-dialog-close\s*\{([^}]+)\}/)?.[1] ?? "";
  assertStringIncludes(closeRule, "width: 44px");
  assertStringIncludes(closeRule, "height: 44px");
});
