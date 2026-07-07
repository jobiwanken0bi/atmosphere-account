import { loadDotEnvIfPresent } from "../lib/cli-env.ts";
import { checkDbHealth, type DatabaseBackend, withDb } from "../lib/db.ts";
import { NEON_APP_TABLES } from "../lib/neon-migration.ts";
import {
  clearAppDirectorySearchCache,
  getAppListingByIdentifier,
  listAppAliasesForListing,
  listAppReviewsForListing,
  searchAppDirectory,
} from "../lib/app-directory.ts";
import {
  getAccountHost,
  listAccountHosts,
  lookupAccountHost,
} from "../lib/account-hosts.ts";
import {
  countLoginAppsForTrustReview,
  getLoginApp,
  listLoginAppsForOwner,
} from "../lib/atmosphere-login.ts";
import { searchProfiles } from "../lib/registry.ts";

type SmokeStatus = "ok" | "failed" | "skipped";

interface SmokeStep {
  name: string;
  status: SmokeStatus;
  detail?: string;
  error?: string;
}

function usage(exitCode = 2): never {
  const write = exitCode === 0 ? console.log : console.error;
  write(
    [
      "Usage: deno task db:smoke [--backend=turso|neon|postgres|both]",
      "",
      "Runs route-shaped DB reads against Turso and/or Neon.",
      "Default backend is both when Neon env exists, otherwise turso.",
    ].join("\n"),
  );
  Deno.exit(exitCode);
}

function readFlag(args: string[], flag: string): string | null {
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function selectedBackends(): DatabaseBackend[] {
  const args = Deno.args.filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) usage(0);
  const raw = readFlag(args, "--backend")?.toLowerCase();
  if (!raw) {
    const backends: DatabaseBackend[] = ["turso"];
    if (
      Deno.env.get("NEON_DATABASE_URL") ||
      Deno.env.get("NEON_DIRECT_DATABASE_URL")
    ) {
      backends.push("neon");
    }
    if (
      Deno.env.get("POSTGRES_DATABASE_URL") ||
      Deno.env.get("DATABASE_URL") ||
      Deno.env.get("POSTGRES_URL")
    ) {
      backends.push("postgres");
    }
    return backends;
  }
  if (raw === "both") {
    const backends: DatabaseBackend[] = ["turso"];
    if (
      Deno.env.get("NEON_DATABASE_URL") ||
      Deno.env.get("NEON_DIRECT_DATABASE_URL")
    ) {
      backends.push("neon");
    }
    if (
      Deno.env.get("POSTGRES_DATABASE_URL") ||
      Deno.env.get("DATABASE_URL") ||
      Deno.env.get("POSTGRES_URL")
    ) {
      backends.push("postgres");
    }
    return backends;
  }
  if (raw === "turso" || raw === "neon" || raw === "postgres") return [raw];
  throw new Error(`Unsupported --backend=${raw}`);
}

async function step(
  name: string,
  fn: () => Promise<string | void>,
): Promise<SmokeStep> {
  const started = performance.now();
  try {
    const detail = await fn();
    const elapsed = Math.round(performance.now() - started);
    return {
      name,
      status: "ok",
      detail: detail ? `${detail} (${elapsed}ms)` : `${elapsed}ms`,
    };
  } catch (error) {
    return {
      name,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function tableCounts(): Promise<string> {
  return await withDb(async (c) => {
    const counts: string[] = [];
    for (const table of NEON_APP_TABLES) {
      const result = await c.execute(`SELECT COUNT(*) AS n FROM "${table}"`);
      counts.push(`${table}=${Number(result.rows[0]?.n ?? 0)}`);
    }
    return counts.join(", ");
  });
}

async function smokeBackend(backend: DatabaseBackend): Promise<SmokeStep[]> {
  Deno.env.set("ATMOSPHERE_DB_BACKEND", backend);
  clearAppDirectorySearchCache();
  const steps: SmokeStep[] = [];

  steps.push(
    await step("health", async () => {
      const health = await checkDbHealth();
      return `${health.backend}/${health.databaseKind}`;
    }),
  );

  steps.push(await step("table counts", tableCounts));

  steps.push(
    await step("hosts list/detail/lookup", async () => {
      const [hosts, bluesky, lookup] = await Promise.all([
        listAccountHosts({ query: "sky" }),
        getAccountHost("bsky.network"),
        lookupAccountHost("https://bsky.social"),
      ]);
      return `hosts=${hosts.length}, bluesky=${
        bluesky?.displayName ?? "missing"
      }, lookup=${lookup?.displayName ?? "missing"}`;
    }),
  );

  steps.push(
    await step("apps directory home", async () => {
      const result = await searchAppDirectory({
        pageSize: 6,
        includeSections: true,
        syncLegacy: false,
      });
      return `apps=${result.apps.length}, total=${result.total}, featured=${result.featured.length}, trending=${result.trending.length}, fresh=${result.fresh.length}`;
    }),
  );

  steps.push(
    await step("apps collection filter", async () => {
      const result = await searchAppDirectory({
        tag: "social",
        pageSize: 6,
        includeSections: false,
        syncLegacy: false,
      });
      return `apps=${result.apps.length}, total=${result.total}`;
    }),
  );

  steps.push(
    await step("apps search", async () => {
      const result = await searchAppDirectory({
        query: "spark",
        pageSize: 6,
        includeSections: false,
        syncLegacy: false,
      });
      return `apps=${result.apps.length}, total=${result.total}`;
    }),
  );

  steps.push(
    await step("app detail aliases/reviews", async () => {
      const result = await searchAppDirectory({
        pageSize: 1,
        includeSections: false,
        syncLegacy: false,
      });
      const app = result.apps[0];
      if (!app) return "skipped: no app listings";
      const detail = await getAppListingByIdentifier(app.slug);
      if (!detail) throw new Error(`detail lookup failed for ${app.slug}`);
      const [aliases, reviews] = await Promise.all([
        listAppAliasesForListing(detail.id),
        listAppReviewsForListing(detail.id, { limit: 3 }),
      ]);
      return `${detail.slug}, aliases=${aliases.length}, reviews=${reviews.length}`;
    }),
  );

  steps.push(
    await step("legacy profile search", async () => {
      const result = await searchProfiles({ page: 1, pageSize: 6 });
      return `profiles=${result.profiles.length}, total=${result.total}`;
    }),
  );

  steps.push(
    await step("login apps", async () => {
      const [trustReviewCount, ownerApps, unknown] = await Promise.all([
        countLoginAppsForTrustReview(),
        listLoginAppsForOwner("did:plc:smoke"),
        getLoginApp("https://example.com/client-metadata.json"),
      ]);
      return `trustReviews=${trustReviewCount}, ownerApps=${ownerApps.length}, unknown=${
        unknown ? "found" : "missing"
      }`;
    }),
  );

  return steps;
}

await loadDotEnvIfPresent();

let failed = false;
for (const backend of selectedBackends()) {
  console.log(`[db:smoke] backend=${backend}`);
  const steps = await smokeBackend(backend);
  for (const result of steps) {
    if (result.status === "ok") {
      console.log(`[db:smoke] ok ${result.name}: ${result.detail}`);
      continue;
    }
    failed = true;
    console.error(`[db:smoke] failed ${result.name}: ${result.error}`);
  }
}

if (failed) Deno.exit(1);
