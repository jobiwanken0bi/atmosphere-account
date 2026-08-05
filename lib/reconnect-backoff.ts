export const RECONNECT_BASE_DELAY_MS = 5_000;
export const RECONNECT_MAX_DELAY_MS = 60_000;
export const RECONNECT_STABLE_CONNECTION_MS = 60_000;
export const RECONNECT_LOG_INTERVAL_MS = 5 * 60_000;
export const RECONNECT_ALERT_FAILURE_THRESHOLD = 5;

export type ReconnectLogLevel = "info" | "error";

export interface ReconnectLogDecision {
  level: ReconnectLogLevel;
  shouldLog: boolean;
}

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

/**
 * A relay ending a productive WebSocket is expected network churn, not an
 * application error. Escalate only when several connections die before the
 * stable-connection threshold, and throttle both levels to avoid alert storms.
 */
export function reconnectLogDecision(input: {
  consecutiveFailures: number;
  connectedForMs: number;
  now: number;
  lastLoggedAt: number | null;
  lastLevel: ReconnectLogLevel | null;
}): ReconnectLogDecision {
  const level = input.connectedForMs < RECONNECT_STABLE_CONNECTION_MS &&
      input.consecutiveFailures >= RECONNECT_ALERT_FAILURE_THRESHOLD
    ? "error"
    : "info";
  const levelEscalated = level === "error" && input.lastLevel !== "error";
  return {
    level,
    shouldLog: input.lastLoggedAt == null || levelEscalated ||
      input.now - input.lastLoggedAt >= RECONNECT_LOG_INTERVAL_MS,
  };
}

export function jetstreamDisconnectReason(message: string):
  | "unexpected_eof"
  | "clean_close"
  | "websocket_close"
  | "transport_error" {
  if (/unexpected eof|close_notify/i.test(message)) return "unexpected_eof";
  if (/websocket closed \(1000\b/i.test(message)) return "clean_close";
  if (/websocket closed/i.test(message)) return "websocket_close";
  return "transport_error";
}
