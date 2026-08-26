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
  pageMeta: Record<string, unknown> = {},
): string {
  const ctx = {
    Component: () => <main>Page</main>,
    state: {
      locale: "en",
      pageMeta,
      user: signedIn ? { did: "did:plc:test", handle: "test.example" } : null,
      rememberedAccounts: remembered
        ? [{ did: "did:plc:remembered", handle: "remembered.example" }]
        : [],
    },
    url: new URL(pathname, "https://atmosphereaccount.com"),
  };
  return renderToString(h(App, ctx as never));
}

Deno.test("app shell uses page-specific preview titles and descriptions", () => {
  const html = renderAppShell("/apps", false, false, {
    title: "Apps",
    description: "Discover apps and services in the Atmosphere.",
  });

  assertIncludes(html, "<title>Apps</title>");
  assertIncludes(html, 'property="og:title" content="Apps"');
  assertIncludes(
    html,
    'name="twitter:description" content="Discover apps and services in the Atmosphere."',
  );
  assertIncludes(html, 'property="og:image:type" content="image/png"');
});

Deno.test("app shell emits a Standard.site document verification backlink", () => {
  const uri = "at://did:plc:product/site.standard.document/3m4standardxx";
  const html = renderAppShell(
    "/apps/grain?update=3m4standardxx",
    false,
    false,
    {
      standardSiteDocumentUri: uri,
    },
  );

  assertIncludes(
    html,
    `rel="site.standard.document" href="${uri}"`,
  );
  assertOmits(renderAppShell("/apps/grain"), "site.standard.document");
});

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
