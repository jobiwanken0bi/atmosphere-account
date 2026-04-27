import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getEffectiveAccountType } from "../../lib/account-types.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return new Response(null, {
        status: 303,
        headers: {
          location: `/explore/create?next=${
            encodeURIComponent("/account/type")
          }`,
        },
      });
    }

    const existingType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (existingType === "project") {
      return new Response(null, {
        status: 303,
        headers: { location: "/explore/manage" },
      });
    }
    if (existingType === "user") {
      return new Response(null, {
        status: 303,
        headers: { location: "/account/reviews" },
      });
    }

    return ctx.render(
      <AccountTypePage
        account={buildAccountMenuProps(ctx.state)}
        handle={user.handle}
        t={getMessages(ctx.state.locale)}
      />,
    );
  },
});

interface AccountTypePageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  handle: string;
  // deno-lint-ignore no-explicit-any
  t: any;
}

function AccountTypePage({ account, handle, t }: AccountTypePageProps) {
  const copy = t.accountType;
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav account={account} />
        <section class="account-type-section">
          <div class="modal-backdrop account-type-backdrop">
            <div class="modal-card account-type-card">
              <div class="modal-header">
                <p class="modal-title">{copy.title}</p>
                <p class="modal-body-text">{copy.body(handle)}</p>
              </div>
              <div class="account-type-options">
                <form method="POST" action="/api/account/type">
                  <input type="hidden" name="accountType" value="user" />
                  <button type="submit" class="account-type-option">
                    <strong>{copy.userTitle}</strong>
                    <span>{copy.userBody}</span>
                  </button>
                </form>
                <form method="POST" action="/api/account/type">
                  <input type="hidden" name="accountType" value="project" />
                  <button type="submit" class="account-type-option">
                    <strong>{copy.projectTitle}</strong>
                    <span>{copy.projectBody}</span>
                  </button>
                </form>
              </div>
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
