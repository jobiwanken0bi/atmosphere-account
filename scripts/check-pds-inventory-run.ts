export const PDS_INVENTORY_SCHEDULE_HOUR_UTC = 8;
export const PDS_INVENTORY_SCHEDULE_MINUTE_UTC = 17;
export const PDS_INVENTORY_DEADLINE_MS = 8 * 60 * 1000;
export const PDS_INVENTORY_HARD_EXIT_GRACE_MS = 15 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SITE_ORIGIN = "https://atmosphereaccount.com";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_READINESS_BYTES = 64 * 1024;

export type PdsInventoryWatchdogOutcome =
  | "target_run_succeeded"
  | "target_run_missing"
  | "target_run_running"
  | "target_run_failed"
  | "target_run_partial"
  | "target_run_inconsistent"
  | "readiness_unavailable";

export interface PdsInventoryRunWindow {
  scheduledAt: number;
  expectedCompleteBy: number;
  nextScheduledAt: number;
}

export interface PdsInventoryWatchdogReport {
  ok: boolean;
  outcome: PdsInventoryWatchdogOutcome;
  targetScheduledAt: string;
  expectedCompleteBy: string;
  observedAt: string;
  latestAttemptStartedAt: string | null;
  latestAttemptCompletedAt: string | null;
  message: string;
}

interface EvaluationOptions {
  observedAt: number;
  referenceAt?: number;
  targetDateUtc?: string | null;
}

interface ParsedAttempt {
  status: "running" | "succeeded" | "failed";
  complete: boolean;
  startedAt: number;
  completedAt: number | null;
}

function readFlag(args: string[], flag: string): string | null {
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDateUtc(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function scheduleForDateUtc(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("target UTC date must use YYYY-MM-DD");
  }
  const scheduledAt = Date.parse(
    `${date}T${String(PDS_INVENTORY_SCHEDULE_HOUR_UTC).padStart(2, "0")}:` +
      `${String(PDS_INVENTORY_SCHEDULE_MINUTE_UTC).padStart(2, "0")}:00.000Z`,
  );
  if (!Number.isFinite(scheduledAt) || formatDateUtc(scheduledAt) !== date) {
    throw new Error("target UTC date must be a real calendar date");
  }
  return scheduledAt;
}

const SCHEDULED_TARGET_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function scheduledTargetTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !SCHEDULED_TARGET_PATTERN.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : null;
}

/** A failure may replace the active alert only when it is at least as new. */
export function inventoryAlertMayAdvance(
  activeTarget: unknown,
  candidateTarget: unknown,
): boolean {
  const candidate = scheduledTargetTimestamp(candidateTarget);
  if (candidate == null) return false;
  const active = scheduledTargetTimestamp(activeTarget);
  return active == null || candidate >= active;
}

/** A success may close only the same or an older active failure generation. */
export function inventoryAlertMayClose(
  activeTarget: unknown,
  successfulTarget: unknown,
): boolean {
  const active = scheduledTargetTimestamp(activeTarget);
  const success = scheduledTargetTimestamp(successfulTarget);
  return active != null && success != null && success >= active;
}

/**
 * Resolve the scheduled inventory run associated with a watchdog invocation.
 * `referenceAt` should be the GitHub Actions run creation time. Keeping it
 * separate from `observedAt` makes queued jobs and reruns stable across UTC day
 * boundaries.
 */
export function pdsInventoryRunWindow(input: {
  referenceAt: number;
  targetDateUtc?: string | null;
}): PdsInventoryRunWindow {
  if (!Number.isFinite(input.referenceAt)) {
    throw new Error("watchdog reference time must be a valid timestamp");
  }
  let scheduledAt = input.targetDateUtc
    ? scheduleForDateUtc(input.targetDateUtc)
    : scheduleForDateUtc(formatDateUtc(input.referenceAt));
  if (!input.targetDateUtc && scheduledAt > input.referenceAt) {
    scheduledAt -= DAY_MS;
  }
  return {
    scheduledAt,
    expectedCompleteBy: scheduledAt + PDS_INVENTORY_DEADLINE_MS +
      PDS_INVENTORY_HARD_EXIT_GRACE_MS,
    nextScheduledAt: scheduledAt + DAY_MS,
  };
}

function report(
  window: PdsInventoryRunWindow,
  observedAt: number,
  outcome: PdsInventoryWatchdogOutcome,
  message: string,
  attempt: ParsedAttempt | null = null,
): PdsInventoryWatchdogReport {
  return {
    ok: outcome === "target_run_succeeded",
    outcome,
    targetScheduledAt: new Date(window.scheduledAt).toISOString(),
    expectedCompleteBy: new Date(window.expectedCompleteBy).toISOString(),
    observedAt: new Date(observedAt).toISOString(),
    latestAttemptStartedAt: attempt
      ? new Date(attempt.startedAt).toISOString()
      : null,
    latestAttemptCompletedAt: attempt?.completedAt == null
      ? null
      : new Date(attempt.completedAt).toISOString(),
    message,
  };
}

function parsedAttempt(value: unknown): ParsedAttempt | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  if (status !== "running" && status !== "succeeded" && status !== "failed") {
    return null;
  }
  const startedAt = parseTimestamp(value.startedAt);
  if (startedAt == null) return null;
  return {
    status,
    complete: value.complete === true,
    startedAt,
    completedAt: value.completedAt == null
      ? null
      : parseTimestamp(value.completedAt),
  };
}

/**
 * Validate the public readiness heartbeat for one particular daily run.
 * General `fresh: true` is deliberately insufficient: both the latest attempt
 * and the last complete scan must identify the target run's completion.
 */
export function evaluatePdsInventoryRun(
  value: unknown,
  options: EvaluationOptions,
): PdsInventoryWatchdogReport {
  const referenceAt = options.referenceAt ?? options.observedAt;
  const window = pdsInventoryRunWindow({
    referenceAt,
    targetDateUtc: options.targetDateUtc,
  });
  if (!Number.isFinite(options.observedAt)) {
    throw new Error("watchdog observation time must be a valid timestamp");
  }
  if (!isRecord(value) || !isRecord(value.pdsInventory)) {
    return report(
      window,
      options.observedAt,
      "readiness_unavailable",
      "Readiness did not include PDS inventory health.",
    );
  }

  const inventory = value.pdsInventory;
  const attempt = parsedAttempt(inventory.latestAttempt);
  if (!attempt) {
    return report(
      window,
      options.observedAt,
      "target_run_missing",
      "No valid inventory attempt was reported for the target run.",
    );
  }
  if (
    attempt.startedAt < window.scheduledAt ||
    attempt.startedAt > window.expectedCompleteBy ||
    attempt.startedAt > options.observedAt
  ) {
    return report(
      window,
      options.observedAt,
      "target_run_missing",
      "The latest inventory attempt belongs to a different daily run.",
      attempt,
    );
  }
  if (attempt.status === "running") {
    return report(
      window,
      options.observedAt,
      "target_run_running",
      "The target inventory run has not completed.",
      attempt,
    );
  }
  if (attempt.status === "failed") {
    return report(
      window,
      options.observedAt,
      "target_run_failed",
      "The target inventory run failed.",
      attempt,
    );
  }
  if (!attempt.complete) {
    return report(
      window,
      options.observedAt,
      "target_run_partial",
      "The target inventory run stopped before the relay's final page.",
      attempt,
    );
  }

  const completedAt = attempt.completedAt;
  const completeScanAt = parseTimestamp(inventory.completedAt);
  const validScanId = typeof inventory.scanId === "string" &&
    inventory.scanId.length > 0;
  const validPages = typeof inventory.pages === "number" &&
    Number.isSafeInteger(inventory.pages) && inventory.pages > 0;
  const validInstanceCount = typeof inventory.instanceCount === "number" &&
    Number.isSafeInteger(inventory.instanceCount) &&
    inventory.instanceCount > 0;
  if (
    completedAt == null || completedAt < attempt.startedAt ||
    completedAt > options.observedAt ||
    completedAt >= window.nextScheduledAt ||
    completeScanAt !== completedAt ||
    inventory.present !== true || inventory.fresh !== true ||
    !validScanId || !validPages || !validInstanceCount
  ) {
    return report(
      window,
      options.observedAt,
      "target_run_inconsistent",
      "The target attempt is not the authoritative fresh complete inventory scan.",
      attempt,
    );
  }

  return report(
    window,
    options.observedAt,
    "target_run_succeeded",
    "The target inventory run completed successfully.",
    attempt,
  );
}

function unavailableReport(
  options: EvaluationOptions,
  message: string,
): PdsInventoryWatchdogReport {
  const window = pdsInventoryRunWindow({
    referenceAt: options.referenceAt ?? options.observedAt,
    targetDateUtc: options.targetDateUtc,
  });
  return report(
    window,
    options.observedAt,
    "readiness_unavailable",
    message,
  );
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_READINESS_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("readiness response was too large");
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_READINESS_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("readiness response was too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function parseReferenceTime(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("reference time must be an ISO timestamp");
  }
  return parsed;
}

function siteOrigin(value: string): URL {
  const origin = new URL(value);
  if (
    (origin.protocol !== "https:" && origin.protocol !== "http:") ||
    origin.username || origin.password || origin.pathname !== "/" ||
    origin.search || origin.hash
  ) {
    throw new Error(
      "site origin must be an HTTP(S) origin without credentials or a path",
    );
  }
  return origin;
}

export async function main(): Promise<void> {
  const args = Deno.args.filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: deno task pds-inventory:watchdog [--site-origin=URL] " +
        "[--reference-time=ISO] [--target-date-utc=YYYY-MM-DD]",
    );
    return;
  }

  const observedAt = Date.now();
  let options: EvaluationOptions = { observedAt };
  let result: PdsInventoryWatchdogReport;
  try {
    options = {
      observedAt,
      referenceAt: parseReferenceTime(
        readFlag(args, "--reference-time"),
        observedAt,
      ),
      targetDateUtc: readFlag(args, "--target-date-utc"),
    };
    const origin = siteOrigin(
      readFlag(args, "--site-origin") ??
        Deno.env.get("SMOKE_SITE_ORIGIN") ??
        DEFAULT_SITE_ORIGIN,
    );
    const url = new URL("/api/health/ready", origin);
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "atmosphere-pds-inventory-watchdog/1.0",
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      result = unavailableReport(
        options,
        `Readiness returned HTTP ${response.status}.`,
      );
    } else {
      result = evaluatePdsInventoryRun(
        await readJsonResponse(response),
        options,
      );
    }
  } catch (error) {
    try {
      result = unavailableReport(
        options,
        error instanceof SyntaxError
          ? "Readiness returned invalid JSON."
          : "The readiness request or watchdog configuration failed.",
      );
    } catch {
      const fallback = pdsInventoryRunWindow({ referenceAt: observedAt });
      result = report(
        fallback,
        observedAt,
        "readiness_unavailable",
        "The readiness request or watchdog configuration failed.",
      );
    }
  }

  console.log(JSON.stringify(result));
  if (!result.ok) Deno.exitCode = 1;
}

if (import.meta.main) await main();
