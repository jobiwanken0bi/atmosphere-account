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
import {
  failPdsInventoryScan,
  finishPdsInventoryScan,
  startPdsInventoryScan,
} from "../lib/pds-inventory-health.ts";

function usage(exitCode = 0): never {
  const write = exitCode === 0 ? console.log : console.error;
  write(
    [
      "Usage: deno task pds:index [--dry-run] [--limit=1000] [--max-pages=N] [--allow-large-drop] [--skip-enrichment] [--enrichment-limit=N]",
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
  options: { fallback?: number; maximum?: number } = {},
): number | undefined {
  const raw = stringFlag(args, flag);
  if (!raw) return options.fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`${flag} must be a positive integer`);
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

const args = Deno.args.filter((arg) => arg !== "--");
validateArgs(args);
if (args.includes("--help") || args.includes("-h")) usage();

const pageSize = numberFlag(args, "--limit", {
  fallback: 1000,
  maximum: 1000,
});
const maxPages = numberFlag(args, "--max-pages");
const enrichmentLimit = numberFlag(args, "--enrichment-limit", {
  fallback: DEFAULT_PUBLIC_HOST_ENRICHMENT_LIMIT,
  maximum: 1000,
});
const dryRun = args.includes("--dry-run");
const allowLargeDrop = args.includes("--allow-large-drop");
const skipEnrichment = args.includes("--skip-enrichment");
const observedAt = Date.now();
const scanId = crypto.randomUUID();

if (!dryRun) {
  await loadDotEnvIfPresent();
  await startPdsInventoryScan(scanId, observedAt);
}

try {
  const fetched = await fetchRelayPdsInventory({ pageSize, maxPages });
  const summary = summarizeRelayPdsInventory(fetched.instances);

  let persisted = null;
  let publicHostEnrichment = null;
  let publicHostEnrichmentError: string | null = null;
  if (!dryRun) {
    persisted = await persistRelayPdsInventory(fetched.instances, {
      complete: fetched.complete,
      observedAt,
      scanId,
      allowLargeDrop,
    });
    await finishPdsInventoryScan({
      scanId,
      complete: fetched.complete,
      pages: fetched.pages,
      instanceCount: fetched.instances.length,
    });
    if (!skipEnrichment) {
      try {
        publicHostEnrichment = await enrichObservedAccountHostPublicIntent({
          limit: enrichmentLimit,
        });
      } catch (error) {
        publicHostEnrichmentError = error instanceof Error
          ? error.message
          : String(error);
        console.warn(
          "[pds:index] public-host enrichment failed without invalidating the inventory scan:",
          publicHostEnrichmentError,
        );
      }
    }
  }

  console.log(JSON.stringify(
    {
      mode: dryRun ? "dry-run" : "write",
      scanId: dryRun ? null : scanId,
      pages: fetched.pages,
      complete: fetched.complete,
      nextCursor: fetched.nextCursor,
      summary,
      persisted,
      publicHostEnrichment,
      publicHostEnrichmentError,
    },
    null,
    2,
  ));
} catch (err) {
  if (!dryRun) {
    await failPdsInventoryScan({ scanId, error: err }).catch((recordError) => {
      console.error("[pds:index] failed to record scan failure:", recordError);
    });
  }
  throw err;
}
