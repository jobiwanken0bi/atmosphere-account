import { define } from "../../../utils.ts";
import { deleteLoginConnectionForAccount } from "../../../lib/atmosphere-login.ts";
import { rejectLargeRequest } from "../../../lib/security.ts";

const MAX_DISCONNECT_BODY_BYTES = 8_192;

async function readClientId(req: Request): Promise<string | null> {
  const form = await req.formData().catch(() => null);
  const value = form?.get("client_id");
  return typeof value === "string" ? value.trim() : null;
}

export const handler = define.handlers({
  async POST(ctx) {
    const large = rejectLargeRequest(ctx.req, MAX_DISCONNECT_BODY_BYTES);
    if (large) return large;

    const user = ctx.state.user;
    if (!user) {
      return new Response(null, {
        status: 303,
        headers: { location: "/signin?next=/account" },
      });
    }

    const clientId = await readClientId(ctx.req);
    if (clientId) {
      await deleteLoginConnectionForAccount(user.did, clientId).catch(() => {});
    }

    return new Response(null, {
      status: 303,
      headers: { location: "/account#applications" },
    });
  },
});
