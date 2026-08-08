import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  contextualReauthorization,
  contextualReauthorizationFromApiPayload,
  reauthUrlFromApiPayload,
} from "./reauth-required.ts";

Deno.test("reauthUrlFromApiPayload accepts only same-site paths", () => {
  assertEquals(
    reauthUrlFromApiPayload({
      error: "reauth_required",
      reauthUrl: "/signin?action=app",
    }),
    "/signin?action=app",
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "https://evil.example/signin" }),
    null,
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "//evil.example/signin" }),
    null,
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "/\\evil.example/signin" }),
    null,
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "/signin\naction=app" }),
    null,
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "/signin?action=app\n" }),
    null,
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "/signin\u0000?action=app" }),
    null,
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "/signin\u007f?action=app" }),
    null,
  );
  assertEquals(reauthUrlFromApiPayload({ error: "forbidden" }), null);
});

Deno.test("contextual reauthorization parses complete action context", () => {
  assertEquals(
    contextualReauthorizationFromApiPayload({
      error: "reauth_required",
      reauthUrl:
        "/signin?next=%2Fapps%2Fgrain%3Freview%3Dcompose&action=app&name=Grain&permission=required&capability=app&capability=media",
    }),
    {
      fallbackHref:
        "/signin?next=%2Fapps%2Fgrain%3Freview%3Dcompose&action=app&name=Grain&permission=required&capability=app&capability=media",
      returnTo: "/apps/grain?review=compose",
      action: "app",
      capabilities: ["app", "media"],
      targetName: "Grain",
    },
  );
});

Deno.test("contextual reauthorization retains interaction-specific intent", () => {
  for (
    const [reauthUrl, action, next, capabilities] of [
      [
        "/signin?next=%2Fapps%2Fgrain%3Ffavorite%3Dsave&action=favorite&name=Grain&permission=required&capability=favorite",
        "favorite",
        "/apps/grain?favorite=save",
        ["favorite"],
      ],
      [
        "/signin?next=%2Faccount%2Freviews&action=legacy_review_manage&name=Grain&permission=required&capability=legacy_review_manage",
        "legacy_review_manage",
        "/account/reviews",
        ["legacy_review_manage"],
      ],
      [
        "/signin?next=%2Faccount&action=profile&name=Alice&permission=required&capability=profile&capability=media",
        "profile",
        "/account",
        ["profile", "media"],
      ],
    ] as const
  ) {
    const parsed = contextualReauthorizationFromApiPayload({
      error: "reauth_required",
      reauthUrl,
    });
    assertEquals(parsed?.action, action);
    assertEquals(parsed?.returnTo, next);
    assertEquals(parsed?.capabilities, [...capabilities]);
  }
});

Deno.test("contextual reauthorization builds a safe local session-expiry fallback", () => {
  assertEquals(
    contextualReauthorization({
      returnTo: "/apps/grain?favorite=save",
      action: "favorite",
      capabilities: ["favorite"],
      targetName: "Grain",
    }),
    {
      fallbackHref:
        "/signin?next=%2Fapps%2Fgrain%3Ffavorite%3Dsave&action=favorite&name=Grain&capability=favorite&permission=required",
      returnTo: "/apps/grain?favorite=save",
      action: "favorite",
      capabilities: ["favorite"],
      targetName: "Grain",
    },
  );
  assertEquals(
    contextualReauthorization({
      returnTo: "https://evil.example/",
      action: "favorite",
      capabilities: ["favorite"],
    }),
    null,
  );
  assertEquals(
    contextualReauthorization({
      returnTo: "/apps/grain",
      action: "favorite",
      capabilities: ["host"],
    }),
    null,
  );
});

Deno.test("contextual reauthorization fails closed on malformed context", () => {
  for (
    const reauthUrl of [
      "/oauth/login?next=%2Faccount&action=profile&capability=profile",
      "/signin?next=%2Faccount&action=profile&capability=profile",
      "/signin?next=https%3A%2F%2Fevil.example&action=profile&permission=required&capability=profile",
      "/signin?next=%2Faccount&action=profile&permission=required&capability=host",
      "/signin?next=%2Faccount&action=profile&permission=required&capability=profile&scope=atproto",
      "/signin?next=%2Faccount&action=profile&action=host_manage&permission=required&capability=profile",
      "/signin?next=%2Faccount&action=profile&permission=required",
    ]
  ) {
    assertEquals(
      contextualReauthorizationFromApiPayload({
        error: "reauth_required",
        reauthUrl,
      }),
      null,
    );
  }
  assertEquals(
    contextualReauthorizationFromApiPayload({
      error: "forbidden",
      reauthUrl:
        "/signin?next=%2Faccount&action=profile&permission=required&capability=profile",
    }),
    null,
  );
});
