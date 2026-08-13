import { loadDotEnvIfPresent } from "../lib/cli-env.ts";
import {
  fetchRelayPdsInventory,
  persistRelayPdsInventory,
  summarizeRelayPdsInventory,
} from "../lib/pds-relay-inventory.ts";
import {
  DEFAULT_PUBLIC_HOST_ENRICHMENT_LIMIT,
  enrichObservedAccountHostPublicIntent,
} from "../lib/account-host-public-intent.ts";
import { maintainAccountHostDirectory } from "../lib/account-hosts.ts";
import {
  failPdsInventoryScan,
  finishPdsInventoryScan,
  startPdsInventoryScan,
} from "../lib/pds-inventory-health.ts";
import {
  releaseWorkerLease,
  renewWorkerLease,
  tryAcquireWorkerLease,
} from "../lib/worker-lease.ts";
import { withDb } from "../lib/db.ts";
import { closePostgresExecuteClient } from "../lib/postgres.ts";

export const DEFAULT_PDS_INVENTORY_DEADLINE_MS = 8 * 60 * 1000;
const MAX_PDS_INVENTORY_DEADLINE_MS = 30 * 60 * 1000;
const MIN_PDS_INVENTORY_DEADLINE_MS = 1_000;
const HARD_EXIT_GRACE_MS = 15_000;
const LEASE_NAME = "pds-relay-inventory";
const LEASE_RENEW_INTERVAL_MS = 30_000;
const LEASE_EXPIRY_GRACE_MS = 2 * 60 * 1000;

interface InventoryCliOptions {
  pageSize: number;
  maxPages?: number;
  enrichmentLimit: number;
  deadlineMs: number;
  dryRun: boolean;
  allowLargeDrop: boolean;
  skipEnrichment: boolean;
}

class InventoryLeaseUnavailableError extends Error {
  constructor() {
    super("another inventory run owns the lease");
    this.name = "InventoryLeaseUnavailableError";
  }
}

function usage(exitCode = 0): never {
  const write = exitCode === 0 ? console.log : console.error;
  write(
    [
      "Usage: deno task pds:index [--dry-run] [--limit=1000] [--max-pages=N] [--deadline-ms=N] [--allow-large-drop] [--skip-enrichment] [--enrichment-limit=N]",
      "",
      "Fetches the PDS inventory exposed by bsky.network's listHosts API.",
      "The default full scan normally needs only a handful of HTTP requests",
      "and stores one row per PDS instance. Bluesky mushroom PDS account",
      "counts are aggregated into the single bsky.network account host.",
      "",
      "Options:",
      "  --dry-run       Fetch and summarize without writing to the database.",
      "  --limit=N       Relay page size, from 1 to 1000 (default: 1000).",
      "  --max-pages=N   Stop early after N pages (stored as a partial scan).",
      `  --deadline-ms=N Stop the entire run after N ms (default: ${DEFAULT_PDS_INVENTORY_DEADLINE_MS}).`,
      "  --allow-large-drop",
      "                  Reconcile a verified >5% drop in PDS instances.",
      "  --skip-enrichment",
      "                  Skip public-host metadata probes after the scan.",
      `  --enrichment-limit=N`,
      `                  Probe at most N stale active hosts (default: ${DEFAULT_PUBLIC_HOST_ENRICHMENT_LIMIT}).`,
    ].join("\n"),
  );
  Deno.exit(exitCode);
}

function stringFlag(args: string[], flag: string): string | null {
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function numberFlag(
  args: string[],
  flag: string,
  options: { fallback?: number; minimum?: number; maximum?: number } = {},
): number | undefined {
  const raw = stringFlag(args, flag);
  if (!raw) return options.fallback;
  const value = Number(raw);
  const minimum = options.minimum ?? 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    console.error(`${flag} must be an integer of at least ${minimum}`);
    usage(2);
  }
  if (options.maximum != null && value > options.maximum) {
    console.error(`${flag} must not exceed ${options.maximum}`);
    usage(2);
  }
  return value;
}

function validateArgs(args: string[]): void {
  const booleanFlags = new Set([
    "--dry-run",
    "--allow-large-drop",
    "--skip-enrichment",
    "--help",
    "-h",
  ]);
  const valueFlags = new Set([
    "--limit",
    "--max-pages",
    "--enrichment-limit",
    "--deadline-ms",
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (booleanFlags.has(arg)) continue;
    if ([...valueFlags].some((flag) => arg.startsWith(`${flag}=`))) continue;
    if (valueFlags.has(arg)) {
      if (args[index + 1] == null) {
        console.error(`${arg} requires a value`);
        usage(2);
      }
      index++;
      continue;
    }
    console.error(`Unknown option: ${arg}`);
    usage(2);
  }
}

function envDeadlineMs(): number {
  const raw = Deno.env.get("PDS_INVENTORY_DEADLINE_MS")?.trim();
  if (!raw) return DEFAULT_PDS_INVENTORY_DEADLINE_MS;
  const value = Number(raw);
  return Number.isSafeInteger(value) &&
      value >= MIN_PDS_INVENTORY_DEADLINE_MS &&
      value <= MAX_PDS_INVENTORY_DEADLINE_MS
    ? value
    : DEFAULT_PDS_INVENTORY_DEADLINE_MS;
}

function parseOptions(args: string[]): InventoryCliOptions {
  validateArgs(args);
  if (args.includes("--help") || args.includes("-h")) usage();
  return {
    pageSize: numberFlag(args, "--limit", {
      fallback: 1000,
      maximum: 1000,
    })!,
    maxPages: numberFlag(args, "--max-pages", { maximum: 100 }),
    enrichmentLimit: numberFlag(args, "--enrichment-limit", {
      fallback: DEFAULT_PUBLIC_HOST_ENRICHMENT_LIMIT,
      maximum: 1000,
    })!,
    deadlineMs: numberFlag(args, "--deadline-ms", {
      fallback: envDeadlineMs(),
      minimum: MIN_PDS_INVENTORY_DEADLINE_MS,
      maximum: MAX_PDS_INVENTORY_DEADLINE_MS,
    })!,
    dryRun: args.includes("--dry-run"),
    allowLargeDrop: args.includes("--allow-large-drop"),
    skipEnrichment: args.includes("--skip-enrichment"),
  };
}

function logInventoryEvent(
  event: string,
  fields: Record<string, unknown> = {},
  level: "info" | "warn" | "error" = "info",
): void {
  const line = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function errorKind(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "deadline_exceeded";
  }
  return error instanceof Error ? error.name : "unknown_error";
}

function waitForAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export async function runPdsInventory(
  args = Deno.args.filter((arg) => arg !== "--"),
): Promise<number> {
  const options = parseOptions(args);
  const startedAt = Date.now();
  const deadlineAt = startedAt + options.deadlineMs;
  const scanId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const deadline = new AbortController();
  let databaseOpened = false;
  let leaseOwned = false;
  let scanStarted = false;
  let scanFinished = false;
  let exitCode = 0;
  let renewalInFlight = false;
  let renewalPromise: Promise<void> | null = null;
  let renewTimer: ReturnType<typeof setInterval> | undefined;

  const deadlineTimer = setTimeout(() => {
    deadline.abort(
      new DOMException("PDS inventory deadline exceeded", "TimeoutError"),
    );
  }, options.deadlineMs);
  const hardExitTimer = setTimeout(() => {
    logInventoryEvent("pds_inventory_forced_exit", {
      scanId: options.dryRun ? null : scanId,
      durationMs: Date.now() - startedAt,
      deadlineMs: options.deadlineMs,
    }, "error");
    Deno.exit(124);
  }, options.deadlineMs + HARD_EXIT_GRACE_MS);

  try {
    if (!options.dryRun) {
      await loadDotEnvIfPresent();
      databaseOpened = true;
      leaseOwned = await waitForAbortable(
        tryAcquireWorkerLease(
          LEASE_NAME,
          ownerId,
          options.deadlineMs + LEASE_EXPIRY_GRACE_MS,
        ),
        deadline.signal,
      );
      if (!leaseOwned) {
        logInventoryEvent("pds_inventory_skipped", {
          scanId: null,
          reason: "lease_unavailable",
          durationMs: Date.now() - startedAt,
        }, "warn");
        throw new InventoryLeaseUnavailableError();
      }
      renewTimer = setInterval(() => {
        if (renewalInFlight || deadline.signal.aborted) return;
        renewalInFlight = true;
        renewalPromise = renewWorkerLease(
          LEASE_NAME,
          ownerId,
          options.deadlineMs + LEASE_EXPIRY_GRACE_MS,
        ).then((renewed) => {
          if (!renewed && !deadline.signal.aborted) {
            deadline.abort(new Error("PDS inventory lease was lost"));
          }
        }).catch(() => {
          if (!deadline.signal.aborted) {
            deadline.abort(new Error("PDS inventory lease renewal failed"));
          }
        }).finally(() => {
          renewalInFlight = false;
          renewalPromise = null;
        });
      }, LEASE_RENEW_INTERVAL_MS);
      await waitForAbortable(
        startPdsInventoryScan(scanId, startedAt),
        deadline.signal,
      );
      scanStarted = true;
    }

    logInventoryEvent("pds_inventory_started", {
      mode: options.dryRun ? "dry-run" : "write",
      scanId: options.dryRun ? null : scanId,
      deadlineMs: options.deadlineMs,
      pageSize: options.pageSize,
      maxPages: options.maxPages ?? null,
    });

    const fetched = await fetchRelayPdsInventory({
      pageSize: options.pageSize,
      maxPages: options.maxPages,
      signal: deadline.signal,
    });
    const summary = summarizeRelayPdsInventory(fetched.instances);

    let persisted = null;
    let directoryMaintenance = null;
    let directoryMaintenanceError: string | null = null;
    let publicHostEnrichment = null;
    let publicHostEnrichmentError: string | null = null;
    if (!options.dryRun) {
      persisted = await persistRelayPdsInventory(fetched.instances, {
        complete: fetched.complete,
        observedAt: startedAt,
        scanId,
        allowLargeDrop: options.allowLargeDrop,
        signal: deadline.signal,
      });
      await waitForAbortable(
        finishPdsInventoryScan({
          scanId,
          complete: fetched.complete,
          pages: fetched.pages,
          instanceCount: fetched.instances.length,
        }),
        deadline.signal,
      );
      scanFinished = true;
      if (fetched.complete && Date.now() < deadlineAt) {
        try {
          directoryMaintenance = await waitForAbortable(
            maintainAccountHostDirectory({ signal: deadline.signal }),
            deadline.signal,
          );
        } catch (error) {
          directoryMaintenanceError = deadline.signal.aborted
            ? "deadline_exceeded"
            : errorKind(error);
          logInventoryEvent(
            "pds_inventory_directory_maintenance_failed",
            { scanId, errorKind: directoryMaintenanceError },
            "warn",
          );
          if (deadline.signal.aborted) throw deadline.signal.reason;
        }
      }
      if (
        fetched.complete && !options.skipEnrichment &&
        Date.now() < deadlineAt
      ) {
        try {
          publicHostEnrichment = await waitForAbortable(
            enrichObservedAccountHostPublicIntent({
              limit: options.enrichmentLimit,
              signal: deadline.signal,
              timeoutMs: Math.min(
                2_500,
                Math.max(500, deadlineAt - Date.now()),
              ),
            }),
            deadline.signal,
          );
        } catch (error) {
          publicHostEnrichmentError = deadline.signal.aborted
            ? "deadline_exceeded"
            : errorKind(error);
          logInventoryEvent("pds_inventory_enrichment_failed", {
            scanId,
            errorKind: publicHostEnrichmentError,
          }, "warn");
          if (deadline.signal.aborted) throw deadline.signal.reason;
        }
      }
    }

    logInventoryEvent("pds_inventory_completed", {
      mode: options.dryRun ? "dry-run" : "write",
      scanId: options.dryRun ? null : scanId,
      durationMs: Date.now() - startedAt,
      pages: fetched.pages,
      complete: fetched.complete,
      nextCursor: fetched.nextCursor,
      summary,
      persisted,
      directoryMaintenance,
      directoryMaintenanceError,
      publicHostEnrichment,
      publicHostEnrichmentError,
    });
  } catch (error) {
    if (error instanceof InventoryLeaseUnavailableError) {
      exitCode = 0;
    } else {
      exitCode = error instanceof DOMException && error.name === "TimeoutError"
        ? 124
        : 1;
      if (!options.dryRun && scanStarted && !scanFinished) {
        await failPdsInventoryScan({ scanId, error }).catch(() => {
          logInventoryEvent(
            "pds_inventory_failure_record_failed",
            { scanId },
            "error",
          );
        });
      }
      logInventoryEvent("pds_inventory_failed", {
        mode: options.dryRun ? "dry-run" : "write",
        scanId: options.dryRun ? null : scanId,
        durationMs: Date.now() - startedAt,
        deadlineMs: options.deadlineMs,
        errorKind: errorKind(error),
      }, "error");
    }
  } finally {
    clearTimeout(deadlineTimer);
    if (renewTimer !== undefined) clearInterval(renewTimer);
    await (renewalPromise as Promise<void> | null)?.catch(() => {});
    if (leaseOwned) {
      await releaseWorkerLease(LEASE_NAME, ownerId).catch(() => {
        exitCode ||= 1;
        logInventoryEvent(
          "pds_inventory_lease_release_failed",
          { scanId },
          "error",
        );
      });
    }
    if (databaseOpened) {
      await withDb(closePostgresExecuteClient).catch(() => {
        exitCode ||= 1;
        logInventoryEvent(
          "pds_inventory_database_close_failed",
          { scanId },
          "error",
        );
      });
    }
    clearTimeout(hardExitTimer);
  }

  return exitCode;
}

if (import.meta.main) {
  Deno.exit(await runPdsInventory());
}
