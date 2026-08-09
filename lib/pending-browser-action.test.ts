import {
  isPendingBrowserActionFresh,
  PENDING_BROWSER_ACTION_TTL_MS,
} from "./pending-browser-action.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("pending browser actions expire after the OAuth handoff window", () => {
  const now = 10_000_000;
  assertEquals(isPendingBrowserActionFresh(now, now), true);
  assertEquals(
    isPendingBrowserActionFresh(
      now - PENDING_BROWSER_ACTION_TTL_MS,
      now,
    ),
    true,
  );
  assertEquals(
    isPendingBrowserActionFresh(
      now - PENDING_BROWSER_ACTION_TTL_MS - 1,
      now,
    ),
    false,
  );
});

Deno.test("pending browser actions reject invalid or future timestamps", () => {
  const now = 10_000_000;
  assertEquals(isPendingBrowserActionFresh(undefined, now), false);
  assertEquals(isPendingBrowserActionFresh(Number.NaN, now), false);
  assertEquals(isPendingBrowserActionFresh(now + 1, now), false);
  assertEquals(isPendingBrowserActionFresh(now, now, -1), false);
});
