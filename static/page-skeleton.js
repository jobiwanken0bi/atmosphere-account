const skeletonId = "page-loading-skeleton";
const skeletonDelayMs = 220;
const skeletonSafetyMs = 12_000;
let showTimer = 0;
let safetyTimer = 0;

export function isSkeletonPage(
  url,
  currentOrigin = globalThis.location?.origin,
) {
  return Boolean(currentOrigin) && url.origin === currentOrigin &&
    !url.pathname.startsWith("/api/");
}

export function routeKind(pathname) {
  if (pathname === "/") return "home";
  if (pathname === "/apps" || pathname === "/explore") return "apps-home";
  if (pathname === "/apps/all") return "apps-browse";
  if (pathname === "/apps/categories") return "apps-categories";
  if (pathname === "/account/products") return "managed-products";
  if (
    pathname === "/apps/manage" || pathname === "/explore/manage" ||
    pathname === "/apps/create" || pathname === "/explore/create" ||
    pathname === "/apps/migrate-from-legacy"
  ) return "form";
  if (pathname.startsWith("/apps/") || pathname.startsWith("/explore/")) {
    return pathname.includes("/manage/") ? "form" : "app-detail";
  }
  if (pathname === "/hosts") return "hosts";
  if (
    pathname === "/hosts/claim" || pathname === "/hosts/register" ||
    (pathname.startsWith("/hosts/") &&
      (pathname.endsWith("/claim") || pathname.endsWith("/manage") ||
        pathname.includes("/manage/")))
  ) return "form";
  if (pathname.startsWith("/hosts/")) return "host-detail";
  if (pathname === "/signin") return "signin";
  if (pathname === "/account") return "account";
  if (pathname.startsWith("/account/developer/")) return "workspace-form";
  if (pathname.startsWith("/account/")) return "account-section";
  if (pathname === "/passkeys") return "passkeys";
  if (pathname === "/login/select") return "picker";
  if (
    pathname === "/developer-resources" || pathname === "/docs" ||
    pathname.startsWith("/docs/")
  ) return "docs";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return "managed-products";
  }
  if (pathname.startsWith("/users/")) return "user";
  if (pathname.startsWith("/relationships/")) return "form";
  return "default";
}

function line(className = "") {
  return `<span class="page-skeleton-shape page-skeleton-line ${className}"></span>`;
}

function shape(className = "") {
  return `<span class="page-skeleton-shape ${className}"></span>`;
}

function sectionHeading() {
  return `
    <div class="page-skeleton-section-heading">
      <span class="page-skeleton-heading-copy">
        ${line("page-skeleton-line--eyebrow")}
        ${line("page-skeleton-line--section-title")}
      </span>
      ${shape("page-skeleton-section-link")}
    </div>
  `;
}

function directoryHero({ back = false, filter = true } = {}) {
  return `
    <header class="page-skeleton-directory-hero${
    back ? " page-skeleton-directory-hero--with-back" : ""
  }">
      ${back ? shape("page-skeleton-back-link") : ""}
      ${line("page-skeleton-line--eyebrow")}
      ${line("page-skeleton-line--directory-title")}
      <span class="page-skeleton-copy-lines page-skeleton-copy-lines--center">
        ${line("page-skeleton-line--body")}
        ${line("page-skeleton-line--body-short")}
      </span>
      <span class="page-skeleton-search-row">
        ${shape("page-skeleton-search")}
        ${filter ? shape("page-skeleton-filter") : ""}
      </span>
    </header>
  `;
}

function appCard() {
  return `
    <span class="page-skeleton-card page-skeleton-app-card">
      ${shape("page-skeleton-app-icon")}
      <span class="page-skeleton-card-copy">
        ${line("page-skeleton-line--card-title")}
        ${line("page-skeleton-line--meta")}
        ${line("page-skeleton-line--body")}
        <span class="page-skeleton-chip-row">
          ${shape("page-skeleton-chip")}
          ${shape("page-skeleton-chip page-skeleton-chip--short")}
        </span>
      </span>
    </span>
  `;
}

function appMediaCard(className = "") {
  return `
    <span class="page-skeleton-card page-skeleton-media-card ${className}">
      ${shape("page-skeleton-card-media")}
      <span class="page-skeleton-media-footer">
        ${shape("page-skeleton-app-icon page-skeleton-app-icon--small")}
        <span class="page-skeleton-card-copy">
          ${line("page-skeleton-line--card-title")}
          ${line("page-skeleton-line--meta")}
        </span>
      </span>
    </span>
  `;
}

function hostCard() {
  return `
    <span class="page-skeleton-card page-skeleton-host-card">
      <span class="page-skeleton-host-card-top">
        ${shape("page-skeleton-host-mark")}
        <span class="page-skeleton-card-copy">
          ${line("page-skeleton-line--card-title")}
          ${line("page-skeleton-line--meta")}
        </span>
        ${shape("page-skeleton-count")}
      </span>
      ${line("page-skeleton-line--body")}
      ${line("page-skeleton-line--body-short")}
      <span class="page-skeleton-chip-row">
        ${shape("page-skeleton-chip")}
        ${shape("page-skeleton-chip")}
      </span>
    </span>
  `;
}

function panel(className = "") {
  return `
    <span class="page-skeleton-card page-skeleton-panel ${className}">
      <span class="page-skeleton-panel-heading">
        ${shape("page-skeleton-panel-icon")}
        <span class="page-skeleton-card-copy">
          ${line("page-skeleton-line--eyebrow")}
          ${line("page-skeleton-line--section-title")}
          ${line("page-skeleton-line--body")}
        </span>
      </span>
      <span class="page-skeleton-panel-row"></span>
      <span class="page-skeleton-panel-row page-skeleton-panel-row--short"></span>
    </span>
  `;
}

export function templateFor(kind) {
  if (kind === "home") {
    return `
      <main class="page-skeleton-home">
        <section class="page-skeleton-home-hero">
          ${line("page-skeleton-line--home-eyebrow")}
          <span class="page-skeleton-home-title">
            ${line()}${line("page-skeleton-line--home-title-short")}
          </span>
          <span class="page-skeleton-copy-lines page-skeleton-copy-lines--center">
            ${line("page-skeleton-line--home-body")}
            ${line("page-skeleton-line--home-body-short")}
          </span>
          ${shape("page-skeleton-scroll-cue")}
        </section>
      </main>
    `;
  }

  if (kind === "apps-home") {
    return `
      <main class="page-skeleton-stage page-skeleton-stage--directory page-skeleton-stage--apps-home">
        ${directoryHero()}
        <section class="page-skeleton-directory-section">
          ${sectionHeading()}
          <div class="page-skeleton-spotlight-grid">
            ${appMediaCard("page-skeleton-media-card--lead")}
            <span class="page-skeleton-promo-stack">
              ${appMediaCard()}${appMediaCard()}
            </span>
          </div>
        </section>
        <section class="page-skeleton-directory-section">
          ${sectionHeading()}
          <div class="page-skeleton-category-grid">
            ${shape("page-skeleton-category-card")}
            ${shape("page-skeleton-category-card")}
            ${shape("page-skeleton-category-card")}
          </div>
        </section>
      </main>
    `;
  }

  if (kind === "apps-browse" || kind === "apps-categories") {
    return `
      <main class="page-skeleton-stage page-skeleton-stage--directory page-skeleton-stage--browse">
        ${directoryHero({ back: true, filter: kind === "apps-browse" })}
        <section class="page-skeleton-directory-section page-skeleton-directory-section--results">
          ${sectionHeading()}
          <div class="${
      kind === "apps-categories"
        ? "page-skeleton-category-grid page-skeleton-category-grid--full"
        : "page-skeleton-app-grid"
    }">
            ${
      kind === "apps-categories"
        ? Array.from({ length: 9 }, () => shape("page-skeleton-category-card"))
          .join("")
        : Array.from({ length: 6 }, appCard).join("")
    }
          </div>
        </section>
      </main>
    `;
  }

  if (kind === "hosts") {
    return `
      <main class="page-skeleton-stage page-skeleton-stage--hosts">
        <header class="page-skeleton-hosts-header">
          ${line("page-skeleton-line--eyebrow")}
          ${line("page-skeleton-line--directory-title")}
          <span class="page-skeleton-copy-lines page-skeleton-copy-lines--center">
            ${line("page-skeleton-line--body")}
            ${line("page-skeleton-line--body-short")}
          </span>
        </header>
        <div class="page-skeleton-search-row page-skeleton-search-row--hosts">
          ${shape("page-skeleton-search")}
          ${shape("page-skeleton-filter")}
        </div>
        ${line("page-skeleton-line--summary")}
        <section class="page-skeleton-host-grid">
          ${Array.from({ length: 6 }, hostCard).join("")}
        </section>
      </main>
    `;
  }

  if (kind === "app-detail") {
    return `
      <main class="page-skeleton-stage page-skeleton-stage--profile page-skeleton-stage--app-detail">
        <div class="page-skeleton-profile-toolbar">
          ${shape("page-skeleton-back-link")}
          ${shape("page-skeleton-toolbar-action")}
        </div>
        ${shape("page-skeleton-card page-skeleton-project-banner")}
        <section class="page-skeleton-card page-skeleton-app-profile">
          <div class="page-skeleton-profile-summary">
            ${shape("page-skeleton-profile-avatar")}
            <span class="page-skeleton-card-copy page-skeleton-profile-copy">
              ${line("page-skeleton-line--profile-title")}
              ${line("page-skeleton-line--meta")}
              <span class="page-skeleton-chip-row">${
      shape("page-skeleton-chip")
    }</span>
            </span>
            <span class="page-skeleton-profile-actions">
              ${shape("page-skeleton-action-row")}
              ${shape("page-skeleton-action-row")}
            </span>
          </div>
          <span class="page-skeleton-profile-description">
            ${line("page-skeleton-line--body")}
            ${line("page-skeleton-line--body")}
            ${line("page-skeleton-line--body-short")}
          </span>
        </section>
        ${shape("page-skeleton-card page-skeleton-review-panel")}
      </main>
    `;
  }

  if (kind === "host-detail") {
    return `
      <main class="page-skeleton-stage page-skeleton-stage--profile page-skeleton-stage--host-detail">
        ${shape("page-skeleton-back-link")}
        <section class="page-skeleton-card page-skeleton-host-profile">
          ${
      shape("page-skeleton-profile-avatar page-skeleton-profile-avatar--host")
    }
          <span class="page-skeleton-card-copy page-skeleton-profile-copy">
            ${line("page-skeleton-line--profile-title")}
            ${line("page-skeleton-line--meta")}
            ${line("page-skeleton-line--meta page-skeleton-line--meta-wide")}
            <span class="page-skeleton-chip-row">
              ${shape("page-skeleton-chip")}${shape("page-skeleton-chip")}
            </span>
            ${line("page-skeleton-line--body")}
            ${line("page-skeleton-line--body-short")}
          </span>
          <span class="page-skeleton-profile-actions page-skeleton-profile-actions--host">
            ${shape("page-skeleton-action-row")}
            ${shape("page-skeleton-action-row")}
            ${shape("page-skeleton-action-row")}
          </span>
        </section>
        <section class="page-skeleton-choice-grid">
          ${
      Array.from({ length: 4 }, () => `
            <span class="page-skeleton-card page-skeleton-choice-card">
              ${shape("page-skeleton-panel-icon")}
              <span class="page-skeleton-card-copy">
                ${line("page-skeleton-line--eyebrow")}
                ${line("page-skeleton-line--card-title")}
                ${line("page-skeleton-line--body")}
              </span>
            </span>`).join("")
    }
        </section>
        ${shape("page-skeleton-card page-skeleton-details-row")}
      </main>
    `;
  }

  if (kind === "user") {
    return `
      <main class="page-skeleton-stage page-skeleton-stage--user">
        ${shape("page-skeleton-back-link")}
        <section class="page-skeleton-card page-skeleton-user-card">
          ${shape("page-skeleton-profile-avatar")}
          <span class="page-skeleton-card-copy">
            ${line("page-skeleton-line--profile-title")}
            ${line("page-skeleton-line--meta")}
            ${line("page-skeleton-line--body")}
            ${line("page-skeleton-line--body-short")}
          </span>
        </section>
      </main>
    `;
  }

  if (kind === "account") {
    return `
      <main class="page-skeleton-stage page-skeleton-stage--account">
        <header class="page-skeleton-account-heading">
          ${line("page-skeleton-line--eyebrow")}
          ${line("page-skeleton-line--account-title")}
          ${line("page-skeleton-line--body")}
        </header>
        <section class="page-skeleton-card page-skeleton-account-hero">
          <span class="page-skeleton-account-identity">
            ${
      shape("page-skeleton-profile-avatar page-skeleton-profile-avatar--round")
    }
            <span class="page-skeleton-card-copy">
              ${line("page-skeleton-line--eyebrow")}
              ${line("page-skeleton-line--profile-title")}
              ${line("page-skeleton-line--meta")}
              <span class="page-skeleton-chip-row">${
      shape("page-skeleton-chip")
    }</span>
            </span>
          </span>
          <span class="page-skeleton-account-source">
            ${line("page-skeleton-line--eyebrow")}
            ${line("page-skeleton-line--card-title")}
            ${line("page-skeleton-line--body")}
            ${line("page-skeleton-line--body-short")}
            ${shape("page-skeleton-action-row")}
          </span>
        </section>
        <section class="page-skeleton-account-panels">
          ${panel("page-skeleton-panel--host")}
          ${panel("page-skeleton-panel--apps")}
        </section>
      </main>
    `;
  }

  if (kind === "managed-products" || kind === "account-section") {
    return `
      <main class="page-skeleton-stage page-skeleton-stage--workspace">
        ${shape("page-skeleton-back-link")}
        <header class="page-skeleton-workspace-heading">
          ${line("page-skeleton-line--eyebrow")}
          ${line("page-skeleton-line--account-title")}
          ${line("page-skeleton-line--body")}
          ${line("page-skeleton-line--body-short")}
          <span class="page-skeleton-chip-row">
            ${shape("page-skeleton-chip")}${shape("page-skeleton-chip")}${
      shape("page-skeleton-chip")
    }
          </span>
        </header>
        <section class="page-skeleton-workspace-panels">
          ${panel("page-skeleton-panel--workspace")}
          ${panel("page-skeleton-panel--workspace")}
          ${panel("page-skeleton-panel--workspace")}
        </section>
      </main>
    `;
  }

  if (kind === "workspace-form") {
    return `
      <main class="page-skeleton-stage page-skeleton-stage--account page-skeleton-stage--workspace-form">
        ${shape("page-skeleton-back-link")}
        ${panel("page-skeleton-panel--workspace-hero")}
        <section class="page-skeleton-workspace-form-grid">
          <section class="page-skeleton-card page-skeleton-form-card">
            ${sectionHeading()}
            ${shape("page-skeleton-field")}
            ${shape("page-skeleton-field")}
            ${shape("page-skeleton-field")}
            ${shape("page-skeleton-field page-skeleton-field--tall")}
          </section>
          ${panel("page-skeleton-panel--workspace-side")}
        </section>
      </main>
    `;
  }

  if (kind === "signin" || kind === "form") {
    return `
      <main class="page-skeleton-stage page-skeleton-stage--signin">
        <header class="page-skeleton-signin-heading">
          ${line("page-skeleton-line--eyebrow")}
          ${line("page-skeleton-line--account-title")}
          ${line("page-skeleton-line--body")}
        </header>
        <section class="page-skeleton-card page-skeleton-signin-card">
          ${line("page-skeleton-line--eyebrow")}
          ${line("page-skeleton-line--card-title")}
          ${line("page-skeleton-line--body")}
          ${shape("page-skeleton-neutral-row")}
        </section>
      </main>
    `;
  }

  if (kind === "passkeys" || kind === "picker") {
    return `
      <main class="page-skeleton-stage page-skeleton-stage--picker">
        ${shape("page-skeleton-brand")}
        <header class="page-skeleton-picker-heading">
          ${line("page-skeleton-line--eyebrow")}
          ${line("page-skeleton-line--account-title")}
          ${line("page-skeleton-line--body")}
          ${line("page-skeleton-line--body-short")}
        </header>
        <section class="page-skeleton-card page-skeleton-picker-card">
          <span class="page-skeleton-picker-account">
            ${
      shape("page-skeleton-profile-avatar page-skeleton-profile-avatar--round")
    }
            <span class="page-skeleton-card-copy">
              ${line("page-skeleton-line--eyebrow")}
              ${line("page-skeleton-line--card-title")}
              ${line("page-skeleton-line--meta")}
            </span>
          </span>
          ${shape("page-skeleton-field")}
          ${shape("page-skeleton-neutral-row")}
          ${shape("page-skeleton-neutral-row")}
        </section>
      </main>
    `;
  }

  if (kind === "docs") {
    return `
      <main class="page-skeleton-docs">
        <aside class="page-skeleton-docs-sidebar">
          ${line("page-skeleton-line--card-title")}
          ${line("page-skeleton-line--meta")}
          ${line("page-skeleton-line--body-short")}
          ${line("page-skeleton-line--body")}
          ${line("page-skeleton-line--body-short")}
        </aside>
        <section class="page-skeleton-docs-content">
          <header class="page-skeleton-docs-hero">
            ${line("page-skeleton-line--eyebrow")}
            ${line("page-skeleton-line--account-title")}
            ${line("page-skeleton-line--body")}
            ${line("page-skeleton-line--body")}
            ${shape("page-skeleton-neutral-row")}
            ${shape("page-skeleton-neutral-row")}
          </header>
          ${panel("page-skeleton-panel--docs")}
        </section>
      </main>
    `;
  }

  return `
    <main class="page-skeleton-stage page-skeleton-stage--default">
      <section class="page-skeleton-card page-skeleton-default-card">
        ${line("page-skeleton-line--eyebrow")}
        ${line("page-skeleton-line--account-title")}
        ${line("page-skeleton-line--body")}
        ${line("page-skeleton-line--body-short")}
      </section>
    </main>
  `;
}

function ensureSkeleton(kind) {
  let skeleton = document.getElementById(skeletonId);
  if (!skeleton) {
    skeleton = document.createElement("div");
    skeleton.id = skeletonId;
    skeleton.className = "page-skeleton";
    skeleton.setAttribute("role", "status");
    skeleton.setAttribute("aria-live", "polite");
    skeleton.setAttribute("aria-label", "Loading page");
    document.body.appendChild(skeleton);
  }

  if (skeleton.dataset.kind !== kind) {
    skeleton.dataset.kind = kind;
    skeleton.innerHTML = `
      <span class="visually-hidden">Loading page…</span>
      <div class="page-skeleton-layout" aria-hidden="true">
        ${templateFor(kind)}
      </div>
    `;
  }
  return skeleton;
}

function showSkeleton(kind) {
  const skeleton = ensureSkeleton(kind);
  skeleton.classList.add("page-skeleton--visible");
  document.body.setAttribute("aria-busy", "true");
  clearTimeout(safetyTimer);
  safetyTimer = globalThis.setTimeout(hideSkeleton, skeletonSafetyMs);
}

function scheduleSkeleton(url) {
  clearTimeout(showTimer);
  const kind = routeKind(url.pathname);
  showTimer = globalThis.setTimeout(() => showSkeleton(kind), skeletonDelayMs);
}

function hideSkeleton() {
  clearTimeout(showTimer);
  clearTimeout(safetyTimer);
  document.getElementById(skeletonId)?.classList.remove(
    "page-skeleton--visible",
  );
  document.body.removeAttribute("aria-busy");
}

function installPageSkeleton() {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest("a[href]");
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.target && link.target !== "_self") return;
    if (link.hasAttribute("download")) return;

    const url = new URL(link.href, globalThis.location.href);
    if (url.hash && url.pathname === globalThis.location.pathname) return;
    if (!isSkeletonPage(url)) return;

    scheduleSkeleton(url);
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.target && form.target !== "_self") return;

    globalThis.setTimeout(() => {
      if (event.defaultPrevented) return;
      const url = new URL(form.action || globalThis.location.href);
      if (!isSkeletonPage(url)) return;
      scheduleSkeleton(url);
    }, 0);
  });

  globalThis.addEventListener("pageshow", hideSkeleton);
  globalThis.addEventListener("pagehide", hideSkeleton);
  document.addEventListener("atmo:hide-page-skeleton", hideSkeleton);
}

if (typeof document !== "undefined") installPageSkeleton();
