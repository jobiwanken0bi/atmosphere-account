import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import type { AccountHost } from "../../lib/account-hosts.ts";
import type { AppListing } from "../../lib/app-directory.ts";
import { ManagedAppCard, ManagedHostCard } from "./products.tsx";

const OWNER_DID = "did:plc:owner";
const APP = {
  id: "at://did:plc:owner/app.example.profile/skywriter",
  slug: "skywriter.example",
  name: "Skywriter",
  iconUrl: null,
  atstoreListingUri: "at://did:plc:owner/com.atproto.lexicon.schema/skywriter",
  profileDid: null,
  legacyProfileDid: null,
} as unknown as AppListing;
const HOST = {
  host: "pds.example.social",
  displayName: "Example PDS",
  avatarUrl: null,
  matchPatterns: [],
} as unknown as AccountHost;

Deno.test("managed app card keeps view public and contextualizes app management", () => {
  const html = renderToString(
    <ManagedAppCard
      app={APP}
      links={[]}
      ownerDid={OWNER_DID}
      authorized={false}
      rememberedAccounts={[]}
      initialHandle="owner.example"
    />,
  );
  const hrefs = hrefsIn(html);

  assertEquals(hrefs[0], "/apps/skywriter.example");
  assertPermissionFallback(hrefs[1], {
    next: `/apps/manage?app=${encodeURIComponent(APP.id)}`,
    action: "app",
    capability: "app",
    name: APP.name,
  });
  assertPermissionFallback(hrefs[2], {
    next: `/apps/manage/host?app=${encodeURIComponent(APP.id)}`,
    action: "app",
    capability: "app",
    name: APP.name,
  });
});

Deno.test("authorized managed app card keeps direct management links", () => {
  const html = renderToString(
    <ManagedAppCard
      app={APP}
      links={[]}
      ownerDid={OWNER_DID}
      authorized
      rememberedAccounts={[]}
    />,
  );

  assertEquals(hrefsIn(html), [
    "/apps/skywriter.example",
    `/apps/manage?app=${encodeURIComponent(APP.id)}`,
    `/apps/manage/host?app=${encodeURIComponent(APP.id)}`,
  ]);
});

Deno.test("managed host card contextualizes each host-management destination", () => {
  const html = renderToString(
    <ManagedHostCard
      host={HOST}
      links={[]}
      authorized={false}
      rememberedAccounts={[]}
      initialHandle="owner.example"
    />,
  );
  const hrefs = hrefsIn(html);

  assertEquals(hrefs[0], "/hosts/pds.example.social");
  assertPermissionFallback(hrefs[1], {
    next: "/hosts/pds.example.social/manage",
    action: "host_manage",
    capability: "host",
    name: HOST.displayName,
  });
  assertPermissionFallback(hrefs[2], {
    next: "/hosts/pds.example.social/manage/apps",
    action: "host_manage",
    capability: "host",
    name: HOST.displayName,
  });
});

Deno.test("authorized managed host card keeps direct management links", () => {
  const html = renderToString(
    <ManagedHostCard
      host={HOST}
      links={[]}
      authorized
      rememberedAccounts={[]}
    />,
  );

  assertEquals(hrefsIn(html), [
    "/hosts/pds.example.social",
    "/hosts/pds.example.social/manage",
    "/hosts/pds.example.social/manage/apps",
  ]);
});

function hrefsIn(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
    match[1].replaceAll("&amp;", "&")
  );
}

function assertPermissionFallback(
  href: string,
  expected: {
    next: string;
    action: string;
    capability: string;
    name: string;
  },
): void {
  const url = new URL(href, "https://atmosphereaccount.com");
  assertEquals(url.pathname, "/signin");
  assertEquals(url.searchParams.get("next"), expected.next);
  assertEquals(url.searchParams.get("action"), expected.action);
  assertEquals(url.searchParams.getAll("capability"), [expected.capability]);
  assertEquals(url.searchParams.get("name"), expected.name);
}
