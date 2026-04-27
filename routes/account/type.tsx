import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
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

    const rawNext = ctx.url.searchParams.get("next");
    const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : null;

    const existingType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (existingType === "project") {
      return new Response(null, {
        status: 303,
        headers: { location: next ?? "/explore/manage" },
      });
    }
    if (existingType === "user") {
      return new Response(null, {
        status: 303,
        headers: { location: next ?? "/account/reviews" },
      });
    }

    return ctx.render(
      <AccountTypePage
        account={buildAccountMenuProps(ctx.state)}
        handle={user.handle}
        next={next}
        t={getMessages(ctx.state.locale)}
      />,
    );
  },
});

interface AccountTypePageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  handle: string;
  next: string | null;
  // deno-lint-ignore no-explicit-any
  t: any;
}

function AccountTypePage({ account, handle, next, t }: AccountTypePageProps) {
  const copy = t.accountType;
  return (
    <div id="page-top">
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
                  {next && <input type="hidden" name="next" value={next} />}
                  <button type="submit" class="account-type-option">
                    <strong>{copy.userTitle}</strong>
                    <span>{copy.userBody}</span>
                  </button>
                </form>
                <form method="POST" action="/api/account/type">
                  <input type="hidden" name="accountType" value="project" />
                  {next && <input type="hidden" name="next" value={next} />}
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
