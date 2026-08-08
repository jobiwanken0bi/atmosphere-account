import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { appRegistrationSigninHref as homeHref } from "./apps.tsx";
import { appRegistrationSigninHref as browseHref } from "./apps/all.tsx";

Deno.test("app registration carries project intent through every directory CTA", () => {
  for (const href of [homeHref(), browseHref()]) {
    const url = new URL(href, "https://atmosphere.invalid");
    assertEquals(url.pathname, "/signin");
    assertEquals(url.searchParams.get("next"), "/apps/manage?new=1");
    assertEquals(url.searchParams.get("intent"), "project");
    assertEquals(url.searchParams.get("action"), "app");
    assertEquals(url.searchParams.getAll("capability"), ["app"]);
  }
});
