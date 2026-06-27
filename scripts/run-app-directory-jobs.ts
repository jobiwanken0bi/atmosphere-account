import { runQueuedAppDirectoryJobs } from "../lib/app-directory-jobs.ts";

const limitArg = Deno.args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg
  ? Number.parseInt(limitArg.slice("--limit=".length), 10)
  : 1;

const processed = await runQueuedAppDirectoryJobs(
  Number.isFinite(limit) && limit > 0 ? limit : 1,
);

console.log(`[app-directory-jobs] processed ${processed} queued job(s)`);
