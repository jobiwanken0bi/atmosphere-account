import { define } from "../../utils.ts";
import { IS_DEV } from "../../lib/env.ts";
import { withDb } from "../../lib/db.ts";
import {
  buildSessionCookie,
  createSession,
  peekSessionUser,
} from "../../lib/session.ts";
import { setAppUserType } from "../../lib/account-types.ts";
import {
  addRememberedAccountCookie,
  readRememberedAccountsFromHeader,
  type RememberedAccount,
} from "../../lib/remembered-accounts.ts";

const DEMO_APPS = [
  {
    clientId: "https://sill.social/.well-known/atmosphere-login.json",
    name: "Sill",
    uri: "https://sill.social",
    logo: "/atmosphere-apps/sill.webp",
    count: 8,
    minutesAgo: 18,
  },
  {
    clientId: "https://pckt.cafe/.well-known/atmosphere-login.json",
    name: "Pckt",
    uri: "https://pckt.cafe",
    logo: "/atmosphere-apps/pckt.webp",
    count: 4,
    minutesAgo: 140,
  },
  {
    clientId: "https://spark.atproto.app/.well-known/atmosphere-login.json",
    name: "Spark",
    uri: "https://sprk.so",
    logo: "/atmosphere-apps/spark.png",
    count: 2,
    minutesAgo: 860,
  },
] as const;

const DEMO_ACCOUNTS: RememberedAccount[] = [
  {
    did: "did:plc:aaaccountdemoone",
    handle: "alice.bsky.social",
    pdsUrl: "https://bsky.social",
  },
  {
    did: "did:plc:aaaccountdemotwo",
    handle: "personal.site",
    pdsUrl: "https://pds.personal.site",
  },
];

export const handler = define.handlers({
  async GET(ctx) {
    if (!IS_DEV) return new Response("Not found", { status: 404 });

    let user = await peekSessionUser(ctx.req);
    let sessionCookie: string | null = null;
    if (!user) {
      user = {
        did: "did:plc:aaaccountdemocurrent",
        handle: "you.bsky.social",
      };
      const sessionValue = await createSession(user);
      sessionCookie = buildSessionCookie(sessionValue);
      await setAppUserType({
        did: user.did,
        handle: user.handle,
        displayName: "You",
        accountType: "user",
      });
    }

    await seedDemoConnections(user);

    const currentAccount: RememberedAccount = {
      did: user.did,
      handle: user.handle,
    };
    const existing = await readRememberedAccountsFromHeader(
      ctx.req.headers.get("cookie"),
    ).catch(() => []);
    const seed = uniqueAccounts([
      ...existing,
      ...DEMO_ACCOUNTS,
    ]);
    const rememberedCookie = await addRememberedAccountCookie(
      seed,
      currentAccount,
    );

    const headers = new Headers({
      "cache-control": "no-store",
      "location": "/account",
    });
    if (sessionCookie) headers.append("set-cookie", sessionCookie);
    headers.append("set-cookie", rememberedCookie);

    return new Response(null, {
      status: 303,
      headers,
    });
  },
});

async function seedDemoConnections(user: { did: string; handle: string }) {
  const now = Date.now();
  await withDb(async (c) => {
    for (const app of DEMO_APPS) {
      await c.execute({
        sql: `
          INSERT INTO login_app (
            client_id, app_name, app_uri, logo_uri,
            allowed_return_uris, allowed_origins, status,
            contact_did, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'trusted', ?, ?, ?)
          ON CONFLICT(client_id) DO UPDATE SET
            app_name = excluded.app_name,
            app_uri = excluded.app_uri,
            logo_uri = excluded.logo_uri,
            status = excluded.status,
            updated_at = excluded.updated_at
        `,
        args: [
          app.clientId,
          app.name,
          app.uri,
          app.logo,
          JSON.stringify([`${app.uri}/callback`]),
          JSON.stringify([new URL(app.uri).origin]),
          user.did,
          now - 30 * 24 * 60 * 60 * 1000,
          now,
        ],
      });

      const selectedAt = now - app.minutesAgo * 60 * 1000;
      await c.execute({
        sql: `
          INSERT INTO login_app_connection (
            client_id, did, handle, selected_count,
            first_selected_at, last_selected_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(client_id, did) DO UPDATE SET
            handle = excluded.handle,
            selected_count = excluded.selected_count,
            first_selected_at = excluded.first_selected_at,
            last_selected_at = excluded.last_selected_at
        `,
        args: [
          app.clientId,
          user.did,
          user.handle,
          app.count,
          selectedAt - 14 * 24 * 60 * 60 * 1000,
          selectedAt,
        ],
      });
    }
  });
}

function uniqueAccounts(accounts: RememberedAccount[]): RememberedAccount[] {
  const out: RememberedAccount[] = [];
  const seen = new Set<string>();
  for (const account of accounts) {
    if (!account.did || seen.has(account.did)) continue;
    seen.add(account.did);
    out.push(account);
  }
  return out;
}
