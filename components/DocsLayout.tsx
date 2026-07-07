import type { DocsBlock, DocsPage } from "../lib/platform-docs.ts";
import { docsPages, groupedDocsPages } from "../lib/platform-docs.ts";
import AtmosphereLoginConsole from "../islands/AtmosphereLoginConsole.tsx";
import SvgIconDownloads from "../islands/SvgIconDownloads.tsx";

export default function DocsLayout(
  { page, origin }: { page: DocsPage; origin: string },
) {
  return (
    <section class="docs-shell-section">
      <div class="container docs-shell">
        <aside class="docs-sidebar" aria-label="Docs navigation">
          <a href="/docs" class="docs-sidebar-home">
            <span>Docs</span>
          </a>
          <nav class="docs-nav">
            {groupedDocsPages().map((group) => (
              <div class="docs-nav-group" key={group.group}>
                <p>{group.group}</p>
                {group.pages.map((item) => {
                  const active = item.slug === page.slug;
                  return (
                    <a
                      key={item.slug}
                      href={docsHref(item.slug)}
                      class={active ? "is-active" : ""}
                      aria-current={active ? "page" : undefined}
                    >
                      {item.navTitle}
                    </a>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <main class="docs-main">
          <header class="docs-hero">
            <div class="docs-kicker-row">
              <p class="text-eyebrow">Docs / {page.group}</p>
              {page.status && (
                <span class="docs-status-badge">{page.status}</span>
              )}
            </div>
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <div class={docsSummaryGridClass(page.summary.length)}>
              {page.summary.map((item) => (
                <span key={item}>
                  <InlineText text={item} />
                </span>
              ))}
            </div>
            {(page.primaryCta || page.secondaryCta) && (
              <div class="docs-hero-actions">
                {page.primaryCta && (
                  <a
                    href={page.primaryCta.href}
                    class="docs-hero-cta docs-hero-cta--primary"
                  >
                    {page.primaryCta.label}
                  </a>
                )}
                {page.secondaryCta && (
                  <a
                    href={page.secondaryCta.href}
                    class="docs-hero-cta docs-hero-cta--secondary"
                  >
                    {page.secondaryCta.label}
                  </a>
                )}
              </div>
            )}
          </header>

          <div class="docs-content-grid">
            <article class="docs-content">
              {page.sections.map((section) => (
                <section id={section.id} class="docs-section" key={section.id}>
                  {section.eyebrow && (
                    <p class="text-eyebrow">{section.eyebrow}</p>
                  )}
                  <h2>{section.title}</h2>
                  {section.intro && (
                    <p class="docs-section-intro">{section.intro}</p>
                  )}
                  <div class="docs-blocks">
                    {section.blocks.map((block, index) => (
                      <DocsBlockView
                        block={block}
                        origin={origin}
                        key={`${section.id}-${index}`}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </article>

            <details class="docs-toc" open>
              <summary class="docs-toc-summary">On this page</summary>
              <div class="docs-toc-links">
                {page.sections.map((section) => (
                  <a href={`#${section.id}`} key={section.id}>
                    {section.title}
                  </a>
                ))}
              </div>
            </details>
          </div>

          {page.nextSteps && page.nextSteps.length > 0 && (
            <section class="docs-next-steps" aria-labelledby="docs-next-title">
              <p class="text-eyebrow">Next steps</p>
              <h2 id="docs-next-title">Keep building</h2>
              <div class={docsCardGridClass(page.nextSteps.length)}>
                {page.nextSteps.map((item) => (
                  <a href={item.href} class="docs-card-link" key={item.href}>
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                    {item.label && <em>{item.label}</em>}
                  </a>
                ))}
              </div>
            </section>
          )}

          <nav class="docs-next-prev" aria-label="Docs pages">
            {previousPage(page)
              ? (
                <a
                  href={docsHref(previousPage(page)!.slug)}
                  class="docs-page-link docs-page-link--previous"
                >
                  <span>
                    Previous
                    {previousPage(page)!.group !== page.group &&
                      ` · ${previousPage(page)!.group}`}
                  </span>
                  <strong>{previousPage(page)!.navTitle}</strong>
                </a>
              )
              : <span class="docs-page-link-placeholder" aria-hidden="true" />}
            {nextPage(page)
              ? (
                <a
                  href={docsHref(nextPage(page)!.slug)}
                  class="docs-page-link docs-page-link--next"
                >
                  <span>
                    Next
                    {nextPage(page)!.group !== page.group &&
                      ` · ${nextPage(page)!.group}`}
                  </span>
                  <strong>{nextPage(page)!.navTitle}</strong>
                </a>
              )
              : <span class="docs-page-link-placeholder" aria-hidden="true" />}
          </nav>
        </main>
      </div>
    </section>
  );
}

function DocsBlockView(
  { block, origin }: { block: DocsBlock; origin: string },
) {
  switch (block.type) {
    case "paragraph":
      return (
        <p class="docs-paragraph">
          <InlineText text={block.body} />
        </p>
      );
    case "callout":
      return (
        <div class={`docs-callout docs-callout--${block.tone ?? "blue"}`}>
          <strong>{block.title}</strong>
          <p>
            <InlineText text={block.body} />
          </p>
        </div>
      );
    case "code":
      return (
        <figure class="docs-code" data-docs-code>
          <figcaption>
            <span>{block.caption ?? block.language.toUpperCase()}</span>
            <button
              type="button"
              class="docs-code-copy"
              data-docs-copy
              aria-label={`Copy ${block.caption ?? block.language} code`}
            >
              Copy
            </button>
          </figcaption>
          <pre><code>{block.code}</code></pre>
        </figure>
      );
    case "list":
      return (
        <ul class="docs-list">
          {block.items.map((item) => (
            <li key={item}>
              <InlineText text={item} />
            </li>
          ))}
        </ul>
      );
    case "checklist":
      return (
        <ul class="docs-checklist">
          {block.items.map((item) => (
            <li key={item}>
              <InlineText text={item} />
            </li>
          ))}
        </ul>
      );
    case "cards":
      return (
        <div class={docsCardGridClass(block.items.length)}>
          {block.items.map((item) => (
            <a href={item.href} class="docs-card-link" key={item.href}>
              <strong>{item.title}</strong>
              <span>
                <InlineText text={item.body} />
              </span>
              {item.label && <em>{item.label}</em>}
            </a>
          ))}
        </div>
      );
    case "diagram":
      return (
        <div class={`docs-diagram docs-diagram--${block.variant ?? "neutral"}`}>
          {block.title && <h3>{block.title}</h3>}
          <div class="docs-diagram-track">
            {block.items.map((item, index) => (
              <article class="docs-diagram-node" key={item.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.title}</strong>
                <p>
                  <InlineText text={item.body} />
                </p>
              </article>
            ))}
          </div>
        </div>
      );
    case "steps":
      return (
        <div class="docs-steps">
          {block.items.map((item, index) => (
            <article class="glass" key={item.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{item.title}</h3>
              <p>
                <InlineText text={item.body} />
              </p>
            </article>
          ))}
        </div>
      );
    case "table":
      return (
        <div class="docs-table-wrap">
          <table class="docs-table">
            <thead>
              <tr>
                {block.columns.map((column) => <th key={column}>{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell, index) => (
                    <td
                      key={cell}
                      data-label={block.columns[index] ?? ""}
                    >
                      <InlineText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "endpoint":
      return (
        <div class="docs-endpoint glass">
          <div>
            <span>{block.method}</span>
            <code>{block.path}</code>
          </div>
          <p>
            <InlineText text={block.body} />
          </p>
        </div>
      );
    case "iconDownloads":
      return (
        <div class="docs-icon-downloads glass">
          <SvgIconDownloads />
        </div>
      );
    case "atmosphereLoginConsole":
      return <AtmosphereLoginConsole defaultOrigin={origin} />;
  }
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g).filter((part) => part.length > 0);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("`") && part.endsWith("`")
          ? (
            <code class="docs-inline-code" key={`${part}-${index}`}>
              {part.slice(1, -1)}
            </code>
          )
          : part
      )}
    </>
  );
}

function docsCardGridClass(count: number): string {
  return `docs-card-grid docs-card-grid--count-${count}`;
}

function docsSummaryGridClass(count: number): string {
  return `docs-summary-grid docs-summary-grid--count-${count}`;
}

function docsHref(slug: string): string {
  return slug === "overview" ? "/docs" : `/docs/${slug}`;
}

function previousPage(page: DocsPage): DocsPage | null {
  const index = docsPages.findIndex((item) => item.slug === page.slug);
  return index > 0 ? docsPages[index - 1] : null;
}

function nextPage(page: DocsPage): DocsPage | null {
  const index = docsPages.findIndex((item) => item.slug === page.slug);
  return index >= 0 && index < docsPages.length - 1
    ? docsPages[index + 1]
    : null;
}
