import { loadDotEnvIfPresent } from "../lib/cli-env.ts";
import {
  fetchRelayPdsInventory,
  persistRelayPdsInventory,
  summarizeRelayPdsInventory,
} from "../lib/pds-relay-inventory.ts";

function usage(exitCode = 0): never {
  const write = exitCode === 0 ? console.log : console.error;
  write(
    [
      "Usage: deno task pds:index [--dry-run] [--limit=1000] [--max-pages=N]",
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
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`${flag} must be a positive integer`);
    usage(2);
  }
  return options.maximum == null ? value : Math.min(value, options.maximum);
}

const args = Deno.args.filter((arg) => arg !== "--");
if (args.includes("--help") || args.includes("-h")) usage();

const pageSize = numberFlag(args, "--limit", {
  fallback: 1000,
  maximum: 1000,
});
const maxPages = numberFlag(args, "--max-pages");
const dryRun = args.includes("--dry-run");
const observedAt = Date.now();

const fetched = await fetchRelayPdsInventory({ pageSize, maxPages });
const summary = summarizeRelayPdsInventory(fetched.instances);

let persisted = null;
if (!dryRun) {
  await loadDotEnvIfPresent();
  persisted = await persistRelayPdsInventory(fetched.instances, {
    complete: fetched.complete,
    observedAt,
  });
}

console.log(JSON.stringify(
  {
    mode: dryRun ? "dry-run" : "write",
    pages: fetched.pages,
    complete: fetched.complete,
    nextCursor: fetched.nextCursor,
    summary,
    persisted,
  },
  null,
  2,
));
