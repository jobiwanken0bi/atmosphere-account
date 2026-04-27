import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import SignInForm from "../../islands/SignInForm.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { isOAuthConfigured } from "../../lib/oauth.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getEffectiveAccountType } from "../../lib/account-types.ts";

export default define.page(async function ExploreCreate(ctx) {
  const t = getMessages(ctx.state.locale).explore;
  const user = ctx.state.user;
  const rawNext = ctx.url.searchParams.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
    ? rawNext
    : null;

  if (user) {
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    return new Response(null, {
      status: 303,
      headers: {
        location: accountType === "project"
          ? next ?? "/explore/manage"
          : accountType === "user"
          ? next ?? "/account/reviews"
          : `/account/type${next ? `?next=${encodeURIComponent(next)}` : ""}`,
      },
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
        <Nav account={account} />
        <section class="explore-create" style={{ paddingTop: "8rem" }}>
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
                ? <SignInForm returnTo={next ?? undefined} />
                : <p class="text-body">{t.create.configError}</p>}
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
});
