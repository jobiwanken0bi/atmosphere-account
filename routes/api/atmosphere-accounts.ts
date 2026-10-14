import { define } from "../../utils.ts";
import { getJazAccountCount } from "../../lib/jaz-account-count.ts";

export const handler = define.handlers({
  async GET() {
    const snapshot = await getJazAccountCount();
    if (!snapshot) {
      return Response.json({ error: "Account count temporarily unavailable" }, {
        status: 503,
        headers: { "cache-control": "no-store" },
      });
    }
    return Response.json(snapshot, {
      headers: {
        "cache-control": "public, max-age=15, s-maxage=60",
      },
    });
  },
});
