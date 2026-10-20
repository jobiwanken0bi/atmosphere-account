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

export type PublicHosting = "deno-deploy" | "railway";

export function normalizePublicHosting(
  value: string | null | undefined,
): PublicHosting {
  if (!value || value === "deno-deploy") return "deno-deploy";
  if (value === "railway") return "railway";
  throw new Error("public hosting must be deno-deploy or railway");
}

/** Select the actual serving process for direct Railway hosting, or the
 * independently reported AppView for the split deployment. */
export function appviewReadinessPayload(
  body: Record<string, unknown>,
  publicHosting: PublicHosting,
): unknown {
  if (publicHosting === "railway") {
    if (body.appview !== undefined) {
      throw new Error("Railway public hosting must report local readiness");
    }
    return body;
  }
  return body.appview;
}

export interface ReleaseTopologyIdentity {
  runtime: string;
  deploymentId: string | null;
}

export function assertExpectedReleaseTopology(
  shell: ReleaseTopologyIdentity,
  appview: ReleaseTopologyIdentity,
  publicHosting: PublicHosting = "deno-deploy",
): void {
  if (shell.runtime !== publicHosting) {
    throw new Error(
      `public shell runtime must be ${publicHosting}, got ${shell.runtime}`,
    );
  }
  if (!shell.deploymentId) {
    throw new Error(
      publicHosting === "deno-deploy"
        ? "public shell must report its immutable Deno build ID"
        : "public shell must report its Railway deployment ID",
    );
  }
  if (
    publicHosting === "railway" && shell.deploymentId !== appview.deploymentId
  ) {
    throw new Error("direct Railway hosting must use one serving deployment");
  }
  if (appview.runtime !== "railway") {
    throw new Error(`AppView runtime must be railway, got ${appview.runtime}`);
  }
}
