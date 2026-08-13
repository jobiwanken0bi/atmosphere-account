/**
 * Immutable source provenance embedded by Vite in the compiled server
 * artifact. Source-linked Deno Deploy does not expose its Git revision at
 * runtime, so readiness must not rely on a mutable app-level environment
 * stamp to identify the active revision.
 *
 * These globals are deliberately absent in direct `deno test` / development
 * execution. `typeof` keeps that path safe while Vite replaces the constants
 * in production bundles.
 */
declare const __ATMOSPHERE_ARTIFACT_GIT_SHA__: string | null;
declare const __ATMOSPHERE_ARTIFACT_GIT_BRANCH__: string | null;
declare const __ATMOSPHERE_ARTIFACT_DIGEST__: string | null;

export interface ArtifactReleaseProvenance {
  gitSha: string | null;
  gitBranch: string | null;
  artifactDigest?: string | null;
}

export function artifactReleaseProvenance(): ArtifactReleaseProvenance {
  return {
    gitSha: typeof __ATMOSPHERE_ARTIFACT_GIT_SHA__ === "undefined"
      ? null
      : __ATMOSPHERE_ARTIFACT_GIT_SHA__,
    gitBranch: typeof __ATMOSPHERE_ARTIFACT_GIT_BRANCH__ === "undefined"
      ? null
      : __ATMOSPHERE_ARTIFACT_GIT_BRANCH__,
    artifactDigest: typeof __ATMOSPHERE_ARTIFACT_DIGEST__ === "undefined"
      ? null
      : __ATMOSPHERE_ARTIFACT_DIGEST__,
  };
}
