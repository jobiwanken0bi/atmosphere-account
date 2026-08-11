import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AppUserRow } from "./account-types.ts";
import {
  fetchPublicReviewProfilesForTest,
  reviewAuthorIdentity,
} from "./app-review-display.ts";

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

Deno.test("review identity fills an incomplete local cache from Bluesky", () => {
  assertEquals(
    reviewAuthorIdentity({
      did: cachedBskyUser.did,
      appUser: {
        ...cachedBskyUser,
        displayName: null,
        avatarCid: null,
        avatarMime: null,
      },
      liveProfile: {
        did: cachedBskyUser.did,
        handle: "current.example",
        displayName: "Current Reviewer",
        avatarUrl:
          "https://cdn.bsky.app/img/avatar/plain/did:plc:reviewer/current@jpeg",
      },
      resolvedHandle: null,
    }),
    {
      handle: "current.example",
      name: "Current Reviewer",
      avatarUrl:
        "https://cdn.bsky.app/img/avatar/plain/did:plc:reviewer/current@jpeg",
      href: "https://blacksky.community/profile/current.example",
    },
  );
});

Deno.test("review profile lookup accepts only requested safe Bluesky profiles", async () => {
  const did = "did:plc:reviewer";
  const profiles = await fetchPublicReviewProfilesForTest(
    [did],
    (input, init) => {
      const url = new URL(String(input));
      assertEquals(url.searchParams.getAll("actors"), [did]);
      assertEquals(init?.redirect, "manual");
      return Promise.resolve(Response.json({
        profiles: [
          {
            did,
            handle: "Reviewer.Example",
            displayName: " Reviewer ",
            avatar:
              "https://cdn.bsky.app/img/avatar/plain/did:plc:reviewer/avatar@jpeg",
          },
          {
            did: "did:plc:unrequested",
            handle: "attacker.example",
            avatar: "https://evil.example/avatar.png",
          },
        ],
      }));
    },
  );
  assertEquals(profiles.get(did), {
    did,
    handle: "reviewer.example",
    displayName: "Reviewer",
    avatarUrl:
      "https://cdn.bsky.app/img/avatar/plain/did:plc:reviewer/avatar@jpeg",
  });
  assertEquals(profiles.has("did:plc:unrequested"), false);
});

Deno.test("review profile lookup rejects non-JSON responses", async () => {
  await assertRejects(
    () =>
      fetchPublicReviewProfilesForTest(
        ["did:plc:reviewer"],
        () => Promise.resolve(new Response("<html></html>")),
      ),
    Error,
    "non-JSON",
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
