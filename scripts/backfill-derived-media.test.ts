import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { parseBackfillDerivedMediaArgs } from "./backfill-derived-media.ts";

Deno.test("derived-media backfill defaults to an unlimited non-purge copy", () => {
  assertEquals(parseBackfillDerivedMediaArgs([]), {
    limit: Number.POSITIVE_INFINITY,
    purgeSource: false,
  });
});

Deno.test("derived-media backfill parses both supported limit forms", () => {
  assertEquals(parseBackfillDerivedMediaArgs(["--limit=50"]), {
    limit: 50,
    purgeSource: false,
  });
  assertEquals(
    parseBackfillDerivedMediaArgs(["--purge-source", "--limit", "25"]),
    { limit: 25, purgeSource: true },
  );
});

Deno.test("derived-media backfill rejects missing limit values", () => {
  assertThrows(
    () => parseBackfillDerivedMediaArgs(["--limit"]),
    Error,
    "--limit requires a value",
  );
  assertThrows(
    () => parseBackfillDerivedMediaArgs(["--limit", "--purge-source"]),
    Error,
    "--limit requires a value",
  );
});

Deno.test("derived-media backfill rejects invalid and unsafe limits", () => {
  for (
    const value of [
      "",
      "0",
      "-1",
      "1.5",
      "1e3",
      "abc",
      String(Number.MAX_SAFE_INTEGER + 1),
    ]
  ) {
    assertThrows(
      () => parseBackfillDerivedMediaArgs([`--limit=${value}`]),
      Error,
      "--limit must be a positive safe integer",
    );
  }
});

Deno.test("derived-media backfill rejects unknown and duplicate arguments", () => {
  assertThrows(
    () => parseBackfillDerivedMediaArgs(["--purge"]),
    Error,
    "Unknown argument",
  );
  assertThrows(
    () => parseBackfillDerivedMediaArgs(["50"]),
    Error,
    "Unknown argument",
  );
  assertThrows(
    () => parseBackfillDerivedMediaArgs(["--limit=5", "--limit", "10"]),
    Error,
    "--limit may only be provided once",
  );
  assertThrows(
    () =>
      parseBackfillDerivedMediaArgs([
        "--purge-source",
        "--purge-source",
      ]),
    Error,
    "--purge-source may only be provided once",
  );
});
