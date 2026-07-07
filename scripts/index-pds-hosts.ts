import {
  getPdsDiscoveryCursor,
  observePdsAccount,
  setPdsDiscoveryCursor,
} from "../lib/pds-discovery.ts";
import { loadDotEnvIfPresent } from "../lib/cli-env.ts";

const PLC_EXPORT_URL = "https://plc.directory/export";
const CURSOR_SOURCE = "plc_export";
const DEFAULT_COUNT = 1000;

interface PlcExportEntry {
  did?: unknown;
  createdAt?: unknown;
  operation?: unknown;
  nullified?: unknown;
}

interface ParsedPlcOperation {
  did: string;
  handle: string | null;
  serviceEndpoint: string;
  createdAt: number;
  cursor: string;
}

function usage(): string {
  return [
    "Usage: deno task pds:index [--count=1000] [--after=<ISO timestamp>] [--recent-days=30] [--resume] [--dry-run]",
    "",
    "Reads a batch from the DID PLC export, extracts AT Protocol PDS service",
    "endpoints, and records them as claimable account hosts.",
    "",
    "Examples:",
    "  deno task pds:index -- --count=500 --resume",
    "  deno task pds:index -- --recent-days=30 --count=5000",
    "  deno task pds:index -- --after=2024-01-01T00:00:00.000Z --count=100",
  ].join("\n");
}

function stringFlag(args: string[], flag: string): string | null {
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function numberFlag(args: string[], flag: string, fallback: number): number {
  const raw = stringFlag(args, flag);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function recentAfter(args: string[]): string | null {
  const days = numberFlag(args, "--recent-days", 0);
  if (days <= 0) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function handleFromOperation(
  operation: Record<string, unknown>,
): string | null {
  if (typeof operation.handle === "string" && operation.handle.includes(".")) {
    return operation.handle.toLowerCase();
  }
  const alsoKnownAs = operation.alsoKnownAs;
  if (Array.isArray(alsoKnownAs)) {
    const aka = alsoKnownAs.find((value) =>
      typeof value === "string" && value.startsWith("at://")
    );
    return typeof aka === "string" ? aka.slice("at://".length) : null;
  }
  return null;
}

function serviceFromOperation(
  operation: Record<string, unknown>,
): string | null {
  if (typeof operation.service === "string") return operation.service;

  const services = operation.services;
  if (!services || typeof services !== "object") return null;
  const serviceRecord = services as Record<string, unknown>;
  const atprotoPds = serviceRecord.atproto_pds ??
    serviceRecord["#atproto_pds"] ??
    serviceRecord.AtprotoPersonalDataServer;
  if (!atprotoPds || typeof atprotoPds !== "object") return null;

  const pds = atprotoPds as Record<string, unknown>;
  if (typeof pds.endpoint === "string") return pds.endpoint;
  if (typeof pds.serviceEndpoint === "string") return pds.serviceEndpoint;
  return null;
}

function parsePlcExportLine(line: string): ParsedPlcOperation | null {
  if (!line.trim()) return null;
  let entry: PlcExportEntry;
  try {
    entry = JSON.parse(line) as PlcExportEntry;
  } catch {
    return null;
  }
  if (entry.nullified === true) return null;
  if (typeof entry.did !== "string") return null;
  if (typeof entry.createdAt !== "string") return null;
  if (!entry.operation || typeof entry.operation !== "object") return null;
  const operation = entry.operation as Record<string, unknown>;
  const serviceEndpoint = serviceFromOperation(operation);
  if (!serviceEndpoint) return null;
  const createdAt = Date.parse(entry.createdAt);
  if (!Number.isFinite(createdAt)) return null;
  return {
    did: entry.did,
    handle: handleFromOperation(operation),
    serviceEndpoint,
    createdAt,
    cursor: entry.createdAt,
  };
}

function safeServiceHost(serviceEndpoint: string): string {
  try {
    return new URL(serviceEndpoint).host.toLowerCase();
  } catch {
    return "invalid-service-endpoint";
  }
}

async function fetchPlcExportBatch(
  { count, after }: { count: number; after: string | null },
): Promise<ParsedPlcOperation[]> {
  const url = new URL(PLC_EXPORT_URL);
  url.searchParams.set("count", String(count));
  if (after) url.searchParams.set("after", after);
  const response = await fetch(url, {
    headers: { accept: "application/jsonlines" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`PLC export returned HTTP ${response.status}`);
  }
  const text = await response.text();
  return text.split(/\r?\n/g).map(parsePlcExportLine).filter(
    (entry): entry is ParsedPlcOperation => !!entry,
  );
}

if (import.meta.main) {
  const args = Deno.args.filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    Deno.exit(0);
  }
  await loadDotEnvIfPresent();

  const count = numberFlag(args, "--count", DEFAULT_COUNT);
  const dryRun = args.includes("--dry-run");
  const resume = args.includes("--resume");
  const explicitAfter = stringFlag(args, "--after");
  const after = explicitAfter ??
    (resume ? await getPdsDiscoveryCursor(CURSOR_SOURCE) : null) ??
    recentAfter(args);

  const entries = await fetchPlcExportBatch({ count, after });
  let indexed = 0;
  let skipped = 0;
  let latestCursor = after;
  const hostsSeen = new Map<string, number>();

  for (const entry of entries) {
    latestCursor = entry.cursor;
    const serviceHost = safeServiceHost(entry.serviceEndpoint);
    hostsSeen.set(serviceHost, (hostsSeen.get(serviceHost) ?? 0) + 1);
    if (dryRun) {
      indexed++;
      continue;
    }
    const result = await observePdsAccount({
      did: entry.did,
      handle: entry.handle,
      serviceEndpoint: entry.serviceEndpoint,
      source: "plc_export",
      observedAt: entry.createdAt,
    }).catch((err) => {
      console.warn(`[pds:index] failed ${entry.did}:`, err);
      return null;
    });
    if (result) indexed++;
    else skipped++;
  }

  if (!dryRun && latestCursor && latestCursor !== after) {
    await setPdsDiscoveryCursor(CURSOR_SOURCE, latestCursor);
  }

  console.log(
    `[pds:index] ${
      dryRun ? "dry-run " : ""
    }processed=${entries.length} indexed=${indexed} skipped=${skipped} next_after=${
      latestCursor ?? ""
    }`,
  );
  const topHosts = [...hostsSeen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([host, seen]) => `${host}:${seen}`)
    .join(", ");
  if (topHosts) console.log(`[pds:index] top service hosts: ${topHosts}`);
}
