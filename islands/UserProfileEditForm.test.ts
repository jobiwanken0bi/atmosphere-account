import {
  cancelUserProfileReauthorization,
  pendingUserProfileDraft,
  pendingUserProfileEntriesForDid,
  userProfilePendingKey,
  userProfileResponseWasSaved,
  userProfileResumeMarker,
} from "./UserProfileEditForm.tsx";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("user profile resume storage is isolated by DID", () => {
  assertEquals(
    userProfilePendingKey("did:plc:alice") ===
      userProfilePendingKey("did:plc:bob"),
    false,
  );
  assertEquals(
    userProfileResumeMarker("did:plc:alice") ===
      userProfileResumeMarker("did:plc:bob"),
    false,
  );
});

Deno.test("closing inline profile reauthorization disarms resume state", async () => {
  const removed: string[] = [];
  const cleared: string[] = [];
  await cancelUserProfileReauthorization(
    "atmosphere:resume-user-profile:did:plc:alice",
    "user-profile:save:did:plc:alice",
    {
      storage: {
        removeItem(key) {
          removed.push(key);
        },
      },
      clearPending(key) {
        cleared.push(key);
        return Promise.resolve();
      },
    },
  );
  assertEquals(removed.length, 1);
  assertEquals(removed[0], "atmosphere:resume-user-profile:did:plc:alice");
  assertEquals(cleared.length, 1);
  assertEquals(cleared[0], "user-profile:save:did:plc:alice");
});

Deno.test("profile cancellation still clears its draft when storage is blocked", async () => {
  let cleared = false;
  await cancelUserProfileReauthorization("resume", "pending", {
    storage: {
      removeItem() {
        throw new Error("blocked");
      },
    },
    clearPending() {
      cleared = true;
      return Promise.resolve();
    },
  });
  assertEquals(cleared, true);
});

Deno.test("user profile pending data resumes only for its originating DID", () => {
  const pending = {
    did: "did:plc:alice",
    entries: [["displayName", "Alice"]],
  };
  assertEquals(
    pendingUserProfileEntriesForDid(pending, "did:plc:alice")?.length,
    1,
  );
  assertEquals(
    pendingUserProfileEntriesForDid(pending, "did:plc:bob"),
    null,
  );
  assertEquals(
    pendingUserProfileEntriesForDid({
      did: "did:plc:alice",
      entries: [{ displayName: "not a form tuple" }],
    }, "did:plc:alice"),
    null,
  );
});

Deno.test("user profile save accepts only the expected redirect", () => {
  assertEquals(
    userProfileResponseWasSaved({
      ok: true,
      redirected: true,
      url: "https://atmosphere.example/account",
    }),
    true,
  );
  assertEquals(
    userProfileResponseWasSaved({
      ok: true,
      redirected: false,
      url: "https://atmosphere.example/account",
    }),
    false,
  );
  assertEquals(
    userProfileResponseWasSaved({
      ok: true,
      redirected: true,
      url: "https://atmosphere.example/error",
    }),
    false,
  );
});

Deno.test("resumed profile drafts restore visible fields and the avatar file", () => {
  const avatar = new File([new Uint8Array([1, 2, 3])], "avatar.png", {
    type: "image/png",
  });
  const draft = pendingUserProfileDraft([
    ["displayName", "Alice Updated"],
    ["bio", "A restored bio"],
    ["bskyButtonVisible", "0"],
    ["bskyButtonVisible", "1"],
    ["websiteUrl", "https://alice.example"],
    ["websiteVisible", "0"],
    ["websiteVisible", "1"],
    ["avatarUpload", avatar],
  ]);
  assertEquals(draft.displayName, "Alice Updated");
  assertEquals(draft.bio, "A restored bio");
  assertEquals(draft.microblogVisible, true);
  assertEquals(draft.websiteUrl, "https://alice.example");
  assertEquals(draft.websiteVisible, true);
  assertEquals(draft.avatarFile, avatar);
});
