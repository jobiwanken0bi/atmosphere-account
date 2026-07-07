import { define } from "../utils.ts";
import { getMessages, I18nProvider } from "../i18n/mod.ts";

/** Open Graph / social crawlers prefer absolute image URLs. Set FRESH_PUBLIC_SITE_URL on Deno Deploy (e.g. https://atmosphereaccount.com). */
function socialImageUrl(path: string): string {
  // Already absolute — return as-is so callers that pass a full URL
  // (e.g. pageMeta.imageUrl built with ctx.url.origin) don't get double-prefixed.
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = Deno.env.get("FRESH_PUBLIC_SITE_URL")?.replace(/\/$/, "");
  if (base) return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return path;
}

export default define.page(function App(ctx) {
  const { Component, state, url } = ctx;
  const locale = state.locale;
  const t = getMessages(locale);
  const htmlClass = "sky-static";
  const bodyClass = "sky-bg";
  const isStandaloneLoginPicker = url.pathname === "/login/select";
  const needsSigninPreview = url.pathname === "/signin" ||
    isStandaloneLoginPicker ||
    url.pathname === "/apps/create" ||
    url.pathname === "/account";
  const needsDocsScript = url.pathname === "/docs" ||
    url.pathname.startsWith("/docs/");
  const needsBskyCdnPreconnect = url.pathname.startsWith("/apps") ||
    url.pathname.startsWith("/hosts") ||
    url.pathname.startsWith("/account") ||
    url.pathname.startsWith("/signin") ||
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/users");
  const socialImagePath = url.pathname.startsWith("/docs") ||
      url.pathname.startsWith("/developer-resources")
    ? "/og-developer.png"
    : url.pathname.startsWith("/apps")
    ? "/og-explore.png"
    : "/og-hero.png";
  const defaultSocialImageAlt = url.pathname.startsWith("/docs") ||
      url.pathname.startsWith("/developer-resources")
    ? "Atmosphere developer resources: tools to make the Atmosphere easier to understand."
    : url.pathname.startsWith("/apps")
    ? "Atmosphere apps, profiles, reviews, and updates."
    : t.meta.ogImageAlt;
  /**
   * Per-page OG overrides set by route handlers via `ctx.state.pageMeta`.
   * Used by project pages so the project's banner becomes the share-card
   * image (instead of the generic `/og-explore.png`) and the title /
   * description match the project. We still fall back to the site-wide
   * defaults for any field a page doesn't override.
   */
  const pageMeta = state.pageMeta ?? {};
  const pageTitle = pageMeta.title ?? t.meta.title;
  const pageDescription = pageMeta.description ?? t.meta.description;
  const pageOgType = pageMeta.ogType ?? "website";
  const pageOgImage = pageMeta.imageUrl
    ? socialImageUrl(pageMeta.imageUrl)
    : socialImageUrl(socialImagePath);
  const pageOgImageAlt = pageMeta.imageAlt ?? defaultSocialImageAlt;
  const pageOgImageWidth = pageMeta.imageWidth ?? 1200;
  const pageOgImageHeight = pageMeta.imageHeight ?? 630;
  return (
    <html lang={locale} class={htmlClass}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {
          /* Light-only design: opt out of browser auto-dark so the sky gradient
            and native controls don't get force-darkened on dark-mode devices. */
        }
        <meta name="color-scheme" content="light" />
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta property="og:title" content={pageMeta.title ?? t.meta.ogTitle} />
        <meta
          property="og:description"
          content={pageMeta.description ?? t.meta.ogDescription}
        />
        <meta property="og:locale" content={locale} />
        <meta property="og:type" content={pageOgType} />
        {pageMeta.canonicalUrl && (
          <>
            <link rel="canonical" href={pageMeta.canonicalUrl} />
            <meta property="og:url" content={pageMeta.canonicalUrl} />
          </>
        )}
        <meta
          name="twitter:title"
          content={pageMeta.title ?? t.meta.ogTitle}
        />
        <meta
          name="twitter:description"
          content={pageMeta.description ?? t.meta.ogDescription}
        />
        <meta property="og:image" content={pageOgImage} />
        <meta property="og:image:secure_url" content={pageOgImage} />
        <meta
          property="og:image:type"
          content={pageMeta.imageType ?? "image/jpeg"}
        />
        <meta property="og:image:width" content={String(pageOgImageWidth)} />
        <meta property="og:image:height" content={String(pageOgImageHeight)} />
        <meta property="og:image:alt" content={pageOgImageAlt} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content={pageOgImage} />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/svg+xml" href="/union.svg" />
        <link rel="apple-touch-icon" href="/union.svg" />
        <link rel="stylesheet" href="/styles.css" />
        {needsBskyCdnPreconnect && (
          <link rel="preconnect" href="https://cdn.bsky.app" />
        )}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossorigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap"
        />
      </head>
      <body class={bodyClass}>
        <I18nProvider locale={locale}>
          <Component />
        </I18nProvider>
        <script type="module" src="/page-skeleton.js" />
        {!isStandaloneLoginPicker && (
          <script type="module" src="/nav-scroll.js" />
        )}
        {needsDocsScript && (
          <script type="module" src="/docs.js?v=scrollspy2" />
        )}
        {needsSigninPreview && (
          <script type="module" src="/signin-preview.js" />
        )}
      </body>
    </html>
  );
});
