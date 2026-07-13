export const RECONNECT_BASE_DELAY_MS = 5_000;
export const RECONNECT_MAX_DELAY_MS = 60_000;
export const RECONNECT_STABLE_CONNECTION_MS = 60_000;

export function reconnectDelayMs(
  consecutiveFailures: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, Math.min(10, consecutiveFailures - 1));
  const unjittered = Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_BASE_DELAY_MS * 2 ** exponent,
  );
  const sample = Math.max(0, Math.min(1, random()));
  const jitter = 0.8 + sample * 0.4;
  return Math.max(1, Math.round(unjittered * jitter));
}

export function nextReconnectFailureCount(input: {
  previous: number;
  connectedForMs: number;
}): number {
  return input.connectedForMs >= RECONNECT_STABLE_CONNECTION_MS
    ? 1
    : Math.min(11, input.previous + 1);
}
