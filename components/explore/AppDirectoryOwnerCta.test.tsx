import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import AppDirectoryOwnerCta from "./AppDirectoryOwnerCta.tsx";

const SIGNED_OUT_ACCOUNT = {
  user: null,
  hasManagedProfiles: false,
  accountType: null,
  avatarUrl: null,
  publicProfileHandle: null,
  accountHost: null,
  rememberedAccounts: [],
};

const SIGNED_IN_ACCOUNT = {
  ...SIGNED_OUT_ACCOUNT,
  user: { did: "did:plc:owner", handle: "app.example" },
  rememberedAccounts: [{
    did: "did:plc:owner",
    handle: "app.example",
  }],
};

const MANAGED_APP = {
  id: "app-one",
  name: "App One",
  atstoreListingUri: "at://did:plc:owner/fyi.atstore.listing.detail/3mexample",
};

Deno.test("signed-out directory visitors are offered contextual app registration", () => {
  const html = renderToString(
    <AppDirectoryOwnerCta
      account={SIGNED_OUT_ACCOUNT}
      appAuthorized={false}
      managedApp={null}
    />,
  );
  const href = firstHref(html);
  const url = new URL(href, "https://atmosphereaccount.com");

  assertEquals(url.pathname, "/signin");
  assertEquals(url.searchParams.get("next"), "/apps/manage?new=1");
  assertStringIncludes(html, "Register an app");
  assertStringIncludes(html, 'aria-haspopup="dialog"');
});

Deno.test("an authorized account without an app can register its app", () => {
  const html = renderToString(
    <AppDirectoryOwnerCta
      account={SIGNED_IN_ACCOUNT}
      appAuthorized
      managedApp={null}
    />,
  );

  assertEquals(firstHref(html), "/apps/manage?new=1");
  assertStringIncludes(html, "Register an app");
  assertEquals(html.includes("Manage your app"), false);
});

Deno.test("an account with an app is offered management instead of another registration", () => {
  const html = renderToString(
    <AppDirectoryOwnerCta
      account={SIGNED_IN_ACCOUNT}
      appAuthorized
      managedApp={MANAGED_APP}
    />,
  );

  assertEquals(firstHref(html), "/apps/manage?app=app-one");
  assertStringIncludes(html, "Manage your app");
  assertEquals(html.includes("Register an app"), false);
  assertEquals(html.includes('aria-haspopup="dialog"'), false);
});

Deno.test("management uses a contextual permission dialog when app access is missing", () => {
  const html = renderToString(
    <AppDirectoryOwnerCta
      account={SIGNED_IN_ACCOUNT}
      appAuthorized={false}
      managedApp={MANAGED_APP}
    />,
  );
  const href = firstHref(html);
  const url = new URL(href, "https://atmosphereaccount.com");

  assertEquals(url.pathname, "/signin");
  assertEquals(url.searchParams.get("next"), "/apps/manage?app=app-one");
  assertEquals(url.searchParams.get("name"), "App One");
  assertStringIncludes(html, "Manage your app");
  assertStringIncludes(html, 'aria-haspopup="dialog"');
  assertEquals(html.includes("Register an app"), false);
});

Deno.test("an unavailable ownership check never offers duplicate registration", () => {
  const html = renderToString(
    <AppDirectoryOwnerCta
      account={SIGNED_IN_ACCOUNT}
      appAuthorized
      managedApp={undefined}
    />,
  );

  assertEquals(firstHref(html), "/account/products");
  assertStringIncludes(html, "Manage listings");
  assertEquals(html.includes("Register an app"), false);
});

function firstHref(html: string): string {
  const href = html.match(/href="([^"]+)"/)?.[1];
  if (!href) throw new Error(`Expected an href in ${html}`);
  return href.replaceAll("&amp;", "&");
}
