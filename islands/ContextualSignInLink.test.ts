import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import ContextualSignInLink from "./ContextualSignInLink.tsx";

Deno.test("contextual sign-in keeps its complete no-JavaScript fallback", () => {
  const href =
    "/signin?next=%2Fapps%2Fmanage%3Fnew%3D1&action=app&name=your+app&intent=project&capability=app";
  const html = renderToString(h(ContextualSignInLink, {
    href,
    returnTo: "/apps/manage?new=1",
    action: "app",
    capabilities: ["app"],
    targetName: "your app",
    label: "Register an app",
    className: "directory-register-button",
    intent: "project",
  }));

  assertStringIncludes(html, `href="${href.replaceAll("&", "&amp;")}"`);
  assertStringIncludes(html, 'aria-haspopup="dialog"');
  assertEquals(html.includes('role="dialog"'), false);
  assertEquals(html.includes("Loading account chooser"), false);
});

Deno.test("contextual alternate-account links keep the add-account fallback", () => {
  const href =
    "/oauth/add-account?next=%2Fapps%2Fmanage%3Fnew%3D1&intent=project&action=app&name=a+different+app&capability=app";
  const html = renderToString(h(ContextualSignInLink, {
    href,
    returnTo: "/apps/manage?new=1",
    action: "app",
    capabilities: ["app"],
    targetName: "a different app",
    label: "Use another account",
    className: "profile-form-button-secondary",
    intent: "project",
    chooseAnotherAccount: true,
  }));

  assertStringIncludes(html, `href="${href.replaceAll("&", "&amp;")}"`);
  assertStringIncludes(html, "Use another account");
  assertStringIncludes(html, 'aria-haspopup="dialog"');
});
