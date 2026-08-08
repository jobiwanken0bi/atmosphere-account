import {
  isPdsScopeMissingError,
  PdsBlobUploadError,
  PdsRecordReadError,
  PdsRecordWriteError,
} from "./pds.ts";

export type ProfilePdsOperation = "read" | "write" | "avatar";

export interface ProfilePdsFailure {
  code:
    | "reconnect_required"
    | "rate_limited"
    | "timeout"
    | "upstream_unavailable"
    | "rejected";
  status: number;
  message: string;
  retryable: boolean;
  retryAfter: string | null;
  /** A timed-out write may have reached the PDS even without a response. */
  outcomeUncertain: boolean;
}

type PdsHttpError =
  | PdsRecordReadError
  | PdsRecordWriteError
  | PdsBlobUploadError;

export function classifyProfilePdsFailure(
  error: unknown,
  operation: ProfilePdsOperation,
): ProfilePdsFailure {
  if (isPdsScopeMissingError(error) || isReconnectFailure(error)) {
    return {
      code: "reconnect_required",
      status: 409,
      message: "Reconnect your Atmosphere account before saving this profile.",
      retryable: false,
      retryAfter: null,
      outcomeUncertain: false,
    };
  }

  const http = pdsHttpError(error);
  if (http?.status === 429) {
    return {
      code: "rate_limited",
      status: 503,
      message:
        "Your account host is handling too many requests. Wait a moment and try again.",
      retryable: true,
      retryAfter: safeRetryAfter(http.retryAfter),
      outcomeUncertain: false,
    };
  }

  if (isTimeoutFailure(error) || http?.status === 408 || http?.status === 504) {
    return {
      code: "timeout",
      status: 504,
      message: operation === "write"
        ? "Your account host did not confirm the profile save. Refresh before trying again."
        : operation === "avatar"
        ? "The avatar upload took too long. Try again."
        : "Your profile took too long to load from your account host. Try again.",
      retryable: operation !== "write",
      retryAfter: safeRetryAfter(http?.retryAfter ?? null),
      outcomeUncertain: operation === "write",
    };
  }

  if (
    isNetworkFailure(error) ||
    (http != null && http.status >= 500 && http.status <= 599) ||
    error instanceof SyntaxError
  ) {
    return {
      code: "upstream_unavailable",
      status: 502,
      message: operation === "write"
        ? "Your account host could not confirm the profile save. Refresh before trying again."
        : operation === "avatar"
        ? "Your account host could not accept the avatar. Try again."
        : "Your profile is temporarily unavailable from your account host. Try again.",
      retryable: operation !== "write",
      retryAfter: safeRetryAfter(http?.retryAfter ?? null),
      outcomeUncertain: operation === "write",
    };
  }

  return {
    code: "rejected",
    status: 422,
    message: operation === "avatar"
      ? "Your account host rejected that avatar. Try another image."
      : operation === "read"
      ? "Your account host rejected the profile request. Reconnect your account and try again."
      : "Your account host rejected this profile update. Check the fields and try again.",
    retryable: false,
    retryAfter: null,
    outcomeUncertain: false,
  };
}

export async function retryTransientProfileRead<T>(
  read: () => Promise<T>,
  options: {
    wait?: (delayMs: number) => Promise<void>;
    delayMs?: number;
  } = {},
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const failure = classifyProfilePdsFailure(error, "read");
    // Retry only failures that commonly fail fast (a reset connection or an
    // immediate 5xx). A timeout has already consumed the request budget, and a
    // 429 must honor the PDS Retry-After response instead of retrying early.
    if (failure.code !== "upstream_unavailable" || failure.retryAfter) {
      throw error;
    }
    const wait = options.wait ??
      ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    await wait(options.delayMs ?? 125);
    return await read();
  }
}

export function profilePdsFailureResponse(
  operation: ProfilePdsOperation,
  error: unknown,
): Response {
  const failure = classifyProfilePdsFailure(error, operation);
  const log = failure.code === "reconnect_required" ||
      failure.code === "rejected"
    ? console.info
    : console.warn;
  // Keep exception-derived data out of logs. OAuth/session errors can retain
  // configuration context even when their public response is already safe.
  log("[profile] PDS request failed");

  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-atmosphere-error-code": failure.code,
  });
  if (failure.retryAfter) headers.set("retry-after", failure.retryAfter);
  return new Response(failure.message, { status: failure.status, headers });
}

function pdsHttpError(error: unknown): PdsHttpError | null {
  return error instanceof PdsRecordReadError ||
      error instanceof PdsRecordWriteError ||
      error instanceof PdsBlobUploadError
    ? error
    : null;
}

function isReconnectFailure(error: unknown): boolean {
  if (
    pdsHttpError(error)?.status === 401 || pdsHttpError(error)?.status === 403
  ) {
    return true;
  }
  return error instanceof Error && /\bno session for\b/i.test(error.message);
}

function isTimeoutFailure(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError" ||
    error instanceof Error && error.name === "TimeoutError";
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

function safeRetryAfter(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{1,6}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toUTCString() : null;
}
