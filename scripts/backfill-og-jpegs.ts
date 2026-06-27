import { backfillOgJpegs } from "../lib/og-jpeg-backfill.ts";

const limitArg = Deno.args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg
  ? Number.parseInt(limitArg.slice("--limit=".length), 10)
  : 200;

const result = await backfillOgJpegs(
  Number.isFinite(limit) && limit > 0 ? limit : 200,
);

console.log(
  `[backfill-og-jpegs] processed=${result.processed} skipped=${result.skipped} errors=${result.errors.length}`,
);
for (const error of result.errors.slice(0, 25)) {
  console.warn(`[backfill-og-jpegs] ${error}`);
}
