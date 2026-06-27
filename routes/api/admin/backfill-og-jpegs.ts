/**
 * Admin one-shot: generate and store og_jpeg for all profiles that have a
 * banner but no cached og_jpeg yet. Run once after deploying the og_jpeg
 * feature to warm the cache for existing profiles.
 *
 *   POST /api/admin/backfill-og-jpegs
 *
 * Returns a JSON summary: { processed, skipped, errors }.
 */
import { define } from "../../../utils.ts";
import { requireAdminApi } from "../../../lib/admin.ts";
import { IS_HOSTED_RUNTIME } from "../../../lib/env.ts";
import { backfillOgJpegs } from "../../../lib/og-jpeg-backfill.ts";

export const handler = define.handlers({
  POST: async (ctx) => {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;
    if (IS_HOSTED_RUNTIME && !allowInProcessAdminBackfills()) {
      return new Response(
        JSON.stringify({
          processed: 0,
          skipped: 0,
          errors: [
            "OG JPEG backfill is disabled on hosted web. Run it from a worker/CLI process.",
          ],
        }),
        {
          status: 409,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }

    const result = await backfillOgJpegs(200);

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  },
});

function allowInProcessAdminBackfills(): boolean {
  try {
    return Deno.env.get("ALLOW_IN_PROCESS_ADMIN_BACKFILLS") === "true";
  } catch {
    return false;
  }
}
