interface RailwayWebConfig {
  build?: { watchPatterns?: unknown };
}

export function fileMatchesRailwayWatchPattern(
  file: string,
  pattern: string,
): boolean {
  const normalizedFile = file.replace(/^\/+/, "");
  const normalizedPattern = pattern.replace(/^\/+/, "");
  if (!normalizedFile || !normalizedPattern) return false;
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3).replace(/\/+$/, "");
    return normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`);
  }
  return normalizedFile === normalizedPattern;
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
  const sha = readFlag(Deno.args, "--sha")?.trim() || "HEAD";
  if (!/^(?:HEAD|[0-9a-f]{7,40})$/i.test(sha)) {
    throw new Error("--sha must be HEAD or a 7-40 character Git SHA");
  }
  const config = JSON.parse(
    await Deno.readTextFile("railway.web.json"),
  ) as RailwayWebConfig;
  const rawPatterns = config.build?.watchPatterns;
  if (
    !Array.isArray(rawPatterns) || rawPatterns.length === 0 ||
    rawPatterns.some((value) => typeof value !== "string")
  ) {
    throw new Error("railway.web.json must define string watchPatterns");
  }
  const files = await changedFilesForCommit(sha);
  console.log(
    webArtifactChanged(files, rawPatterns as string[]) ? "true" : "false",
  );
}

async function changedFilesForCommit(sha: string): Promise<string[]> {
  const output = await new Deno.Command("git", {
    args: [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "--first-parent",
      sha,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`could not inspect release scope: ${stderr}`);
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
