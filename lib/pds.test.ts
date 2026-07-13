import { isPdsScopeMissingError, PdsRecordWriteError } from "./pds.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("PDS scope failures are distinguishable from other write errors", () => {
  assertEquals(
    isPdsScopeMissingError(
      new PdsRecordWriteError(
        "putRecord",
        403,
        JSON.stringify({
          error: "ScopeMissingError",
          message:
            'Missing required scope "repo:fyi.atstore.listing.favorite?action=create"',
        }),
      ),
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
