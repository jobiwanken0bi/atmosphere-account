import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import DocsLayout from "../../components/DocsLayout.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getDocsPage } from "../../lib/platform-docs.ts";

export const handler = define.handlers({
  GET(ctx) {
    const slug = decodeURIComponent(ctx.params.slug);
    const page = getDocsPage(slug);
    if (!page) {
      return new Response(null, {
        status: 303,
        headers: { location: "/docs" },
      });
    }
    ctx.state.pageMeta = {
      title: `${page.title} — Atmosphere Account Docs`,
      description: page.description,
      canonicalUrl: new URL(`/docs/${page.slug}`, ctx.url.origin).href,
    };
    return ctx.render(
      <DocsRoutePage
        account={buildAccountMenuProps(ctx.state)}
        page={page}
        origin={ctx.url.origin}
      />,
    );
  },
});

function DocsRoutePage(
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
