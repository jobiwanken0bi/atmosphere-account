interface Options {
  sha: string;
  branch: string;
  write: boolean;
  allowDirty: boolean;
  allowUnpushed: boolean;
  explicitSha: boolean;
  deno: boolean;
  railway: boolean;
  denoOrg: string;
  denoApp: string;
  railwayProject: string;
  railwayEnvironment: string;
  railwayService: string;
}

const DEFAULT_DENO_ORG = "atmospheremoney";
const DEFAULT_DENO_APP = "atmosphere-account";
const DEFAULT_RAILWAY_PROJECT = "f6fc622b-1fff-469e-9bb2-42210ac4a70c";
const DEFAULT_RAILWAY_ENVIRONMENT = "production";
const DEFAULT_RAILWAY_SERVICE = "web";

if (import.meta.main) {
  const options = await parseOptions();
  if (options.write && !options.allowDirty) {
    assertCleanWorktreeForRelease(await git(["status", "--porcelain"]));
  }
  if (options.write && !options.allowUnpushed && !options.explicitSha) {
    await assertCurrentHeadPushedForRelease();
  }
  const releaseVars = [
    ["ATMOSPHERE_RELEASE_SHA", options.sha],
    ["ATMOSPHERE_RELEASE_BRANCH", options.branch],
  ] as const;

  console.log(
    `[release:stamp] ${
      options.write ? "writing" : "dry-run"
    } sha=${options.sha} branch=${options.branch}`,
  );

  if (options.deno) await stampDenoDeploy(options, releaseVars);
  if (options.railway) await stampRailway(options, releaseVars);

  if (!options.write) {
    console.log(
      "[release:stamp] dry-run only; pass --write to update providers.",
    );
  }

  console.log(
    "[release:stamp] deploy both Deno shell and Railway appview before running exact production smoke.",
  );
}

async function parseOptions(): Promise<Options> {
  const args = Deno.args.filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) usage(0);

  const denoOnly = args.includes("--deno");
  const railwayOnly = args.includes("--railway");
  const shaFlag = readFlag(args, "--sha");
  const sha = normalizeSha(
    shaFlag ?? env("ATMOSPHERE_RELEASE_SHA") ??
      await git(["rev-parse", "HEAD"]),
  );
  const branch = normalizeBranch(
    readFlag(args, "--branch") ?? env("ATMOSPHERE_RELEASE_BRANCH") ??
      await git(["rev-parse", "--abbrev-ref", "HEAD"]),
  );

  return {
    sha,
    branch,
    write: args.includes("--write"),
    allowDirty: args.includes("--allow-dirty"),
    allowUnpushed: args.includes("--allow-unpushed"),
    explicitSha: !!shaFlag,
    deno: denoOnly || !railwayOnly,
    railway: railwayOnly || !denoOnly,
    denoOrg: readFlag(args, "--deno-org") ?? env("DENO_DEPLOY_ORG") ??
      DEFAULT_DENO_ORG,
    denoApp: readFlag(args, "--deno-app") ?? env("DENO_DEPLOY_APP") ??
      DEFAULT_DENO_APP,
    railwayProject: readFlag(args, "--railway-project") ??
      env("RAILWAY_PROJECT_ID") ?? DEFAULT_RAILWAY_PROJECT,
    railwayEnvironment: readFlag(args, "--railway-environment") ??
      env("RAILWAY_ENVIRONMENT") ?? DEFAULT_RAILWAY_ENVIRONMENT,
    railwayService: readFlag(args, "--railway-service") ??
      env("RAILWAY_SERVICE_NAME") ?? DEFAULT_RAILWAY_SERVICE,
  };
}

function usage(exitCode: number): never {
  const write = exitCode === 0 ? console.log : console.error;
  write([
    "Usage: deno task release:stamp [options]",
    "",
    "Stamps ATMOSPHERE_RELEASE_SHA and ATMOSPHERE_RELEASE_BRANCH on Deno Deploy",
    "and Railway so exact production smoke can prove the shell and appview are",
    "serving the same release. Dry-run by default.",
    "",
    "Options:",
    "  --write                         Update provider variables",
    "  --allow-dirty                   Allow --write with uncommitted changes",
    "  --allow-unpushed                Allow --write despite missing/mismatched upstream",
    "  --deno                          Stamp only Deno Deploy",
    "  --railway                       Stamp only Railway",
    "  --sha=<git-sha>                 Release SHA, defaults to git rev-parse HEAD",
    "  --branch=<branch>               Release branch, defaults to current branch",
    "  --deno-org=<name>               Deno Deploy org",
    "  --deno-app=<name>               Deno Deploy app",
    "  --railway-project=<id>          Railway project ID",
    "  --railway-environment=<name>    Railway environment",
    "  --railway-service=<name>        Railway service",
  ].join("\n"));
  Deno.exit(exitCode);
}

export function assertCleanWorktreeForRelease(statusPorcelain: string): void {
  if (!statusPorcelain.trim()) return;
  throw new Error(
    [
      "release:stamp --write requires a clean git worktree.",
      "Commit or stash local changes before stamping a production release,",
      "or pass --allow-dirty if you intentionally want release metadata to point at HEAD while deploying local edits.",
    ].join(" "),
  );
}

export function assertPushedUpstreamForRelease(
  upstream: string,
  aheadBehind: string,
): void {
  const upstreamRef = upstream.trim();
  if (!upstreamRef) {
    throw new Error(
      [
        "release:stamp --write requires the current branch to have an upstream.",
        "Push the release branch or pass --allow-unpushed if you intentionally want to stamp a local-only commit.",
      ].join(" "),
    );
  }
  const [aheadText, behindText] = aheadBehind.trim().split(/\s+/, 2);
  const ahead = Number(aheadText);
  const behind = Number(behindText);
  if (
    !Number.isInteger(ahead) || ahead < 0 ||
    !Number.isInteger(behind) || behind < 0
  ) {
    throw new Error(
      `could not read git upstream status for ${upstreamRef}: ${aheadBehind}`,
    );
  }
  if (ahead === 0 && behind === 0) return;
  if (behind > 0 && ahead === 0) {
    throw new Error(
      [
        `release:stamp --write requires HEAD to match ${upstreamRef}.`,
        `HEAD is ${behind} commit${behind === 1 ? "" : "s"} behind upstream.`,
        "Pull or rebase the release branch before stamping production,",
        "or pass --allow-unpushed/--sha for an intentional older deployed release.",
      ].join(" "),
    );
  }
  throw new Error(
    [
      `release:stamp --write requires HEAD to be pushed to ${upstreamRef}.`,
      `HEAD is ${ahead} commit${ahead === 1 ? "" : "s"} ahead of upstream.`,
      "Push the release commit before stamping production,",
      "or pass --allow-unpushed if you intentionally want to stamp a local-only commit.",
    ].join(" "),
  );
}

async function assertCurrentHeadPushedForRelease(): Promise<void> {
  const upstream = await run([
    "git",
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ], { allowFailure: true });
  if (!upstream.success) {
    assertPushedUpstreamForRelease("", "");
  }
  const aheadBehind = await git([
    "rev-list",
    "--left-right",
    "--count",
    "HEAD...@{u}",
  ]);
  assertPushedUpstreamForRelease(upstream.stdout, aheadBehind);
}

async function stampDenoDeploy(
  options: Options,
  vars: readonly (readonly [string, string])[],
): Promise<void> {
  console.log(
    `[release:stamp] Deno Deploy org=${options.denoOrg} app=${options.denoApp}`,
  );
  for (const [key, value] of vars) {
    const updateArgs = [
      "deploy",
      "env",
      "update-value",
      key,
      value,
      "--org",
      options.denoOrg,
      "--app",
      options.denoApp,
      "--quiet",
    ];
    if (!options.write) {
      console.log(`  deno ${updateArgs.join(" ")}`);
      continue;
    }
    const updated = await run(["deno", ...updateArgs], { allowFailure: true });
    if (updated.success) {
      console.log(`  updated ${key}`);
      continue;
    }
    const addArgs = [
      "deploy",
      "env",
      "add",
      key,
      value,
      "--org",
      options.denoOrg,
      "--app",
      options.denoApp,
      "--quiet",
    ];
    const added = await run(["deno", ...addArgs], { allowFailure: true });
    if (!added.success) {
      throw new Error(
        `failed to update or add ${key} on Deno Deploy:\n${updated.stderr}\n${added.stderr}`,
      );
    }
    console.log(`  added ${key}`);
  }
}

async function stampRailway(
  options: Options,
  vars: readonly (readonly [string, string])[],
): Promise<void> {
  const args = [
    "railway",
    "variable",
    "set",
    ...vars.map(([key, value]) => `${key}=${value}`),
    "--service",
    options.railwayService,
    "--project",
    options.railwayProject,
    "--environment",
    options.railwayEnvironment,
    "--skip-deploys",
  ];
  console.log(
    `[release:stamp] Railway project=${options.railwayProject} environment=${options.railwayEnvironment} service=${options.railwayService}`,
  );
  if (!options.write) {
    console.log(`  ${args.join(" ")}`);
    return;
  }
  await run(args);
  console.log(`  set ${vars.length} variables`);
}

async function run(
  args: string[],
  options: { allowFailure?: boolean } = {},
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const command = new Deno.Command(args[0], {
    args: args.slice(1),
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  const stderr = new TextDecoder().decode(output.stderr).trim();
  if (!output.success && !options.allowFailure) {
    throw new Error(`${args[0]} ${args.slice(1).join(" ")} failed:\n${stderr}`);
  }
  return { success: output.success, stdout, stderr };
}

async function git(args: string[]): Promise<string> {
  const result = await run(["git", ...args]);
  return result.stdout;
}

function readFlag(args: string[], flag: string): string | null {
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function normalizeSha(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(normalized)) {
    throw new Error("release SHA must be a 7-40 character git SHA");
  }
  return normalized;
}

function normalizeBranch(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || /\s/.test(normalized)) {
    throw new Error(
      "release branch must be non-empty and contain no whitespace",
    );
  }
  return normalized;
}

function env(key: string): string | null {
  try {
    return Deno.env.get(key) ?? null;
  } catch {
    return null;
  }
}
