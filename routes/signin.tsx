import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import Footer from "../components/Footer.tsx";
import SignInForm from "../islands/SignInForm.tsx";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import { isOAuthConfigured } from "../lib/oauth.ts";
import { refreshRememberedAccountCookies } from "../lib/remembered-accounts.ts";
import { isSafeRelativePath } from "../lib/security.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const next = safeNext(ctx.url.searchParams.get("next"));
    const initialHandle = safeHandle(ctx.url.searchParams.get("handle"));
    const rawIntent = ctx.url.searchParams.get("intent");
    const intent = rawIntent === "project" || rawIntent === "user"
      ? rawIntent
      : undefined;
    if (ctx.state.user) {
      return new Response(null, {
        status: 303,
        headers: { location: next ?? "/account" },
      });
    }
    const account = buildAccountMenuProps(ctx.state);
    const response = await ctx.render(
      (
        <SignInPageContent
          account={account}
          next={next ?? "/account"}
          intent={intent}
          initialHandle={initialHandle}
        />
      ),
      { headers: { "cache-control": "no-store" } },
    );
    if (account.rememberedAccounts.length > 0) {
      const cookies = await refreshRememberedAccountCookies(
        account.rememberedAccounts,
      );
      for (const cookie of cookies) {
        response.headers.append("set-cookie", cookie);
      }
    }
    return response;
  },
});

function safeNext(raw: string | null): string | null {
  return isSafeRelativePath(raw) ? raw : null;
}

function safeHandle(raw: string | null): string | undefined {
  const handle = raw?.trim().replace(/^@/, "").toLowerCase();
  if (
    !handle ||
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
      .test(handle)
  ) {
    return undefined;
  }
  return handle;
}

function SignInPageContent(
  { account, next, intent, initialHandle }: {
    account: ReturnType<typeof buildAccountMenuProps>;
    next: string;
    intent?: "user" | "project";
    initialHandle?: string;
  },
) {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} disableScrollEffects />
        <section class="signin-page-section">
          <div class="container signin-page-container">
            <p class="text-eyebrow">Atmosphere Account</p>
            <h1 class="text-section">Use your account anywhere.</h1>
            <p class="text-body mt-2">
              Continue with a saved account, search by handle, or choose a host
              to create a new account.
            </p>
            <div class="glass signin-page-card">
              {isOAuthConfigured()
                ? (
                  <SignInForm
                    returnTo={next}
                    intent={intent}
                    rememberedAccounts={account.rememberedAccounts}
                    initialHandle={initialHandle}
                    rich
                  />
                )
                : (
                  <p class="text-body">
                    OAuth is not configured on this deployment yet. Try again
                    shortly.
                  </p>
                )}
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
