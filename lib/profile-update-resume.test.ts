import {
  pendingProfileUpdateAction,
  pendingProfileUpdateDeleteAction,
  pendingProfileUpdateDeleteForDid,
  pendingProfileUpdateDraftForDid,
  PROFILE_UPDATE_DELETE_RESUME_PARAM,
  PROFILE_UPDATE_RESUME_PARAM,
  profileUpdateDeletePendingKey,
  type ProfileUpdateDraft,
  profileUpdatePendingKey,
  profileUpdateResumeLocation,
  profileUpdateResumeProofKey,
  profileUpdateResumeReturnTo,
  profileUpdateReturnToWithoutResume,
  publishableProfileUpdateDraft,
} from "./profile-update-resume.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const draft: ProfileUpdateDraft = {
  rkey: "release-1",
  title: "Version 1.0",
  version: "1.0.0",
  body: "A carefully preserved draft.",
  tangledCommitUrl: "https://tangled.org/example/repo/commit/abc",
};
const APP_ID = "grain.social";

Deno.test("profile update pending storage and proofs are isolated", () => {
  assertEquals(
    profileUpdatePendingKey("did:plc:alice", APP_ID) ===
      profileUpdatePendingKey("did:plc:bob", APP_ID),
    false,
  );
  assertEquals(
    profileUpdateResumeProofKey("did:plc:alice", APP_ID, "save") ===
      profileUpdateResumeProofKey("did:plc:bob", APP_ID, "save"),
    false,
  );
  assertEquals(
    profileUpdateDeletePendingKey("did:plc:alice", APP_ID) ===
      profileUpdateDeletePendingKey("did:plc:bob", APP_ID),
    false,
  );
  assertEquals(
    profileUpdatePendingKey("did:plc:alice", APP_ID) ===
      profileUpdatePendingKey("did:plc:alice", "another-app"),
    false,
  );
  assertEquals(
    profileUpdateResumeProofKey("did:plc:alice", APP_ID, "save") ===
      profileUpdateResumeProofKey("did:plc:alice", APP_ID, "delete"),
    false,
  );
  const pending = pendingProfileUpdateAction(
    "did:plc:alice",
    APP_ID,
    draft,
  );
  assertEquals(
    pendingProfileUpdateDraftForDid(pending, "did:plc:alice", APP_ID),
    draft,
  );
  assertEquals(
    pendingProfileUpdateDraftForDid(pending, "did:plc:bob", APP_ID),
    null,
  );
  assertEquals(
    pendingProfileUpdateDraftForDid(
      pending,
      "did:plc:alice",
      "another-app",
    ),
    null,
  );
});

Deno.test("profile update resume return preserves editor context", () => {
  const save = profileUpdateResumeReturnTo(
    "/apps/manage?app=grain.social#updates",
    "did:plc:alice",
    APP_ID,
    "save",
  );
  const saveUrl = new URL(save, "https://example.test");
  assertEquals(saveUrl.pathname, "/apps/manage");
  assertEquals(saveUrl.searchParams.get("app"), "grain.social");
  assertEquals(
    saveUrl.searchParams.get(PROFILE_UPDATE_RESUME_PARAM),
    "did:plc:alice",
  );
  assertEquals(saveUrl.hash, "#updates");

  const deletion = profileUpdateResumeReturnTo(
    save,
    "did:plc:alice",
    APP_ID,
    "delete",
  );
  const deleteUrl = new URL(deletion, "https://example.test");
  assertEquals(deleteUrl.searchParams.has(PROFILE_UPDATE_RESUME_PARAM), false);
  assertEquals(
    deleteUrl.searchParams.get(PROFILE_UPDATE_DELETE_RESUME_PARAM),
    "did:plc:alice",
  );
});

Deno.test("profile update resumes only one exact action for its project DID", () => {
  const href = "https://example.test" +
    profileUpdateResumeReturnTo(
      "/apps/manage?app=grain.social#updates",
      "did:plc:alice",
      APP_ID,
      "save",
    );
  assertEquals(profileUpdateResumeLocation(href, "did:plc:alice", APP_ID), {
    hadMarker: true,
    shouldResume: true,
    kind: "save",
    cleanLocation: "/apps/manage?app=grain.social#updates",
  });
  assertEquals(profileUpdateResumeLocation(href, "did:plc:bob", APP_ID), {
    hadMarker: true,
    shouldResume: false,
    kind: "save",
    cleanLocation: "/apps/manage?app=grain.social#updates",
  });
  assertEquals(
    profileUpdateResumeLocation(href, "did:plc:alice", "another-app"),
    {
      hadMarker: true,
      shouldResume: false,
      kind: "save",
      cleanLocation: "/apps/manage?app=grain.social#updates",
    },
  );
});

Deno.test("duplicate or conflicting profile update markers never resume", () => {
  const duplicate =
    "/apps/manage?profile-update-resume=did%3Aplc%3Aalice&profile-update-resume=did%3Aplc%3Aalice&app=grain.social";
  assertEquals(
    profileUpdateResumeLocation(duplicate, "did:plc:alice", APP_ID),
    {
      hadMarker: true,
      shouldResume: false,
      kind: null,
      cleanLocation: "/apps/manage?app=grain.social",
    },
  );
  const conflicting =
    "/apps/manage?profile-update-resume=did%3Aplc%3Aalice&profile-update-delete-resume=did%3Aplc%3Aalice";
  assertEquals(
    profileUpdateResumeLocation(conflicting, "did:plc:alice", APP_ID),
    {
      hadMarker: true,
      shouldResume: false,
      kind: null,
      cleanLocation: "/apps/manage",
    },
  );
});

Deno.test("profile update return helper rejects external destinations", () => {
  assertEquals(
    profileUpdateReturnToWithoutResume("https://evil.example/steal"),
    "/apps/manage",
  );
});

Deno.test("profile update deletion resumes only for its project account", () => {
  const pending = pendingProfileUpdateDeleteAction(
    "did:plc:alice",
    APP_ID,
    "release-1",
  );
  assertEquals(
    pendingProfileUpdateDeleteForDid(pending, "did:plc:alice", APP_ID),
    "release-1",
  );
  assertEquals(
    pendingProfileUpdateDeleteForDid(pending, "did:plc:bob", APP_ID),
    null,
  );
  assertEquals(
    pendingProfileUpdateDeleteForDid(
      { projectDid: "did:plc:alice", rkey: " " },
      "did:plc:alice",
      APP_ID,
    ),
    null,
  );
});

Deno.test("profile update resume rejects malformed drafts", () => {
  assertEquals(
    pendingProfileUpdateDraftForDid(
      {
        projectDid: "did:plc:alice",
        appId: APP_ID,
        draft: { ...draft, body: 42 },
      },
      "did:plc:alice",
      APP_ID,
    ),
    null,
  );
  assertEquals(
    pendingProfileUpdateDraftForDid(
      {
        projectDid: "did:plc:alice",
        appId: APP_ID,
        draft: { ...draft, rkey: undefined },
      },
      "did:plc:alice",
      APP_ID,
    ),
    null,
  );
});

Deno.test("new profile update retries retain one repository key", () => {
  const created = publishableProfileUpdateDraft(
    { ...draft, rkey: null },
    () => "stable-rkey",
  );
  assertEquals(created.rkey, "stable-rkey");
  assertEquals(publishableProfileUpdateDraft(created, () => "other"), created);
});
