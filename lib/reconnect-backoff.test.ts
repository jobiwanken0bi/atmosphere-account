import {
  nextReconnectFailureCount,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_STABLE_CONNECTION_MS,
  reconnectDelayMs,
} from "./reconnect-backoff.ts";

Deno.test("Jetstream reconnect backoff grows, jitters, and caps", () => {
  const midpoint = () => 0.5;
  const delays = [1, 2, 3, 4, 8].map((failures) =>
    reconnectDelayMs(failures, midpoint)
  );
  const expected = [5_000, 10_000, 20_000, 40_000, 60_000];
  if (JSON.stringify(delays) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(delays)}`,
    );
  }
  if (reconnectDelayMs(8, () => 1) > RECONNECT_MAX_DELAY_MS * 1.2) {
    throw new Error("jittered delay exceeded the capped range");
  }
  if (reconnectDelayMs(1, () => 0.5) !== RECONNECT_BASE_DELAY_MS) {
    throw new Error("first reconnect should use the base delay");
  }
});

Deno.test("a stable Jetstream connection resets consecutive failures", () => {
  if (
    nextReconnectFailureCount({
      previous: 5,
      connectedForMs: RECONNECT_STABLE_CONNECTION_MS,
    }) !== 1
  ) {
    throw new Error("stable connections should reset the backoff sequence");
  }
  if (nextReconnectFailureCount({ previous: 2, connectedForMs: 1_000 }) !== 3) {
    throw new Error("short connections should increase the backoff sequence");
  }
});
