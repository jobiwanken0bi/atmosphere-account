import type { PageProps } from "fresh";
import { define, type State } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import SignInForm from "../../islands/SignInForm.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { proxyAppviewPageResponse } from "../../lib/appview-client.ts";
import { isOAuthConfigured } from "../../lib/oauth.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { isSafeRelativePath } from "../../lib/security.ts";
import { APP_MANAGEMENT_CAPABILITIES } from "../../lib/oauth-action.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("app registration", err),
    );
    if (proxied) return proxied;
    const body = await renderExploreCreate(ctx);
    if (body instanceof Response) return body;
    return ctx.render(body);
  },
});

export default define.page(async function ExploreCreate(ctx) {
  return await renderExploreCreate(ctx);
});

function renderExploreCreate(
  ctx: PageProps<unknown, State>,
) {
  const t = getMessages(ctx.state.locale).explore;
  const user = ctx.state.user;
  const rawNext = ctx.url.searchParams.get("next");
  const next = isSafeRelativePath(rawNext) ? rawNext : null;
  if (user) {
    return new Response(null, {
      status: 303,
      headers: { location: next ?? "/apps/manage?new=1" },
    }) as unknown as preact.JSX.Element;
  }

  /** user is null here (we redirect when signed in), but the menu can
   *  still surface remembered accounts — that's the "switch to a
   *  previously signed-in account" affordance for visitors who hit
   *  this page from a deep link with cleared session cookies. */
  const account = buildAccountMenuProps(ctx.state);

  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="apps" />
        <main
          id="main-content"
          class="explore-create"
          style={{ paddingTop: "8rem" }}
        >
          <div class="container" style={{ maxWidth: "640px" }}>
            <p class="text-eyebrow">{t.create.eyebrow}</p>
            <h1 class="text-section">{t.create.headline}</h1>
            <p class="text-body mt-2">{t.create.body}</p>
            <div
              class="glass"
              style={{
                padding: "1.75rem",
                marginTop: "2rem",
                position: "relative",
                /* Lift the form card above the footer so the handle preview dropdown,
                   anchored inside this card, can paint over later page chrome. */
                zIndex: 50,
              }}
            >
              {isOAuthConfigured()
                ? (
                  <SignInForm
                    returnTo={next ?? "/apps/manage?new=1"}
                    capabilities={APP_MANAGEMENT_CAPABILITIES}
                    action="app"
                    targetName="your app"
                    rememberedAccounts={account.rememberedAccounts}
                  />
                )
                : <p class="text-body">{t.create.configError}</p>}
            </div>
          </div>
        </main>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("App registration is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
