import { define } from "../../../../utils.ts";
import { listLoginAppsForOwner } from "../../../../lib/atmosphere-login.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return json({ apps: [] }, 200);
    }
    const apps = await listLoginAppsForOwner(user.did).catch(() => []);
    return json({
      apps: apps.map((app) => ({
        clientId: app.clientId,
        appName: app.appName,
        appUri: app.appUri,
        logoUri: app.logoUri,
        allowedReturnUris: app.allowedReturnUris,
        status: app.status,
        reviewStatus: app.reviewStatus,
      })),
    });
  },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
