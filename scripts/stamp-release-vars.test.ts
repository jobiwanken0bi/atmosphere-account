import { assertCleanWorktreeForRelease } from "./stamp-release-vars.ts";

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
