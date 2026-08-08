import { define } from "../../utils.ts";
import { DEV_PICKER_ACCOUNTS } from "../../lib/dev-picker-demo.ts";
import { IS_DEV } from "../../lib/env.ts";
import { buildExampleLoginState } from "../../lib/example-atproto-oauth.ts";
import {
  addRememberedAccountCookies,
  type RememberedAccount,
} from "../../lib/remembered-accounts.ts";
import { buildSessionCookie, createSession } from "../../lib/session.ts";

export const handler = define.handlers({
  async GET(ctx) {
    if (!IS_DEV) return new Response("Not found", { status: 404 });

    const url = new URL(ctx.req.url);
    const current = currentAccount(url.searchParams.get("current"));
    const sessionValue = await createSession({
      did: current.did,
      handle: current.handle,
    });
    const rememberedCookies = await addRememberedAccountCookies(
      [...DEV_PICKER_ACCOUNTS],
      current,
    );
    const handoff = await buildDevPickerHandoff(url);

    const headers = new Headers({
      "cache-control": "no-store",
      "location": handoff.location,
    });
    headers.append("set-cookie", buildSessionCookie(sessionValue));
    headers.append("set-cookie", handoff.stateCookie);
    for (const cookie of rememberedCookies) {
      headers.append("set-cookie", cookie);
    }

    return new Response(null, { status: 303, headers });
  },
});

async function buildDevPickerHandoff(
  url: URL,
): Promise<{ location: string; stateCookie: string }> {
  const loginState = await buildExampleLoginState();
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
  picker.searchParams.set("state", loginState.state);
  picker.searchParams.set("scope", "atproto");
  return {
    location: `${picker.pathname}${picker.search}`,
    stateCookie: loginState.cookie,
  };
}

export const buildDevPickerHandoffForTest = buildDevPickerHandoff;

function currentAccount(handle: string | null): RememberedAccount {
  const normalized = handle?.trim().replace(/^@/, "").toLowerCase();
  return DEV_PICKER_ACCOUNTS.find((account) =>
    account.handle.toLowerCase() === normalized
  ) ?? DEV_PICKER_ACCOUNTS[0];
}
