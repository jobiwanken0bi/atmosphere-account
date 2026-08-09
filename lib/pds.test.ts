import {
  isPdsScopeMissingError,
  PdsRecordWriteError,
  readPdsErrorBodyForTest,
} from "./pds.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("PDS scope failures are distinguishable from other write errors", () => {
  const scopeErrorBody = JSON.stringify({
    error: "ScopeMissingError",
    message:
      'Missing required scope "repo:fyi.atstore.listing.favorite?action=create"',
  });
  assertEquals(
    isPdsScopeMissingError(
      new PdsRecordWriteError(
        "createRecord",
        403,
        scopeErrorBody,
      ),
    ),
    true,
  );
  assertEquals(
    isPdsScopeMissingError(
      new PdsRecordWriteError("putRecord", 403, scopeErrorBody),
    ),
    true,
  );
  assertEquals(
    isPdsScopeMissingError(
      new PdsRecordWriteError("putRecord", 500, "upstream failure"),
    ),
    false,
  );
});

Deno.test("PDS error bodies are bounded before custom errors retain them", async () => {
  const oversized = await readPdsErrorBodyForTest(
    new Response("x".repeat(9 * 1024)),
  );
  assertEquals(oversized, "response too large");
});
