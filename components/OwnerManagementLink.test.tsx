import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import OwnerManagementLink, {
  type OwnerManagementKind,
} from "./OwnerManagementLink.tsx";

const CONTEXTS: Array<{
  label: string;
  kind: OwnerManagementKind;
  destinationHref: string;
  targetName: string;
}> = [
  {
    label: "host detail management",
    kind: "host",
    destinationHref: "/hosts/pds.example.social/manage",
    targetName: "Example PDS",
  },
  {
    label: "account home app management",
    kind: "app",
    destinationHref: "/apps/manage",
    targetName: "Skywriter",
  },
  {
    label: "managed-products app hosting",
    kind: "app",
    destinationHref: "/apps/manage/host?app=at%3A%2F%2Fexample",
    targetName: "Skywriter",
  },
  {
    label: "managed-products host apps",
    kind: "host",
    destinationHref: "/hosts/pds.example.social/manage/apps",
    targetName: "Example PDS",
  },
  {
    label: "legacy app profile management",
    kind: "app",
    destinationHref: "/apps/manage",
    targetName: "Legacy Writer",
  },
];

Deno.test("owner management CTAs render contextual permission fallbacks for narrower sessions", () => {
  for (const context of CONTEXTS) {
    const html = renderToString(
      <OwnerManagementLink
        authorized={false}
        kind={context.kind}
        destinationHref={context.destinationHref}
        targetName={context.targetName}
        label={context.label}
        rememberedAccounts={[{
          did: "did:plc:alice",
          handle: "alice.example",
        }]}
        initialHandle="alice.example"
      />,
    );
    const fallback = new URL(firstHref(html), "https://atmosphereaccount.com");

    assertEquals(fallback.pathname, "/signin", context.label);
    assertEquals(
      fallback.searchParams.get("next"),
      context.destinationHref,
      context.label,
    );
    assertEquals(
      fallback.searchParams.get("action"),
      context.kind === "app" ? "app" : "host_manage",
      context.label,
    );
    assertEquals(
      fallback.searchParams.getAll("capability"),
      [context.kind === "app" ? "app" : "host"],
      context.label,
    );
    assertEquals(
      fallback.searchParams.get("name"),
      context.targetName,
      context.label,
    );
    assertStringIncludes(html, 'aria-haspopup="dialog"', context.label);
    assertStringIncludes(html, context.label, context.label);
  }
});

Deno.test("already-authorized owner management CTAs remain plain destination links", () => {
  for (const context of CONTEXTS) {
    const html = renderToString(
      <OwnerManagementLink
        authorized
        kind={context.kind}
        destinationHref={context.destinationHref}
        targetName={context.targetName}
        label={context.label}
      />,
    );

    assertEquals(firstHref(html), context.destinationHref, context.label);
    assertEquals(html.includes("/signin?"), false, context.label);
    assertEquals(html.includes('aria-haspopup="dialog"'), false, context.label);
  }
});

Deno.test("owner management CTA icons are preserved in both link states", () => {
  for (const authorized of [false, true]) {
    const html = renderToString(
      <OwnerManagementLink
        authorized={authorized}
        kind="host"
        destinationHref="/hosts/pds.example.social/manage"
        targetName="Example PDS"
        label="Manage host profile"
        leadingIcon="host"
      />,
    );

    assertStringIncludes(html, "<svg", String(authorized));
    assertStringIncludes(html, "Manage host profile", String(authorized));
  }
});

function firstHref(html: string): string {
  const href = html.match(/href="([^"]+)"/)?.[1];
  if (!href) throw new Error(`Expected an href in ${html}`);
  return href.replaceAll("&amp;", "&");
}
