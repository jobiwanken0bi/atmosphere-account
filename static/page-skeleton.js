const skeletonId = "page-loading-skeleton";
let showTimer = 0;

function isSkeletonPage(url) {
  return url.origin === globalThis.location.origin &&
    !url.pathname.startsWith("/api/");
}

function routeKind(pathname) {
  if (pathname === "/") return "home";
  if (pathname === "/developer-resources") return "developer";
  if (pathname === "/explore") return "explore";
  if (pathname.startsWith("/explore/")) return "profile";
  if (pathname.startsWith("/users/")) return "user";
  return "default";
}

function navMarkup() {
  return `
    <div class="page-skeleton-nav">
      <span class="page-skeleton-logo"></span>
      <span class="page-skeleton-pill"></span>
    </div>
  `;
}

function line(className = "") {
  return `<span class="page-skeleton-block ${className}"></span>`;
}

function card(className = "") {
  return `<span class="page-skeleton-card ${className}"></span>`;
}

function templateFor(kind) {
  if (kind === "home") {
    return `
      ${navMarkup()}
      <main class="page-skeleton-main page-skeleton-main--home">
        <section class="page-skeleton-hero-split">
          <div>
            ${line("page-skeleton-block--eyebrow")}
            ${line("page-skeleton-block--title page-skeleton-block--wide")}
            ${line("page-skeleton-block--body")}
            ${line("page-skeleton-block--body page-skeleton-block--short")}
            <div class="page-skeleton-row">
              ${line("page-skeleton-block--button")}
              ${
      line("page-skeleton-block--button page-skeleton-block--button-secondary")
    }
            </div>
          </div>
          ${card("page-skeleton-card--cloud")}
        </section>
        <section class="page-skeleton-grid page-skeleton-grid--feature">
          ${card()}${card()}${card()}
        </section>
      </main>
    `;
  }

  if (kind === "explore") {
    return `
      ${navMarkup()}
      <main class="page-skeleton-main">
        <section class="page-skeleton-card page-skeleton-card--hero">
          ${line("page-skeleton-block--title")}
          ${line("page-skeleton-block--body")}
          ${line("page-skeleton-block--short")}
        </section>
        <section class="page-skeleton-tabs">
          ${line("page-skeleton-block--tab")}
          ${line("page-skeleton-block--tab")}
          ${line("page-skeleton-block--tab")}
          ${line("page-skeleton-block--tab")}
        </section>
        <section class="page-skeleton-grid page-skeleton-grid--profiles">
          ${card("page-skeleton-card--profile")}
          ${card("page-skeleton-card--profile")}
          ${card("page-skeleton-card--profile")}
          ${card("page-skeleton-card--profile")}
          ${card("page-skeleton-card--profile")}
          ${card("page-skeleton-card--profile")}
        </section>
      </main>
    `;
  }

  if (kind === "profile" || kind === "user") {
    return `
      ${navMarkup()}
      <main class="page-skeleton-main page-skeleton-main--profile">
        <section class="page-skeleton-card page-skeleton-profile-card">
          <span class="page-skeleton-avatar"></span>
          <div class="page-skeleton-profile-lines">
            ${line("page-skeleton-block--title")}
            ${line("page-skeleton-block--short")}
            ${line("page-skeleton-block--body")}
          </div>
        </section>
        ${
      kind === "profile"
        ? `
          <section class="page-skeleton-grid page-skeleton-grid--screenshots">
            ${card("page-skeleton-card--screenshot")}
            ${card("page-skeleton-card--screenshot")}
          </section>
          ${card("page-skeleton-card--reviews")}
        `
        : card("page-skeleton-card--reviews")
    }
      </main>
    `;
  }

  if (kind === "developer") {
    return `
      ${navMarkup()}
      <main class="page-skeleton-main page-skeleton-main--developer">
        <section class="page-skeleton-card page-skeleton-card--resource">
          ${line("page-skeleton-block--title")}
          ${line("page-skeleton-block--body")}
          ${line("page-skeleton-block--badge")}
          <div class="page-skeleton-row">
            ${line("page-skeleton-block--button")}
            ${line("page-skeleton-block--button")}
          </div>
        </section>
        <section class="page-skeleton-grid page-skeleton-grid--resources">
          ${card("page-skeleton-card--resource-small")}
          ${card("page-skeleton-card--resource-small")}
          ${card("page-skeleton-card--resource-small")}
        </section>
      </main>
    `;
  }

  return `
    ${navMarkup()}
    <main class="page-skeleton-main">
      <section class="page-skeleton-card page-skeleton-card--hero">
        ${line("page-skeleton-block--title")}
        ${line("page-skeleton-block--body")}
        ${line("page-skeleton-block--short")}
      </section>
      <section class="page-skeleton-grid">
        ${card()}${card()}${card()}
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
    skeleton.setAttribute("aria-hidden", "true");
    document.body.appendChild(skeleton);
  }

  if (skeleton.dataset.kind !== kind) {
    skeleton.dataset.kind = kind;
    skeleton.innerHTML = templateFor(kind);
  }
  return skeleton;
}

function showSkeleton(kind) {
  ensureSkeleton(kind).classList.add("page-skeleton--visible");
}

function scheduleSkeleton(url) {
  clearTimeout(showTimer);
  const kind = routeKind(url.pathname);
  showTimer = globalThis.setTimeout(() => showSkeleton(kind), 120);
}

function hideSkeleton() {
  clearTimeout(showTimer);
  document.getElementById(skeletonId)?.classList.remove(
    "page-skeleton--visible",
  );
}

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

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

  globalThis.setTimeout(() => {
    if (event.defaultPrevented) return;
    const url = new URL(form.action || globalThis.location.href);
    if (!isSkeletonPage(url)) return;
    scheduleSkeleton(url);
  }, 0);
});

globalThis.addEventListener("pageshow", hideSkeleton);
