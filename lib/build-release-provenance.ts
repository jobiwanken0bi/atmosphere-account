import { webSourceDigest } from "./web-source-digest.ts";

export interface BuildReleaseProvenance {
  gitSha: string | null;
  gitBranch: string | null;
  artifactDigest: string;
}

interface BuildReleaseProvenanceOptions {
  commandOutput?: (args: string[]) => Promise<string | null>;
  env?: (key: string) => string | undefined;
  sourceDigest?: () => Promise<string>;
}

export async function buildReleaseProvenance(
  options: BuildReleaseProvenanceOptions = {},
): Promise<BuildReleaseProvenance> {
  const runGit = options.commandOutput ?? gitCommandOutput;
  const env = options.env ?? readBuildEnv;
  const artifactDigest = await (options.sourceDigest ?? webSourceDigest)();
  const status = await runGit(["status", "--porcelain"]);
  const repositoryIsUnavailable = status === null;
  const worktreeIsClean = status === "";
  const gitSha = worktreeIsClean
    ? normalizeFullGitSha(
      await runGit(["rev-parse", "--verify", "HEAD^{commit}"]),
    )
    : null;

  const explicitSha = repositoryIsUnavailable
    ? normalizeFullGitSha(
      firstBuildEnv(env, [
        "ATMOSPHERE_BUILD_GIT_SHA",
        "GITHUB_SHA",
        "RAILWAY_GIT_COMMIT_SHA",
      ]),
    )
    : null;
  const rawBranch = worktreeIsClean
    ? await runGit(["rev-parse", "--abbrev-ref", "HEAD"])
    : null;
  const commandBranch = normalizeGitBranch(rawBranch);
  const explicitBranch = repositoryIsUnavailable
    ? normalizeGitBranch(
      firstBuildEnv(env, [
        "ATMOSPHERE_BUILD_GIT_BRANCH",
        "GITHUB_REF_NAME",
        "RAILWAY_GIT_BRANCH",
      ]),
    )
    : null;

  return {
    gitSha: gitSha ?? explicitSha,
    gitBranch: commandBranch ?? explicitBranch,
    artifactDigest,
  };
}

function firstBuildEnv(
  env: (key: string) => string | undefined,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = env(key)?.trim();
    if (value) return value;
  }
  return null;
}

function normalizeFullGitSha(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(normalized) ? normalized : null;
}

function normalizeGitBranch(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (
    !normalized || normalized === "HEAD" || normalized.length > 128 ||
    /\s/.test(normalized)
  ) return null;
  return normalized;
}

async function gitCommandOutput(args: string[]): Promise<string | null> {
  try {
    const output = await new Deno.Command("git", {
      args,
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!output.success) return null;
    return new TextDecoder().decode(output.stdout).trim();
  } catch {
    return null;
  }
}

function readBuildEnv(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}
