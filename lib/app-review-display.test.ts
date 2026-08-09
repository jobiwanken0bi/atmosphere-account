import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AppUserRow } from "./account-types.ts";
import { reviewAuthorIdentity } from "./app-review-display.ts";

const cachedBskyUser = {
  did: "did:plc:reviewer",
  handle: "reviewer.example",
  displayName: "Reviewer on Bluesky",
  bio: "Cached from app.bsky.actor.profile",
  avatarCid: "bafy-avatar",
  avatarMime: "image/jpeg",
  bskyClientId: "blacksky",
  bskyButtonVisible: false,
  websiteUrl: null,
  websiteVisible: false,
  accountType: "user",
  createdAt: 1,
  updatedAt: 2,
} satisfies AppUserRow;

Deno.test("review identity uses the Bluesky-derived cache and selected viewer", () => {
  assertEquals(
    reviewAuthorIdentity({
      did: cachedBskyUser.did,
      appUser: cachedBskyUser,
      resolvedHandle: "stale.example",
    }),
    {
      handle: "reviewer.example",
      name: "Reviewer on Bluesky",
      avatarUrl:
        "https://cdn.bsky.app/img/avatar/plain/did:plc:reviewer/bafy-avatar",
      href: "https://blacksky.community/profile/reviewer.example",
    },
  );
});

Deno.test("review identity falls back to a resolved handle and Bluesky", () => {
  assertEquals(
    reviewAuthorIdentity({
      did: "did:plc:remote",
      appUser: null,
      resolvedHandle: "remote.example",
    }),
    {
      handle: "remote.example",
      name: null,
      avatarUrl: null,
      href: "https://bsky.app/profile/remote.example",
    },
  );
});

Deno.test("review identity has no profile link when a DID has no handle", () => {
  assertEquals(
    reviewAuthorIdentity({
      did: "did:plc:unresolved",
      appUser: null,
      resolvedHandle: null,
    }),
    {
      handle: null,
      name: null,
      avatarUrl: null,
      href: null,
    },
  );
});
