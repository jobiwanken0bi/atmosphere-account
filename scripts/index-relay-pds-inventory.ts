import { loadDotEnvIfPresent } from "../lib/cli-env.ts";
import {
  fetchRelayPdsInventory,
  persistRelayPdsInventory,
  summarizeRelayPdsInventory,
} from "../lib/pds-relay-inventory.ts";
import {
  failPdsInventoryScan,
  finishPdsInventoryScan,
  startPdsInventoryScan,
} from "../lib/pds-inventory-health.ts";

function usage(exitCode = 0): never {
  const write = exitCode === 0 ? console.log : console.error;
  write(
    [
      "Usage: deno task pds:index [--dry-run] [--limit=1000] [--max-pages=N] [--allow-large-drop]",
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
    "--help",
    "-h",
  ]);
  const valueFlags = new Set(["--limit", "--max-pages"]);
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
const dryRun = args.includes("--dry-run");
const allowLargeDrop = args.includes("--allow-large-drop");
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
