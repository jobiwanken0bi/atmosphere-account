import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isValidOauthResumeProof,
  oauthResumeProofValue,
} from "./oauth-resume-proof.ts";

Deno.test("OAuth resume proof is fresh and bound to its account and resource", () => {
  const now = 2_000_000;
  const proof = oauthResumeProofValue(
    "did:plc:alice",
    "host-profile:did:plc:alice:pds.example",
    now,
  );

  assertEquals(
    isValidOauthResumeProof(
      proof,
      "did:plc:alice",
      "host-profile:did:plc:alice:pds.example",
      now,
    ),
    true,
  );
  assertEquals(
    isValidOauthResumeProof(
      proof,
      "did:plc:bob",
      "host-profile:did:plc:alice:pds.example",
      now,
    ),
    false,
  );
  assertEquals(
    isValidOauthResumeProof(
      proof,
      "did:plc:alice",
      "host-profile:did:plc:alice:other.example",
      now,
    ),
    false,
  );
});

Deno.test("OAuth resume proof rejects missing, malformed, future, and stale values", () => {
  const now = 2_000_000;
  const validate = (value: string | null) =>
    isValidOauthResumeProof(value, "did:plc:alice", "resource", now);

  assertEquals(validate(null), false);
  assertEquals(validate("not json"), false);
  assertEquals(
    validate(oauthResumeProofValue("did:plc:alice", "resource", now + 1)),
    false,
  );
  assertEquals(
    validate(
      oauthResumeProofValue(
        "did:plc:alice",
        "resource",
        now - 30 * 60 * 1_000 - 1,
      ),
    ),
    false,
  );
});
