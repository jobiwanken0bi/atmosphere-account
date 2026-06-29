import { appActionLinkKind, appActionLinks } from "./app-listing-links.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`Expected ${e}, got ${a}`);
  }
}

Deno.test("appActionLinks derives Bluesky profile action from product DID", () => {
  const links = appActionLinks({
    links: [{
      uri: "https://grain.social",
      label: "Website",
      role: "community.lexicon.app.defs#linkRoleWebsite",
    }],
    primaryUrl: "https://grain.social/?ref=blueskydirectory",
    productDid: "did:plc:e7rftrdyz5e2rw4y6ocszew2",
  });

  assertEquals(links.map((link) => [link.kind, link.label, link.uri]), [
    ["website", "Explore", "https://grain.social"],
    [
      "bluesky",
      "Bluesky",
      "https://bsky.app/profile/did:plc:e7rftrdyz5e2rw4y6ocszew2",
    ],
  ]);
});

Deno.test("appActionLinks does not duplicate explicit Bluesky links", () => {
  const links = appActionLinks({
    links: [{
      uri: "https://bsky.app/profile/grain.social",
      label: "Bluesky",
      role: "bsky",
    }],
    primaryUrl: null,
    productDid: "did:plc:e7rftrdyz5e2rw4y6ocszew2",
  });

  assertEquals(links.length, 1);
  assertEquals(links[0].kind, "bluesky");
  assertEquals(links[0].uri, "https://bsky.app/profile/grain.social");
});

Deno.test("appActionLinks opens Bluesky profiles in the selected viewer", () => {
  const links = appActionLinks(
    {
      links: [{
        uri: "https://bsky.app/profile/grain.social",
        label: "Bluesky",
        role: "bsky",
      }],
      primaryUrl: null,
      productDid: "did:plc:e7rftrdyz5e2rw4y6ocszew2",
    },
    { microblogViewerClientId: "blacksky" },
  );

  assertEquals(links.length, 1);
  assertEquals(links[0].kind, "bluesky");
  assertEquals(links[0].label, "Blacksky");
  assertEquals(links[0].uri, "https://blacksky.community/profile/grain.social");
});

Deno.test("appActionLinks keeps more than four visible ATStore actions", () => {
  const links = appActionLinks({
    links: [
      { uri: "https://example.com", label: "Website", role: "website" },
      { uri: "https://apps.apple.com/app/example" },
      { uri: "https://play.google.com/store/apps/details?id=example" },
      { uri: "https://docs.example.com", label: "Docs" },
      { uri: "https://github.com/example/app", label: "Source" },
    ],
    primaryUrl: null,
    productDid: "did:plc:example",
  });

  assertEquals(links.length, 6);
  assertEquals(links.map((link) => link.label), [
    "Explore",
    "Bluesky",
    "App Store",
    "Play Store",
    "Docs",
    "Source",
  ]);
});

Deno.test("appActionLinkKind recognizes common ATStore link shapes", () => {
  assertEquals(
    appActionLinkKind({
      uri: "https://apps.apple.com/app/example",
      role: "ios",
    }),
    "ios",
  );
  assertEquals(
    appActionLinkKind({
      uri: "https://play.google.com/store/apps/details?id=example",
      role: "android",
    }),
    "android",
  );
  assertEquals(
    appActionLinkKind({
      uri: "https://bsky.app/profile/example.com",
      label: "Profile",
    }),
    "bluesky",
  );
});
