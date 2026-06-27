import { createAtprotoTid, isAtprotoTid } from "./tid.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("createAtprotoTid returns a valid sortable TID", () => {
  const first = createAtprotoTid(1_800_000_000_000);
  const second = createAtprotoTid(1_800_000_000_000);

  assertEquals(first.length, 13);
  assert(isAtprotoTid(first), `expected valid TID, got ${first}`);
  assert(isAtprotoTid(second), `expected valid TID, got ${second}`);
  assert(first < second, "expected TIDs created in order to sort in order");
});

Deno.test("isAtprotoTid rejects non-TID rkeys", () => {
  assert(!isAtprotoTid("reader.example"));
  assert(!isAtprotoTid("3lx"));
  assert(!isAtprotoTid("zzzzzzzzzzzzzz"));
});
