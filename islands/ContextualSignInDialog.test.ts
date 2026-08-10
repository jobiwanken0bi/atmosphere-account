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
    assertStringIncludes(
      html,
      '<button type="submit" class="signin-form-submit">Continue</button>',
    );
  }
});

Deno.test("contextual dialog preserves task-specific permission copy", () => {
  const html = renderToString(h(ContextualSignInDialogCard, {
    fallbackHref: "/signin",
    returnTo: "/apps/tangled?favorite=save",
    targetName: "Tangled",
    action: "favorite",
    capabilities: ["favorite"],
    bodyOverride:
      "Choose the account that will save this app. We’ll only request favorite access.",
    onClose: () => {},
  }));

  assertStringIncludes(
    html,
    "Choose the account that will save this app. We’ll only request favorite access.",
  );
  assertStringIncludes(
    html,
    '<button type="submit" class="signin-form-submit">Continue</button>',
  );
});

Deno.test("review login explains the action while keeping the shared product heading", () => {
  const html = renderToString(h(ContextualSignInDialogCard, {
    fallbackHref: "/signin",
    returnTo: "/apps/tangled?review=compose",
    targetName: "Tangled",
    action: "review",
    capabilities: ["review"],
    onClose: () => {},
  }));

  assertStringIncludes(html, "Login with Atmosphere");
  assertStringIncludes(
    html,
    "Login to write a review of Tangled",
  );
  assertEquals(html.includes("Choose the account that will publish it"), false);
  assertStringIncludes(
    html,
    '<button type="submit" class="signin-form-submit">Continue</button>',
  );
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
  const backdropRule = css.match(
    /\.contextual-signin-backdrop\s*\{([^}]+)\}/,
  )?.[1] ?? "";
  const cardRule = css.match(
    /\.contextual-signin-backdrop \.signin-modal-card\s*\{([^}]+)\}/,
  )?.[1] ?? "";
  assertStringIncludes(backdropRule, "overflow-y: auto");
  assertStringIncludes(cardRule, "overflow: visible");
  assertStringIncludes(cardRule, "max-height: none");
  assertEquals(css.includes(".modal-close-rail"), false);
  assertEquals(css.includes(".modal-close-button"), false);
});
