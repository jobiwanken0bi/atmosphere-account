const OAUTH_RESUME_PROOF_TTL_MS = 30 * 60 * 1_000;

/**
 * Create the same-tab half of an OAuth resume handoff. The return URL remains
 * useful for routing, but it is never sufficient on its own to replay a saved
 * write.
 */
export function oauthResumeProofValue(
  ownerDid: string,
  resource: string,
  savedAt = Date.now(),
): string {
  return JSON.stringify({ ownerDid, resource, savedAt });
}

/** Accept only a fresh proof for the exact account and saved action. */
export function isValidOauthResumeProof(
  value: string | null,
  ownerDid: string,
  resource: string,
  now = Date.now(),
): boolean {
  if (!value || !ownerDid || !resource) return false;
  try {
    const proof = JSON.parse(value) as Record<string, unknown>;
    return proof.ownerDid === ownerDid && proof.resource === resource &&
      typeof proof.savedAt === "number" && Number.isFinite(proof.savedAt) &&
      proof.savedAt <= now &&
      now - proof.savedAt <= OAUTH_RESUME_PROOF_TTL_MS;
  } catch {
    return false;
  }
}
