import {
  jetstreamDisconnectReason,
  nextReconnectFailureCount,
  RECONNECT_ALERT_FAILURE_THRESHOLD,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_LOG_INTERVAL_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_STABLE_CONNECTION_MS,
  reconnectDelayMs,
  reconnectLogDecision,
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

Deno.test("productive Jetstream disconnects stay informational and are throttled", () => {
  const first = reconnectLogDecision({
    consecutiveFailures: 1,
    connectedForMs: RECONNECT_STABLE_CONNECTION_MS,
    now: 1_000,
    lastLoggedAt: null,
    lastLevel: null,
  });
  if (first.level !== "info" || !first.shouldLog) {
    throw new Error("the first productive disconnect should be logged as info");
  }

  const repeated = reconnectLogDecision({
    consecutiveFailures: 1,
    connectedForMs: RECONNECT_STABLE_CONNECTION_MS,
    now: 2_000,
    lastLoggedAt: 1_000,
    lastLevel: "info",
  });
  if (repeated.level !== "info" || repeated.shouldLog) {
    throw new Error("repeated productive disconnects should be throttled");
  }

  const summary = reconnectLogDecision({
    consecutiveFailures: 1,
    connectedForMs: RECONNECT_STABLE_CONNECTION_MS,
    now: 1_000 + RECONNECT_LOG_INTERVAL_MS,
    lastLoggedAt: 1_000,
    lastLevel: "info",
  });
  if (!summary.shouldLog) {
    throw new Error(
      "a throttled reconnect summary should eventually be logged",
    );
  }
});

Deno.test("short-lived Jetstream reconnect storms escalate once", () => {
  const decision = reconnectLogDecision({
    consecutiveFailures: RECONNECT_ALERT_FAILURE_THRESHOLD,
    connectedForMs: 1_000,
    now: 2_000,
    lastLoggedAt: 1_000,
    lastLevel: "info",
  });
  if (decision.level !== "error" || !decision.shouldLog) {
    throw new Error(
      "a short-lived connection storm should escalate immediately",
    );
  }

  const repeated = reconnectLogDecision({
    consecutiveFailures: RECONNECT_ALERT_FAILURE_THRESHOLD + 1,
    connectedForMs: 1_000,
    now: 3_000,
    lastLoggedAt: 2_000,
    lastLevel: "error",
  });
  if (repeated.level !== "error" || repeated.shouldLog) {
    throw new Error("repeated storm errors should be throttled");
  }
});

Deno.test("Jetstream EOF reasons are normalized for low-cardinality telemetry", () => {
  if (
    jetstreamDisconnectReason("websocket transport error: Unexpected EOF") !==
      "unexpected_eof"
  ) {
    throw new Error("Unexpected EOF should have a stable reason code");
  }
  if (jetstreamDisconnectReason("websocket closed (1000)") !== "clean_close") {
    throw new Error("normal close frames should be classified separately");
  }
});
