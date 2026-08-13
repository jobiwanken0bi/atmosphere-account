import {
  type ArtifactReleaseProvenance,
  artifactReleaseProvenance,
} from "./artifact-release.ts";

export interface RuntimeRelease {
  runtime: "deno-deploy" | "railway" | "vercel" | "fly" | "local" | "other";
  deploymentId: string | null;
  service: string | null;
  gitSha: string | null;
  gitBranch: string | null;
  artifactDigest: string | null;
}

type EnvReader = (key: string) => string | undefined;

export function runtimeRelease(): RuntimeRelease {
  return runtimeReleaseFromEnv(readEnv, artifactReleaseProvenance());
}

export function runtimeReleaseFromEnvForTest(
  env: EnvReader,
  artifact: ArtifactReleaseProvenance = {
    gitSha: null,
    gitBranch: null,
    artifactDigest: null,
  },
): RuntimeRelease {
  return runtimeReleaseFromEnv(env, artifact);
}

function runtimeReleaseFromEnv(
  env: EnvReader,
  artifact: ArtifactReleaseProvenance,
): RuntimeRelease {
  const denoDeployFlag = env("DENO_DEPLOY")?.trim().toLowerCase();
  const isDenoDeploy = denoDeployFlag === "true" || denoDeployFlag === "1" ||
    Boolean(env("DENO_DEPLOY_BUILD_ID")?.trim()) ||
    Boolean(env("DENO_DEPLOYMENT_ID")?.trim());
  const runtime = isDenoDeploy
    ? "deno-deploy"
    : env("RAILWAY_PROJECT_ID") || env("RAILWAY_ENVIRONMENT_ID")
    ? "railway"
    : env("VERCEL")
    ? "vercel"
    : env("FLY_APP_NAME")
    ? "fly"
    : env("DENO_ENV") === "production"
    ? "other"
    : "local";

  // Deno Deploy exposes an immutable build ID at runtime, but not the Git SHA
  // for that build. Its embedded Git SHA is therefore optional; the compiled
  // canonical artifact digest is the provider-independent source identity.
  // Never fall back to an app-level release stamp: that value can lag or be
  // changed independently of the revision serving traffic.
  // Other source-linked providers retain only their own native provenance.
  // In particular, a Railway deploy that did not originate from GitHub must
  // report no Git revision rather than inherit a mutable app-level stamp or a
  // GitHub Actions environment value unrelated to the running container.
  const gitSha = runtime === "deno-deploy"
    ? artifact.gitSha
    : runtime === "railway"
    ? firstEnv(env, ["RAILWAY_GIT_COMMIT_SHA"])
    : runtime === "vercel"
    ? firstEnv(env, ["VERCEL_GIT_COMMIT_SHA"])
    : runtime === "fly"
    ? firstEnv(env, ["ATMOSPHERE_RELEASE_SHA"])
    : runtime === "other"
    ? firstEnv(env, ["RENDER_GIT_COMMIT", "GITHUB_SHA"])
    : null;
  const gitBranch = runtime === "deno-deploy"
    ? artifact.gitBranch
    : runtime === "railway"
    ? firstEnv(env, ["RAILWAY_GIT_BRANCH"])
    : runtime === "vercel"
    ? firstEnv(env, ["VERCEL_GIT_COMMIT_REF"])
    : runtime === "fly"
    ? firstEnv(env, ["ATMOSPHERE_RELEASE_BRANCH"])
    : runtime === "other"
    ? firstEnv(env, ["RENDER_GIT_BRANCH", "GITHUB_REF_NAME"])
    : null;

  return {
    runtime,
    deploymentId: firstEnv(
      env,
      runtime === "deno-deploy"
        ? ["DENO_DEPLOY_BUILD_ID", "DENO_DEPLOYMENT_ID"]
        : runtime === "railway"
        ? ["RAILWAY_DEPLOYMENT_ID"]
        : runtime === "vercel"
        ? ["VERCEL_DEPLOYMENT_ID"]
        : runtime === "fly"
        ? ["FLY_ALLOC_ID"]
        : runtime === "other"
        ? ["ATMOSPHERE_RELEASE_ID"]
        : [],
    ),
    service: firstEnv(env, [
      "ATMOSPHERE_SERVICE_NAME",
      "RAILWAY_SERVICE_NAME",
      "FLY_APP_NAME",
      "VERCEL_PROJECT_PRODUCTION_URL",
    ]),
    gitSha: fullSha(gitSha),
    gitBranch,
    artifactDigest: normalizeArtifactDigest(artifact.artifactDigest),
  };
}

function normalizeArtifactDigest(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return /^web-source-v1:sha256:[0-9a-f]{64}$/.test(value) ? value : null;
}

function firstEnv(env: EnvReader, keys: string[]): string | null {
  for (const key of keys) {
    const value = env(key)?.trim();
    if (value) return value;
  }
  return null;
}

function fullSha(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(normalized) ? normalized : null;
}

function readEnv(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}
