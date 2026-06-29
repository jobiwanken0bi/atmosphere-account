import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import SignInForm from "../../islands/SignInForm.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getEffectiveAccountType } from "../../lib/account-types.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import { isOAuthConfigured } from "../../lib/oauth.ts";

export default define.page(async function LegacyAppMigrationPage(ctx) {
  const did = ctx.url.searchParams.get("did")?.trim() ?? "";
  const account = buildAccountMenuProps(ctx.state);
  const returnTo = `${ctx.url.pathname}${ctx.url.search}`;
  const manageTarget = "/apps/manage?migrate=shared-records";

  if (!did) {
    return new Response(null, {
      status: 303,
      headers: { location: "/apps/manage" },
    }) as unknown as preact.JSX.Element;
  }

  const profile = await getProfileByDid(did, {
    includeTakenDown: true,
    profileType: "project",
  }).catch(() => null);

  const user = ctx.state.user;
  if (user?.did === did) {
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType === "project") {
      return new Response(null, {
        status: 303,
        headers: { location: manageTarget },
      }) as unknown as preact.JSX.Element;
    }
  }

  const expected = profile?.handle ? `@${profile.handle}` : did;
  const current = user?.handle ? `@${user.handle}` : null;

  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="apps" />
        <section class="explore-create" style={{ paddingTop: "8rem" }}>
          <div class="container" style={{ maxWidth: "680px" }}>
            <p class="text-eyebrow">Shared app records</p>
            <h1 class="text-section">Migrate this app listing</h1>
            <p class="text-body mt-2">
              Sign in with the app account for{" "}
              {expected}. Atmosphere will preview the existing legacy listing,
              then publish a community app profile and an ATStore listing from
              that account.
            </p>
            {current && current !== expected && (
              <p class="admin-app-directory-warning">
                You are currently signed in as{" "}
                {current}. Use the account picker below to switch to {expected}
                {" "}
                before migrating.
              </p>
            )}
            <div
              class="glass"
              style={{
                padding: "1.75rem",
                marginTop: "2rem",
                position: "relative",
                zIndex: 50,
              }}
            >
              {isOAuthConfigured()
                ? (
                  <SignInForm
                    returnTo={returnTo}
                    intent="project"
                    rememberedAccounts={account.rememberedAccounts}
                  />
                )
                : (
                  <p class="text-body">
                    OAuth is not configured in this environment.
                  </p>
                )}
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
});
