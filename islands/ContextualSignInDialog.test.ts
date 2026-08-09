import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import {
  contextualDialogTitle,
  ContextualSignInDialogCard,
} from "./ContextualSignInDialog.tsx";

Deno.test("contextual account dialogs distinguish sign-in from scope upgrades", () => {
  assertEquals(contextualDialogTitle(false), "Login with Atmosphere");
  assertEquals(contextualDialogTitle(true), "Additional permission required");
});

Deno.test("review and report dialogs share one branded account-creation path", () => {
  for (
    const authorization of [
      { action: "review" as const, capabilities: ["review"] as const },
      {
        action: "report_review" as const,
        capabilities: ["identity"] as const,
      },
    ]
  ) {
    const html = renderToString(h(ContextualSignInDialogCard, {
      fallbackHref: "/signin",
      returnTo: "/apps/tangled?review=compose",
      targetName: "Tangled",
      onClose: () => {},
      ...authorization,
    }));

    assertStringIncludes(
      html,
      'class="modal-card signin-modal-card auth-dialog-card"',
    );
    assertStringIncludes(html, 'class="auth-dialog-close"');
    assertStringIncludes(html, 'class="modal-title auth-brand-title"');
    assertStringIncludes(html, 'src="/union.svg');
    assertStringIncludes(html, 'aria-label="Close Login with Atmosphere"');
    assertEquals(
      html.split("Create an Atmosphere account").length - 1,
      1,
    );
    assertEquals(html.includes("Need an account?"), false);
    assertEquals(html.includes("signin-modal-account-link"), false);
  }
});

Deno.test("contextual dialog reuses the 44px branded close treatment", async () => {
  const css = await Deno.readTextFile(
    new URL("../static/styles.css", import.meta.url),
  );
  const closeRule = css.match(/\.auth-dialog-close\s*\{([^}]+)\}/)?.[1] ??
    "";
  assertStringIncludes(closeRule, "width: 44px");
  assertStringIncludes(closeRule, "height: 44px");
  assertStringIncludes(css, ".auth-brand-title {");
  assertEquals(css.includes(".modal-close-rail"), false);
  assertEquals(css.includes(".modal-close-button"), false);
});
