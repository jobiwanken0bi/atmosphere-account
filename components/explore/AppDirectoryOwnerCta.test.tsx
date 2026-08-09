import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import AppDirectoryOwnerCta, {
  APP_REGISTRATION_SIGNIN_BODY,
} from "./AppDirectoryOwnerCta.tsx";

const ACCOUNT = {
  user: { did: "did:plc:owner", handle: "owner.example" },
  hasManagedAppProfile: false,
  hasManagedHostProfiles: false,
  hasManagedProfiles: false,
  accountType: "user" as const,
  avatarUrl: null,
  publicProfileHandle: null,
  accountHost: null,
  rememberedAccounts: [],
};

Deno.test("an existing app owner manages instead of registering another app", () => {
  const html = renderToString(
    <AppDirectoryOwnerCta
      account={{
        ...ACCOUNT,
        hasManagedAppProfile: true,
        hasManagedProfiles: true,
      }}
    />,
  );
  assertStringIncludes(html, 'href="/apps/manage"');
  assertStringIncludes(html, "Manage your app");
  assertEquals(html.includes("Register an app"), false);
  assertEquals(html.includes("?new=1"), false);
});

Deno.test("host-only and regular accounts may register their first app", () => {
  const hostHtml = renderToString(
    <AppDirectoryOwnerCta
      account={{
        ...ACCOUNT,
        hasManagedHostProfiles: true,
        hasManagedProfiles: true,
      }}
    />,
  );
  const regularHtml = renderToString(
    <AppDirectoryOwnerCta account={ACCOUNT} />,
  );
  assertStringIncludes(hostHtml, 'href="/apps/manage?new=1"');
  assertStringIncludes(regularHtml, 'href="/apps/manage?new=1"');
});

Deno.test("signed-out registration keeps contextual app authorization", () => {
  const html = renderToString(
    <AppDirectoryOwnerCta
      account={{ ...ACCOUNT, user: null, accountType: null }}
    />,
  );
  const href = html.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  const url = new URL(href ?? "", "https://atmosphereaccount.com");
  assertEquals(url.pathname, "/signin");
  assertEquals(url.searchParams.get("next"), "/apps/manage?new=1");
  assertEquals(url.searchParams.getAll("capability"), ["app", "media"]);
  assertStringIncludes(
    APP_REGISTRATION_SIGNIN_BODY,
    "including its public profile and images",
  );
});
