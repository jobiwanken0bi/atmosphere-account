import { define } from "../../utils.ts";
import { IS_DEV } from "../../lib/env.ts";
import {
  addRememberedAccountCookie,
  type RememberedAccount,
} from "../../lib/remembered-accounts.ts";
import { buildSessionCookie, createSession } from "../../lib/session.ts";

const DEV_PICKER_ACCOUNTS: RememberedAccount[] = [
  {
    did: "did:plc:aalocalpicker",
    handle: "local-picker.test",
    pdsUrl: "https://local-picker.test",
  },
  {
    did: "did:plc:aaaccountdemoone",
    handle: "alice.bsky.social",
    pdsUrl: "https://bsky.social",
  },
  {
    did: "did:plc:aaaccountdemotwo",
    handle: "you.com",
    pdsUrl: "https://pds.you.com",
  },
  {
    did: "did:plc:aaaccountdemothree",
    handle: "you.eurosky.social",
    pdsUrl: "https://eurosky.social",
  },
];

export const handler = define.handlers({
  async GET(ctx) {
    if (!IS_DEV) return new Response("Not found", { status: 404 });

    const url = new URL(ctx.req.url);
    const current = currentAccount(url.searchParams.get("current"));
    const sessionValue = await createSession({
      did: current.did,
      handle: current.handle,
    });
    const rememberedCookie = await addRememberedAccountCookie(
      DEV_PICKER_ACCOUNTS,
      current,
    );

    const picker = new URL("/login/select", url.origin);
    picker.searchParams.set(
      "client_id",
      new URL(
        "/examples/atmosphere-login/client-metadata.json",
        url.origin,
      ).toString(),
    );
    picker.searchParams.set(
      "return_uri",
      new URL("/examples/atmosphere-login/callback", url.origin).toString(),
    );
    picker.searchParams.set("state", `dev-picker-${crypto.randomUUID()}`);
    picker.searchParams.set("scope", "atproto");

    const headers = new Headers({
      "cache-control": "no-store",
      "location": `${picker.pathname}${picker.search}`,
    });
    headers.append("set-cookie", buildSessionCookie(sessionValue));
    headers.append("set-cookie", rememberedCookie);

    return new Response(null, { status: 303, headers });
  },
});

function currentAccount(handle: string | null): RememberedAccount {
  const normalized = handle?.trim().replace(/^@/, "").toLowerCase();
  return DEV_PICKER_ACCOUNTS.find((account) =>
    account.handle.toLowerCase() === normalized
  ) ?? DEV_PICKER_ACCOUNTS[0];
}
