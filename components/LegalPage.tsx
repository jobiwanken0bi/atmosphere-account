import type { ComponentChildren } from "preact";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import Footer from "./Footer.tsx";
import Nav from "./Nav.tsx";

interface LegalPageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  title: string;
  summary: string;
  children: ComponentChildren;
}

export default function LegalPage(
  { account, title, summary, children }: LegalPageProps,
) {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} disableScrollEffects />
        <main id="main-content" class="legal-page">
          <div class="container legal-page-container">
            <header class="legal-page-header">
              <p class="text-eyebrow">Legal</p>
              <h1 class="text-section">{title}</h1>
              <p class="legal-page-summary">{summary}</p>
              <p class="legal-page-effective">
                Effective <time dateTime="2026-08-09">August 9, 2026</time>
              </p>
            </header>
            <article class="legal-document">
              {children}
            </article>
          </div>
        </main>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
