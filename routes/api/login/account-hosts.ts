import { define } from "../../../utils.ts";
import { getLoginApp } from "../../../lib/atmosphere-login.ts";
import { listCreateAccountHostOptions } from "../../../lib/create-account-hosts.ts";
import { withRateLimit } from "../../../lib/rate-limit.ts";

const MAX_QUERY_LENGTH = 160;
const MAX_CLIENT_ID_LENGTH = 2048;

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const search = ctx.url.searchParams;
    const query = (search.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
    const includeOpen = readDefaultTrue(search, "open");
    const includeInvite = readDefaultTrue(search, "invite");
    const clientId = (search.get("client_id") ?? "").trim();
    const app = clientId && clientId.length <= MAX_CLIENT_ID_LENGTH
      ? await getLoginApp(clientId).catch(() => null)
      : null;
    try {
      const hosts = await listCreateAccountHostOptions({
        query,
        includeOpen,
        includeInvite,
        app,
      });
      return json({ hosts });
    } catch (err) {
      console.warn("[login] account host discovery failed:", err);
      return json({ hosts: [], error: "host_directory_unavailable" }, 503);
    }
  }, {
    scope: "login-account-hosts",
    capacity: 120,
    refillMs: 60_000,
  }),
});

function readDefaultTrue(search: URLSearchParams, key: string): boolean {
  return !search.has(key) || search.get(key) === "1";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
