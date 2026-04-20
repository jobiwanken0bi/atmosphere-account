import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import SignInForm from "../../islands/SignInForm.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { isOAuthConfigured } from "../../lib/oauth.ts";

export default define.page(function ExploreCreate(ctx) {
  const t = getMessages(ctx.state.locale).explore;
  const user = ctx.state.user;

  if (user) {
    return new Response(null, {
      status: 303,
      headers: { location: "/explore/manage" },
    }) as unknown as preact.JSX.Element;
  }

  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav />
        <section class="explore-create" style={{ paddingTop: "8rem" }}>
          <div class="container" style={{ maxWidth: "640px" }}>
            <p class="text-eyebrow">{t.create.eyebrow}</p>
            <h1 class="text-section">{t.create.headline}</h1>
            <p class="text-body mt-2">{t.create.body}</p>
            <div
              class="glass"
              style={{ padding: "1.75rem", marginTop: "2rem" }}
            >
              {isOAuthConfigured()
                ? <SignInForm />
                : <p class="text-body">{t.create.configError}</p>}
            </div>
          </div>
        </section>
        <Footer />
      </div>
    </div>
  );
});
