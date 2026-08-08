import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isSkeletonPage, routeKind, templateFor } from "./page-skeleton.js";

const routeCases = [
  ["/", "home"],
  ["/apps", "apps-home"],
  ["/explore", "apps-home"],
  ["/apps/all", "apps-browse"],
  ["/apps/categories", "apps-categories"],
  ["/apps/manage", "form"],
  ["/account/products", "managed-products"],
  ["/apps/create", "form"],
  ["/apps/example.test", "app-detail"],
  ["/apps/example.test/manage/profile", "form"],
  ["/hosts", "hosts"],
  ["/hosts/example.test", "host-detail"],
  ["/hosts/example.test/claim", "form"],
  ["/hosts/example.test/manage/apps", "form"],
  ["/signin", "signin"],
  ["/account", "account"],
  ["/account/manage", "account-section"],
  ["/account/reviews", "account-section"],
  ["/account/developer/apps", "workspace-form"],
  ["/passkeys", "passkeys"],
  ["/login/select", "picker"],
  ["/developer-resources", "docs"],
  ["/docs/oauth", "docs"],
  ["/users/alice.test", "user"],
  ["/relationships/confirm", "form"],
  ["/admin", "managed-products"],
  ["/admin/reports", "managed-products"],
  ["/not-found", "default"],
] as const;

Deno.test("page skeleton module imports without a browser DOM", () => {
  assertEquals(typeof document, "undefined");
  assertEquals(routeKind("/apps"), "apps-home");
});

Deno.test("page skeleton maps current routes to matching layout families", () => {
  for (const [pathname, expected] of routeCases) {
    assertEquals(routeKind(pathname), expected, pathname);
  }
});

Deno.test("page skeleton only handles same-origin non-API navigation", () => {
  const origin = "https://account.example";
  assert(
    isSkeletonPage(new URL("https://account.example/apps"), origin),
  );
  assertFalse(
    isSkeletonPage(new URL("https://other.example/apps"), origin),
  );
  assertFalse(
    isSkeletonPage(new URL("https://account.example/api/hosts"), origin),
  );
});

Deno.test("route templates preserve the visible page geometry", () => {
  const home = templateFor("home");
  const homeTitleStart = home.indexOf("page-skeleton-home-title");
  const homeTitleEnd = home.indexOf("page-skeleton-copy-lines", homeTitleStart);
  const homeTitle = home.slice(homeTitleStart, homeTitleEnd);
  assertEquals(
    homeTitle.match(/page-skeleton-shape page-skeleton-line(?:\s|")/g)?.length,
    2,
  );

  const apps = templateFor("apps-home");
  assertStringIncludes(apps, "page-skeleton-spotlight-grid");
  assertStringIncludes(apps, "page-skeleton-promo-stack");
  assertStringIncludes(apps, "page-skeleton-category-grid");

  const browse = templateFor("apps-browse");
  assertEquals(
    browse.match(/page-skeleton-app-card/g)?.length,
    6,
  );

  const hosts = templateFor("hosts");
  assertEquals(
    hosts.match(/page-skeleton-host-card(?:\s|")/g)?.length,
    6,
  );

  const account = templateFor("account");
  assertStringIncludes(account, "page-skeleton-account-hero");
  assertStringIncludes(account, "page-skeleton-account-panels");
});

Deno.test("skeleton styles cover route layouts and responsive behavior", async () => {
  const stylesheet = await Deno.readTextFile(
    new URL("./styles.css", import.meta.url),
  );
  const start = stylesheet.indexOf(".page-skeleton {");
  const end = stylesheet.indexOf("\n.section {", start);
  assert(start >= 0 && end > start);
  const css = stylesheet.slice(start, end);

  for (
    const selector of [
      ".page-skeleton-stage--directory",
      ".page-skeleton-spotlight-grid",
      ".page-skeleton-app-grid",
      ".page-skeleton-host-grid",
      ".page-skeleton-profile-summary",
      ".page-skeleton-account-hero",
      ".page-skeleton-workspace-form-grid",
      ".page-skeleton-docs",
    ]
  ) {
    assertStringIncludes(css, selector);
  }

  assertStringIncludes(css, "@media (max-width: 940px)");
  assertStringIncludes(css, "@media (max-width: 760px)");
  assertStringIncludes(css, "@media (max-width: 640px)");
  assertStringIncludes(css, "@media (max-width: 520px)");
  assertStringIncludes(css, "@media (prefers-reduced-motion: reduce)");
  assertStringIncludes(
    css,
    ".page-skeleton--visible {\n  display: block;\n  pointer-events: auto;",
  );
  assertStringIncludes(css, ".page-skeleton-layout {\n    animation: none;");
  assertFalse(css.includes("page-skeleton-shimmer"));
  assertFalse(css.includes(".page-skeleton-main"));
  assertFalse(css.includes(".page-skeleton-block--"));
});

Deno.test("skeleton delay, safety timeout, and status semantics stay intact", async () => {
  const source = await Deno.readTextFile(
    new URL("./page-skeleton.js", import.meta.url),
  );
  assertStringIncludes(source, "const skeletonDelayMs = 220;");
  assertStringIncludes(source, "const skeletonSafetyMs = 12_000;");
  assertStringIncludes(
    source,
    "globalThis.setTimeout(hideSkeleton, skeletonSafetyMs)",
  );
  assertStringIncludes(source, 'skeleton.setAttribute("role", "status")');
  assertStringIncludes(source, 'skeleton.setAttribute("aria-live", "polite")');
  assertStringIncludes(source, 'aria-hidden="true"');
  assertStringIncludes(source, "Loading page…");
  assertStringIncludes(
    source,
    'document.body.setAttribute("aria-busy", "true")',
  );
  assertStringIncludes(source, 'document.body.removeAttribute("aria-busy")');
});
