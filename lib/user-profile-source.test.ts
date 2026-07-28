import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AppUserRow } from "./account-types.ts";
import type { ProfileRow } from "./registry.ts";
import { effectiveUserProfile } from "./user-profile-source.ts";

const appUser = {
  did: "did:plc:test",
  handle: "person.example",
  displayName: "Microblog name",
  bio: "Microblog bio",
  avatarCid: "microblog-avatar",
  avatarMime: "image/jpeg",
  bskyClientId: "bluesky",
  bskyButtonVisible: true,
  websiteUrl: "https://fallback.example",
  websiteVisible: true,
  accountType: "user",
  createdAt: 1,
  updatedAt: 1,
} satisfies AppUserRow;

const atmosphereProfile = {
  did: "did:plc:test",
  handle: "person.example",
  name: "Atmosphere name",
  description: "",
  avatarCid: null,
  avatarMime: null,
  mainLink: "https://primary.example",
} as ProfileRow;

Deno.test("Atmosphere user profile is authoritative when it exists", () => {
  assertEquals(
    effectiveUserProfile({
      handle: appUser.handle,
      appUser,
      atmosphereProfile,
    }),
    {
      displayName: "Atmosphere name",
      bio: "",
      avatarCid: null,
      avatarMime: null,
      websiteUrl: "https://primary.example",
      hasAtmosphereProfile: true,
    },
  );
});

Deno.test("microblog-derived account fields are the initial fallback", () => {
  assertEquals(
    effectiveUserProfile({
      handle: appUser.handle,
      appUser,
      atmosphereProfile: null,
    }),
    {
      displayName: "Microblog name",
      bio: "Microblog bio",
      avatarCid: "microblog-avatar",
      avatarMime: "image/jpeg",
      websiteUrl: "https://fallback.example",
      hasAtmosphereProfile: false,
    },
  );
});
