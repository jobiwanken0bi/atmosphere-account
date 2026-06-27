import { define } from "../../../../utils.ts";
import { requireAdminApi } from "../../../../lib/admin.ts";
import { rescoreAppDirectoryTrending } from "../../../../lib/app-directory.ts";
import { IS_HOSTED_RUNTIME } from "../../../../lib/env.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;
    if (IS_HOSTED_RUNTIME && !allowInProcessAdminBackfills()) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            "Direct rescore is disabled on hosted web. Queue it from /admin/app-directory and run deno task app-directory:run-jobs on the worker.",
        }),
        {
          status: 409,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }
    const rescored = await rescoreAppDirectoryTrending();
    return new Response(JSON.stringify({ ok: true, rescored }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  },
});

function allowInProcessAdminBackfills(): boolean {
  try {
    return Deno.env.get("ALLOW_IN_PROCESS_ADMIN_BACKFILLS") === "true";
  } catch {
    return false;
  }
}
