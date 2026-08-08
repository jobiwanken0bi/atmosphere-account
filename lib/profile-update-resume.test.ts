import {
  pendingProfileUpdateAction,
  pendingProfileUpdateDeleteAction,
  pendingProfileUpdateDeleteForDid,
  pendingProfileUpdateDraftForDid,
  profileUpdateDeletePendingKey,
  profileUpdateDeleteResumeMarker,
  type ProfileUpdateDraft,
  profileUpdatePendingKey,
  profileUpdateResumeMarker,
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

Deno.test("profile update resume storage is isolated by project DID", () => {
  assertEquals(
    profileUpdatePendingKey("did:plc:alice") ===
      profileUpdatePendingKey("did:plc:bob"),
    false,
  );
  assertEquals(
    profileUpdateResumeMarker("did:plc:alice") ===
      profileUpdateResumeMarker("did:plc:bob"),
    false,
  );
  assertEquals(
    profileUpdateDeletePendingKey("did:plc:alice") ===
      profileUpdateDeletePendingKey("did:plc:bob"),
    false,
  );
  assertEquals(
    profileUpdateDeleteResumeMarker("did:plc:alice") ===
      profileUpdateDeleteResumeMarker("did:plc:bob"),
    false,
  );
  const pending = pendingProfileUpdateAction("did:plc:alice", draft);
  assertEquals(
    pendingProfileUpdateDraftForDid(pending, "did:plc:alice"),
    draft,
  );
  assertEquals(
    pendingProfileUpdateDraftForDid(pending, "did:plc:bob"),
    null,
  );
});

Deno.test("profile update deletion resumes only for its project account", () => {
  const pending = pendingProfileUpdateDeleteAction(
    "did:plc:alice",
    "release-1",
  );
  assertEquals(
    pendingProfileUpdateDeleteForDid(pending, "did:plc:alice"),
    "release-1",
  );
  assertEquals(
    pendingProfileUpdateDeleteForDid(pending, "did:plc:bob"),
    null,
  );
  assertEquals(
    pendingProfileUpdateDeleteForDid(
      { projectDid: "did:plc:alice", rkey: " " },
      "did:plc:alice",
    ),
    null,
  );
});

Deno.test("profile update resume rejects malformed drafts", () => {
  assertEquals(
    pendingProfileUpdateDraftForDid({
      projectDid: "did:plc:alice",
      draft: { ...draft, body: 42 },
    }, "did:plc:alice"),
    null,
  );
  assertEquals(
    pendingProfileUpdateDraftForDid({
      projectDid: "did:plc:alice",
      draft: { ...draft, rkey: undefined },
    }, "did:plc:alice"),
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
