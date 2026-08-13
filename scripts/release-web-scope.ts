import {
  parseRailwayWebWatchPatterns,
  railwayWatchEntryMatchesFile,
} from "../lib/web-source-digest.ts";

export interface WebArtifactReleaseScope {
  sourceSha: string;
  webArtifactSha: string;
  /** Inclusive first-parent commits from webArtifactSha through sourceSha. */
  allowedAppviewShas: string[];
}

export function fileMatchesRailwayWatchPattern(
  file: string,
  pattern: string,
): boolean {
  const [entry] = parseRailwayWebWatchPatterns({
    build: { watchPatterns: [pattern] },
  });
  return railwayWatchEntryMatchesFile(file, entry);
}

export function webArtifactChanged(
  files: readonly string[],
  patterns: readonly string[],
): boolean {
  return files.some((file) =>
    patterns.some((pattern) => fileMatchesRailwayWatchPattern(file, pattern))
  );
}

async function main(): Promise<void> {
  const args = Deno.args.filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      [
        "Usage: deno task release:web-changed -- [options]",
        "",
        "Options:",
        "  --sha=<git-sha>              Source commit to inspect (default HEAD)",
        "  --allowed-appview-shas       Print the inclusive first-parent SHA set",
        "  --select-appview-sha=<sha>   Restrict that set to one proven member",
      ].join("\n"),
    );
    return;
  }
  const sha = readFlag(args, "--sha")?.trim() || "HEAD";
  if (!/^(?:HEAD|[0-9a-f]{7,40})$/i.test(sha)) {
    throw new Error("--sha must be HEAD or a 7-40 character Git SHA");
  }
  const config: unknown = JSON.parse(
    await Deno.readTextFile("railway.web.json"),
  );
  const rawPatterns = parseRailwayWebWatchPatterns(config).map((entry) =>
    entry.pattern
  );
  const scope = await webArtifactReleaseScope(
    sha,
    rawPatterns,
  );
  if (!args.includes("--allowed-appview-shas")) {
    if (readFlag(args, "--select-appview-sha")) {
      throw new Error(
        "--select-appview-sha requires --allowed-appview-shas",
      );
    }
    console.log(scope.webArtifactSha);
    return;
  }

  const selected = readFlag(args, "--select-appview-sha")?.trim() ?? "";
  if (!selected) {
    console.log(scope.allowedAppviewShas.join(","));
    return;
  }
  if (!/^[0-9a-f]{7,40}$/i.test(selected)) {
    throw new Error(
      "--select-appview-sha must be a 7-40 character Git SHA",
    );
  }
  const resolved = await resolveCommit(selected);
  console.log(selectAllowedAppviewCommit(scope, resolved));
}

export async function latestWebArtifactCommit(
  sha: string,
  patterns: readonly string[],
): Promise<string> {
  return (await webArtifactReleaseScope(sha, patterns)).webArtifactSha;
}

export async function webArtifactReleaseScope(
  sha: string,
  patterns: readonly string[],
): Promise<WebArtifactReleaseScope> {
  const commits = await firstParentCommits(sha);
  const history: Array<{ sha: string; files: string[] }> = [];
  for (const commit of commits) {
    const files = await changedFilesForCommit(commit);
    history.push({ sha: commit, files });
    if (webArtifactChanged(files, patterns)) {
      const scope = webArtifactReleaseScopeFromHistory(history, patterns);
      if (scope) return scope;
    }
  }
  throw new Error(`no web artifact commit found at or before ${sha}`);
}

export function webArtifactReleaseScopeFromHistory(
  history: ReadonlyArray<{ sha: string; files: readonly string[] }>,
  patterns: readonly string[],
): WebArtifactReleaseScope | null {
  const webArtifactIndex = history.findIndex(({ files }) =>
    webArtifactChanged(files, patterns)
  );
  if (webArtifactIndex < 0 || history.length === 0) return null;
  return {
    sourceSha: history[0].sha,
    webArtifactSha: history[webArtifactIndex].sha,
    // `git rev-list` is newest first. Promotion policy is easier to audit as
    // the inclusive W..SOURCE sequence, oldest to newest.
    allowedAppviewShas: history.slice(0, webArtifactIndex + 1).map((entry) =>
      entry.sha
    ).reverse(),
  };
}

export function selectAllowedAppviewCommit(
  scope: WebArtifactReleaseScope,
  resolvedSha: string,
): string {
  const normalized = resolvedSha.trim().toLowerCase();
  const allowed = scope.allowedAppviewShas.find((sha) =>
    sha.toLowerCase() === normalized
  );
  if (!allowed) {
    throw new Error(
      `selected AppView commit ${resolvedSha} is not in the inclusive ` +
        `first-parent release window ${scope.webArtifactSha}..${scope.sourceSha}`,
    );
  }
  return allowed;
}

export function latestWebArtifactCommitFromHistory(
  history: ReadonlyArray<{ sha: string; files: readonly string[] }>,
  patterns: readonly string[],
): string | null {
  return webArtifactReleaseScopeFromHistory(history, patterns)
    ?.webArtifactSha ?? null;
}

async function firstParentCommits(sha: string): Promise<string[]> {
  return await gitLines(
    firstParentHistoryArgs(sha),
    "could not inspect first-parent release history",
  );
}

export function firstParentHistoryArgs(sha: string): string[] {
  return ["rev-list", "--first-parent", sha];
}

async function changedFilesForCommit(sha: string): Promise<string[]> {
  return await gitLines(
    diffTreeArgsForCommit(sha),
    `could not inspect release scope for ${sha}`,
  );
}

export function diffTreeArgsForCommit(sha: string): string[] {
  return [
    "diff-tree",
    "--root",
    "-m",
    "--first-parent",
    "--no-commit-id",
    "--name-only",
    "-r",
    sha,
  ];
}

async function resolveCommit(sha: string): Promise<string> {
  const resolved = await gitLines(
    ["rev-parse", "--verify", `${sha}^{commit}`],
    `could not resolve selected AppView commit ${sha}`,
  );
  if (resolved.length !== 1 || !/^[0-9a-f]{40}$/i.test(resolved[0])) {
    throw new Error(`could not resolve selected AppView commit ${sha}`);
  }
  return resolved[0];
}

async function gitLines(args: string[], failure: string): Promise<string[]> {
  const output = await new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`${failure}: ${stderr}`);
  }
  return new TextDecoder().decode(output.stdout).split(/\r?\n/).map((file) =>
    file.trim()
  ).filter(Boolean);
}

function readFlag(args: string[], flag: string): string | null {
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

if (import.meta.main) await main();
