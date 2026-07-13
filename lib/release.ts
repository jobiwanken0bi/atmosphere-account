export interface RuntimeRelease {
  runtime: "deno-deploy" | "railway" | "vercel" | "fly" | "local" | "other";
  deploymentId: string | null;
  service: string | null;
  gitSha: string | null;
  gitBranch: string | null;
}

type EnvReader = (key: string) => string | undefined;

export function runtimeRelease(): RuntimeRelease {
  return runtimeReleaseFromEnv(readEnv);
}

export function runtimeReleaseFromEnvForTest(env: EnvReader): RuntimeRelease {
  return runtimeReleaseFromEnv(env);
}

function runtimeReleaseFromEnv(env: EnvReader): RuntimeRelease {
  const runtime = env("DENO_DEPLOYMENT_ID")
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

  // The current Deno Deploy platform does not provide DENO_GIT_* metadata.
  // Prefer our explicit stamp there so a CLI production deploy cannot inherit
  // stale legacy values. Other source-linked providers keep their native Git
  // provenance ahead of manual fallback stamps.
  const gitShaKeys = runtime === "deno-deploy"
    ? [
      "ATMOSPHERE_RELEASE_SHA",
      "DENO_GIT_COMMIT_SHA",
      "GITHUB_SHA",
    ]
    : [
      "RAILWAY_GIT_COMMIT_SHA",
      "GITHUB_SHA",
      "VERCEL_GIT_COMMIT_SHA",
      "RENDER_GIT_COMMIT",
      "ATMOSPHERE_RELEASE_SHA",
    ];
  const gitBranchKeys = runtime === "deno-deploy"
    ? [
      "ATMOSPHERE_RELEASE_BRANCH",
      "DENO_GIT_BRANCH",
      "GITHUB_REF_NAME",
    ]
    : [
      "RAILWAY_GIT_BRANCH",
      "GITHUB_REF_NAME",
      "VERCEL_GIT_COMMIT_REF",
      "RENDER_GIT_BRANCH",
      "ATMOSPHERE_RELEASE_BRANCH",
    ];

  return {
    runtime,
    deploymentId: firstEnv(env, [
      "ATMOSPHERE_RELEASE_ID",
      "DENO_DEPLOYMENT_ID",
      "RAILWAY_DEPLOYMENT_ID",
      "VERCEL_DEPLOYMENT_ID",
      "FLY_ALLOC_ID",
    ]),
    service: firstEnv(env, [
      "ATMOSPHERE_SERVICE_NAME",
      "RAILWAY_SERVICE_NAME",
      "FLY_APP_NAME",
      "VERCEL_PROJECT_PRODUCTION_URL",
    ]),
    gitSha: shortSha(firstEnv(env, gitShaKeys)),
    gitBranch: firstEnv(env, gitBranchKeys),
  };
}

function firstEnv(env: EnvReader, keys: string[]): string | null {
  for (const key of keys) {
    const value = env(key)?.trim();
    if (value) return value;
  }
  return null;
}

function shortSha(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(normalized)
    ? normalized.slice(0, 12)
    : normalized;
}

function readEnv(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}
