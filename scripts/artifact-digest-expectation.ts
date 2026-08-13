export const ARTIFACT_DIGEST_PATTERN = /^web-source-v1:sha256:[0-9a-f]{64}$/;

export function normalizeExpectedArtifactDigest(
  value: string | null,
  label: string,
): string {
  const normalized = value?.trim() ?? "";
  if (!ARTIFACT_DIGEST_PATTERN.test(normalized)) {
    throw new Error(
      `${label} must be a canonical web-source-v1 SHA-256 digest`,
    );
  }
  return normalized;
}

export function assertExpectedArtifactDigest(
  actual: string,
  expected: string,
  label: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `${label} artifactDigest expected ${expected}, got ${actual}`,
    );
  }
}

export interface ReleaseTopologyIdentity {
  runtime: string;
  deploymentId: string | null;
}

export function assertExpectedReleaseTopology(
  shell: ReleaseTopologyIdentity,
  appview: ReleaseTopologyIdentity,
): void {
  if (shell.runtime !== "deno-deploy") {
    throw new Error(
      `public shell runtime must be deno-deploy, got ${shell.runtime}`,
    );
  }
  if (!shell.deploymentId) {
    throw new Error("public shell must report its immutable Deno build ID");
  }
  if (appview.runtime !== "railway") {
    throw new Error(`AppView runtime must be railway, got ${appview.runtime}`);
  }
}
