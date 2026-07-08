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
