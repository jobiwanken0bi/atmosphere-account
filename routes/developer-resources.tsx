import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import DeveloperResources from "../components/DeveloperResources.tsx";
import Footer from "../components/Footer.tsx";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import { getProfileByDid } from "../lib/registry.ts";

function DeveloperResourcesPage(
  { account }: { account: ReturnType<typeof buildAccountMenuProps> },
) {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} disableScrollEffects />
        <section style={{ paddingTop: "8rem" }}>
          <DeveloperResources />
        </section>
        <Footer />
      </div>
    </div>
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    const ownerProfile = user
      ? await getProfileByDid(user.did).catch(() => null)
      : null;
    return ctx.render(
      <DeveloperResourcesPage
        account={buildAccountMenuProps(ctx.state, ownerProfile?.handle ?? null)}
      />,
    );
  },
});
