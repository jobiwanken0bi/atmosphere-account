import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hasHostProfileResumeMarker,
  hostProfilePendingKey,
  hostProfileResumePath,
  pendingHostProfileAction,
  pendingHostProfileEntriesForContext,
  withoutHostProfileResumeMarker,
} from "./host-profile-resume.ts";

Deno.test("host profile pending drafts are isolated by DID and host", () => {
  assertEquals(
    hostProfilePendingKey("did:plc:alice", "PDS.Example") ===
      hostProfilePendingKey("did:plc:bob", "pds.example"),
    false,
  );
  assertEquals(
    hostProfilePendingKey("did:plc:alice", "pds.example") ===
      hostProfilePendingKey("did:plc:alice", "other.example"),
    false,
  );
  assertEquals(
    hostProfilePendingKey("did:plc:alice", "PDS.Example"),
    hostProfilePendingKey("did:plc:alice", "pds.example"),
  );
});

Deno.test("host profile pending data resumes only in its originating context", () => {
  const avatar = new File(["avatar"], "avatar.png", { type: "image/png" });
  const pending = pendingHostProfileAction(
    "did:plc:alice",
    "PDS.Example",
    [["displayName", "Example"], ["avatarUpload", avatar]],
  );

  const entries = pendingHostProfileEntriesForContext(
    pending,
    "did:plc:alice",
    "pds.example",
  );
  assertEquals(entries?.length, 2);
  assertEquals(entries?.[1]?.[1], avatar);
  assertEquals(
    pendingHostProfileEntriesForContext(
      pending,
      "did:plc:bob",
      "pds.example",
    ),
    null,
  );
  assertEquals(
    pendingHostProfileEntriesForContext(
      pending,
      "did:plc:alice",
      "other.example",
    ),
    null,
  );
});

Deno.test("host profile resume marker is explicit, one-shot, and query-safe", () => {
  const source = new URL(
    "https://atmosphereaccount.com/hosts/pds.example/manage?tab=profile#avatar",
  );
  const resumePath = hostProfileResumePath(source);
  assertEquals(
    resumePath,
    "/hosts/pds.example/manage?tab=profile&resume_host_profile=1#avatar",
  );

  const resumed = new URL(resumePath, source.origin);
  assertEquals(hasHostProfileResumeMarker(resumed), true);
  assertEquals(
    withoutHostProfileResumeMarker(resumed),
    "/hosts/pds.example/manage?tab=profile#avatar",
  );
});
