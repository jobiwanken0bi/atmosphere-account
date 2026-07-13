export const NEON_APP_TABLES = [
  "profile",
  "featured",
  "jetstream_cursor",
  "oauth_state",
  "oauth_session",
  "oauth_key",
  "app_session",
  "app_user",
  "report",
  "review",
  "review_report",
  "review_response",
  "profile_update",
  "account_host",
  "account_host_claim",
  "host_conformance",
  "host_record",
  "pds_instance",
  "pds_inventory_scan",
  "app_record",
  "app_listing",
  "app_alias",
  "app_review",
  "app_favorite",
  "app_mention",
  "app_record_failure",
  "app_directory_job",
  "app_featured",
  "app_moderation",
  "login_app",
  "login_app_connection",
  "login_picker_intent",
  "login_selection_replay",
  "rate_limit_bucket",
  "worker_lease",
] as const;

export type NeonAppTable = typeof NEON_APP_TABLES[number];

export const NEON_TABLES_WITH_FOREIGN_KEYS: readonly NeonAppTable[] = [
  "featured",
  "review_report",
  "review_response",
  "account_host_claim",
  "host_conformance",
  "app_alias",
  "app_review",
  "app_favorite",
  "app_mention",
  "app_featured",
  "app_moderation",
  "login_app_connection",
] as const;

export function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function quoteQualifiedTable(table: string): string {
  return table.split(".").map(quoteIdent).join(".");
}

export function parseArgs(args: string[]) {
  return {
    dryRun: !args.includes("--write"),
    reset: args.includes("--reset"),
    allowMissingSourceTables: args.includes("--allow-missing-source-tables"),
    limit: readNumberFlag(args, "--limit"),
    tables: readListFlag(args, "--tables"),
    skipTables: new Set(readListFlag(args, "--skip-tables")),
  };
}

function readListFlag(args: string[], flag: string): string[] {
  const value = readStringFlag(args, flag);
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function readNumberFlag(args: string[], flag: string): number | null {
  const value = readStringFlag(args, flag);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function readStringFlag(args: string[], flag: string): string | null {
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1] ?? null;
  return null;
}
