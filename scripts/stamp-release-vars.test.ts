import {
  assertCleanWorktreeForRelease,
  assertPushedUpstreamForRelease,
} from "./stamp-release-vars.ts";

function assertThrows(fn: () => void, expected: string): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) {
      throw new Error(`Expected error including ${expected}, got ${message}`);
    }
    return;
  }
  throw new Error("Expected function to throw");
}

function assertIncludes(actual: string, expected: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`Expected output to include ${expected}, got ${actual}`);
  }
}

async function commandText(args: string[]): Promise<string> {
  const output = await new Deno.Command(args[0], {
    args: args.slice(1),
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  const stderr = new TextDecoder().decode(output.stderr).trim();
  if (!output.success) {
    throw new Error(`${args.join(" ")} failed:\n${stderr}`);
  }
  return stdout;
}

Deno.test("release stamp accepts a clean git worktree", () => {
  assertCleanWorktreeForRelease("");
  assertCleanWorktreeForRelease("\n");
});

Deno.test("release stamp rejects dirty git worktrees before write", () => {
  assertThrows(
    () => assertCleanWorktreeForRelease(" M deno.json\n?? scratch.txt\n"),
    "requires a clean git worktree",
  );
});

Deno.test("release stamp accepts HEAD that matches upstream", () => {
  assertPushedUpstreamForRelease("origin/main", "0\t0");
});

Deno.test("release stamp rejects HEAD ahead of upstream", () => {
  assertThrows(
    () => assertPushedUpstreamForRelease("origin/main", "1\t0"),
    "requires HEAD to be pushed",
  );
});

Deno.test("release stamp rejects HEAD behind upstream", () => {
  assertThrows(
    () => assertPushedUpstreamForRelease("origin/main", "0\t2"),
    "requires HEAD to match",
  );
});

Deno.test("release stamp rejects missing upstream", () => {
  assertThrows(
    () => assertPushedUpstreamForRelease("", ""),
    "requires the current branch to have an upstream",
  );
});

Deno.test("release stamp rejects malformed upstream status", () => {
  assertThrows(
    () => assertPushedUpstreamForRelease("origin/main", "not-a-count"),
    "could not read git upstream status",
  );
});

Deno.test("release stamp dry-run ignores release metadata environment defaults", async () => {
  const head = await commandText(["git", "rev-parse", "HEAD"]);
  const branch = await commandText([
    "git",
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-env",
      "--allow-run=git,deno,railway",
      "scripts/stamp-release-vars.ts",
    ],
    env: {
      ATMOSPHERE_RELEASE_SHA: "0000000",
      ATMOSPHERE_RELEASE_BRANCH: "wrong-env-branch",
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  if (!output.success) {
    throw new Error(`release stamp dry-run failed:\n${stderr}`);
  }

  assertIncludes(stdout, `sha=${head}`);
  assertIncludes(stdout, `branch=${branch}`);
});
