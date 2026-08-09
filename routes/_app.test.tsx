import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import App, { needsEagerSigninEnhancer } from "./_app.tsx";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertIncludes(value: string, expected: string): void {
  if (!value.includes(expected)) {
    throw new Error(`Expected rendered app shell to include ${expected}`);
  }
}

function assertOmits(value: string, expected: string): void {
  if (value.includes(expected)) {
    throw new Error(`Expected rendered app shell to omit ${expected}`);
  }
}

function renderAppShell(
  pathname: string,
  signedIn = false,
  remembered = false,
): string {
  const ctx = {
    Component: () => <main>Page</main>,
    state: {
      locale: "en",
      pageMeta: {},
      user: signedIn ? { did: "did:plc:test", handle: "test.example" } : null,
      rememberedAccounts: remembered
        ? [{ did: "did:plc:remembered", handle: "remembered.example" }]
        : [],
    },
    url: new URL(pathname, "https://atmosphereaccount.com"),
  };
  return renderToString(h(App, ctx as never));
}

Deno.test("global app eagerly loads sign-in enhancement only for initial forms", () => {
  for (
    const pathname of [
      "/signin",
      "/login/select",
      "/apps/create",
      "/apps/migrate-from-legacy",
      "/account",
    ]
  ) {
    assertEquals(needsEagerSigninEnhancer(pathname), true);
  }
  assertEquals(needsEagerSigninEnhancer("/account", true), false);

  for (
    const pathname of [
      "/",
      "/apps",
      "/apps/all",
      "/hosts",
      "/account/products",
      "/docs",
    ]
  ) {
    assertEquals(needsEagerSigninEnhancer(pathname), false);
  }
});

Deno.test("public app shell defers contextual sign-in modules", () => {
  const html = renderAppShell("/apps");

  assertOmits(html, "signin-preview-runtime");
  assertOmits(html, "login-handoff-runtime");
  assertIncludes(html, 'id="submit-once-runtime"');
  assertOmits(html, "fonts.googleapis.com");
  assertOmits(html, "fonts.gstatic.com");
  assertIncludes(html, 'src="/app-media-fallback.js?__frsh_c=');
});

Deno.test("app shell preserves eager sign-in and saved-account handoff", () => {
  const signinHtml = renderAppShell("/signin");
  assertIncludes(signinHtml, 'id="signin-preview-runtime"');
  assertIncludes(signinHtml, 'id="login-handoff-runtime"');

  const signedInDirectoryHtml = renderAppShell("/apps", true);
  assertOmits(signedInDirectoryHtml, "signin-preview-runtime");
  assertIncludes(signedInDirectoryHtml, 'id="login-handoff-runtime"');

  const signedInAccountHtml = renderAppShell("/account", true);
  assertOmits(signedInAccountHtml, "signin-preview-runtime");
  assertIncludes(signedInAccountHtml, 'id="login-handoff-runtime"');

  const rememberedDirectoryHtml = renderAppShell("/apps", false, true);
  assertOmits(rememberedDirectoryHtml, "signin-preview-runtime");
  assertIncludes(rememberedDirectoryHtml, 'id="login-handoff-runtime"');
});

Deno.test("global static assets carry Fresh immutable-cache locks", () => {
  const html = renderAppShell("/docs");
  for (
    const path of [
      "/styles.css",
      "/favicon.ico",
      "/union.svg",
      "/page-skeleton.js",
      "/submit-once.js",
      "/nav-scroll.js",
      "/docs.js",
      "/og-developer.png",
    ]
  ) {
    assertIncludes(html, `${path}?__frsh_c=`);
  }
});
