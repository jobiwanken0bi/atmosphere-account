import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import Footer from "../components/Footer.tsx";
import DocsLayout from "../components/DocsLayout.tsx";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import { defaultDocsSlug, getDocsPage } from "../lib/platform-docs.ts";

export const handler = define.handlers({
  GET(ctx) {
    const page = getDocsPage(defaultDocsSlug)!;
    ctx.state.pageMeta = {
      title: "Atmosphere Account Docs",
      description: page.description,
      canonicalUrl: new URL("/docs", ctx.url.origin).href,
    };
    return ctx.render(
      <DocsPage
        account={buildAccountMenuProps(ctx.state)}
        page={page}
        origin={ctx.url.origin}
      />,
    );
  },
});

function DocsPage(
  { account, page, origin }: {
    account: ReturnType<typeof buildAccountMenuProps>;
    page: NonNullable<ReturnType<typeof getDocsPage>>;
    origin: string;
  },
) {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} disableScrollEffects />
        <DocsLayout page={page} origin={origin} />
        <Footer variant="compact" />
      </div>
    </div>
  );
}
