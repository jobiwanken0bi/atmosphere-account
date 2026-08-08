import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import {
  ContextualDialogHeading,
  contextualDialogTitle,
  shouldShowBlueskySignInHint,
} from "./ContextualSignInDialog.tsx";

Deno.test("contextual account dialogs distinguish sign-in from scope upgrades", () => {
  assertEquals(contextualDialogTitle(false), "Login with Atmosphere");
  assertEquals(contextualDialogTitle(true), "Additional permission required");
});

Deno.test("Login with Atmosphere heading includes the Atmosphere mark", () => {
  const branded = renderToString(h(ContextualDialogHeading, {
    title: "Login with Atmosphere",
    showBrandIcon: true,
  }));
  const permission = renderToString(h(ContextualDialogHeading, {
    title: "Additional permission required",
    showBrandIcon: false,
  }));

  assertStringIncludes(branded, 'src="/union.svg?');
  assertEquals(permission.includes('src="/union.svg?'), false);
});

Deno.test("Bluesky hint appears only when a personal account can be chosen or created", () => {
  assertEquals(
    shouldShowBlueskySignInHint("review", true, false, false),
    true,
  );
  assertEquals(
    shouldShowBlueskySignInHint("app", true, false, false),
    false,
  );
  assertEquals(
    shouldShowBlueskySignInHint("review", true, true, false),
    false,
  );
  assertEquals(
    shouldShowBlueskySignInHint("review", false, false, false),
    false,
  );
});
