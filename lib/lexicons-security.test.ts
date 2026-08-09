import { assertEquals } from "jsr:@std/assert@1";
import { validateProfile } from "./lexicons.ts";

function profileWithAvatar(avatar: unknown) {
  return {
    profileType: "project",
    name: "Example",
    description: "",
    mainLink: "https://example.com",
    categories: ["app"],
    createdAt: "2026-01-01T00:00:00.000Z",
    avatar,
  };
}

Deno.test("profile validation enforces avatar type and lexicon byte ceiling", () => {
  const html = validateProfile(profileWithAvatar({
    $type: "blob",
    ref: { $link: "bafycid" },
    mimeType: "text/html",
    size: 100,
  }));
  assertEquals(html.ok, false);
  assertEquals(html.error, "avatar: must be png, jpeg, or webp");

  const oversized = validateProfile(profileWithAvatar({
    $type: "blob",
    ref: { $link: "bafycid" },
    mimeType: "image/png",
    size: 1_000_001,
  }));
  assertEquals(oversized.ok, false);
  assertEquals(oversized.error, "avatar: max 1MB");
});

Deno.test("profile validation rejects malformed blob sizes and CIDs", () => {
  for (
    const avatar of [
      {
        $type: "blob",
        ref: { $link: "bafy/cid" },
        mimeType: "image/png",
        size: 100,
      },
      {
        $type: "blob",
        ref: { $link: "bafycid" },
        mimeType: "image/png",
        size: -1,
      },
      {
        $type: "blob",
        ref: { $link: "bafycid" },
        mimeType: "image/png",
        size: Number.NaN,
      },
    ]
  ) {
    const result = validateProfile(profileWithAvatar(avatar));
    assertEquals(result.ok, false);
    assertEquals(result.error, "avatar: invalid blob ref");
  }
});

Deno.test("profile validation enforces developer icon byte ceilings", () => {
  const result = validateProfile({
    ...profileWithAvatar(undefined),
    icon: {
      $type: "blob",
      ref: { $link: "bafycid" },
      mimeType: "image/svg+xml",
      size: 200_001,
    },
  });
  assertEquals(result.ok, false);
  assertEquals(result.error, "icon: max 200KB");
});
