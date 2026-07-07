const skeletonId = "page-loading-skeleton";
const skeletonDelayMs = 220;
let showTimer = 0;

function isSkeletonPage(url) {
  return url.origin === globalThis.location.origin &&
    !url.pathname.startsWith("/api/");
}

function routeKind(pathname) {
  if (pathname === "/") return "home";
  if (pathname === "/developer-resources") return "developer";
  if (pathname === "/apps" || pathname === "/explore") return "apps-home";
  if (pathname === "/apps/categories") return "apps-categories";
  if (pathname === "/apps/all") return "apps-browse";
  if (
    pathname === "/apps/create" || pathname === "/apps/manage" ||
    pathname === "/explore/create" || pathname === "/explore/manage"
  ) return "form";
  if (pathname.startsWith("/apps/") || pathname.startsWith("/explore/")) {
    return "app-detail";
  }
  if (pathname === "/hosts") return "hosts";
  if (pathname.startsWith("/hosts/")) return "host-detail";
  if (pathname === "/signin") return "signin";
  if (pathname === "/account" || pathname.startsWith("/account/")) {
    return "account";
  }
  if (pathname.startsWith("/users/")) return "user";
  return "default";
}

function navMarkup() {
  return "";
}

function line(className = "") {
  return `<span class="page-skeleton-block ${className}"></span>`;
}

function card(className = "") {
  return `<span class="page-skeleton-card ${className}"></span>`;
}

function filledCard(className = "", inner = "") {
  return `<span class="page-skeleton-card ${className}">${inner}</span>`;
}

function appCardContent() {
  return `
      <span class="page-skeleton-avatar page-skeleton-avatar--app"></span>
      <span class="page-skeleton-card-lines">
        ${line("page-skeleton-block--card-title")}
        ${line("page-skeleton-block--micro")}
        ${line("page-skeleton-block--body")}
        <span class="page-skeleton-row page-skeleton-row--chips">
          ${line("page-skeleton-block--chip")}
          ${line("page-skeleton-block--chip page-skeleton-block--chip-short")}
        </span>
      </span>
    `;
}

function appCard() {
  return filledCard("page-skeleton-card--app", appCardContent());
}

function hostCard() {
  return filledCard(
    "page-skeleton-card--host",
    `
      <span class="page-skeleton-host-card-top">
        <span class="page-skeleton-avatar page-skeleton-avatar--host"></span>
        <span class="page-skeleton-card-lines">
          ${line("page-skeleton-block--micro")}
          ${line("page-skeleton-block--card-title")}
        </span>
        ${line("page-skeleton-block--status")}
      </span>
      ${line("page-skeleton-block--body")}
      <span class="page-skeleton-row page-skeleton-row--chips">
        ${line("page-skeleton-block--chip")}
        ${line("page-skeleton-block--chip")}
      </span>
      ${line("page-skeleton-block--micro page-skeleton-block--wide")}
    `,
  );
}

function templateFor(kind) {
  if (kind === "home") {
    return `
      ${navMarkup()}
      <main class="page-skeleton-main page-skeleton-main--home">
        <section class="page-skeleton-hero-center page-skeleton-hero-home">
          ${line("page-skeleton-block--eyebrow")}
          ${line("page-skeleton-block--title page-skeleton-block--wide")}
          ${line("page-skeleton-block--body")}
          ${line("page-skeleton-block--body page-skeleton-block--short")}
        </section>
        <section class="page-skeleton-home-visual">
          ${card("page-skeleton-card--orbit")}
          ${line("page-skeleton-block--button")}
        </section>
        <section class="page-skeleton-grid page-skeleton-grid--feature">
          ${card()}${card()}${card()}
        </section>
      </main>
    `;
  }

  if (kind === "apps-home") {
    return `
      ${navMarkup()}
      <main class="page-skeleton-main page-skeleton-main--apps">
        <section class="page-skeleton-hero-center">
          ${line("page-skeleton-block--eyebrow")}
          ${line("page-skeleton-block--title page-skeleton-block--wide")}
          ${line("page-skeleton-block--body")}
          ${line("page-skeleton-block--body page-skeleton-block--short")}
          <span class="page-skeleton-search"></span>
        </section>
        <section class="page-skeleton-section-heading">
          <span>
            ${line("page-skeleton-block--eyebrow")}
            ${line("page-skeleton-block--title page-skeleton-block--heading")}
          </span>
          ${
      line("page-skeleton-block--button page-skeleton-block--button-small")
    }
        </section>
        <section class="page-skeleton-app-spotlight">
          ${
      filledCard(
        "page-skeleton-card--spotlight",
        `
            <span class="page-skeleton-spotlight-copy">
              ${line("page-skeleton-block--micro")}
              ${line("page-skeleton-block--title page-skeleton-block--wide")}
              ${line("page-skeleton-block--body")}
              <span class="page-skeleton-row page-skeleton-row--chips">
                ${line("page-skeleton-block--chip")}
                ${
          line("page-skeleton-block--chip page-skeleton-block--chip-short")
        }
              </span>
              ${line("page-skeleton-block--button")}
            </span>
            <span class="page-skeleton-media"></span>
          `,
      )
    }
          <span class="page-skeleton-promo-stack">
            ${filledCard("page-skeleton-card--promo", appCardContent())}
            ${filledCard("page-skeleton-card--promo", appCardContent())}
          </span>
        </section>
        <section class="page-skeleton-grid page-skeleton-grid--categories">
          ${card("page-skeleton-card--category")}
          ${card("page-skeleton-card--category")}
          ${card("page-skeleton-card--category")}
        </section>
        <section class="page-skeleton-grid page-skeleton-grid--ranked">
          ${card("page-skeleton-card--ranked")}
          ${card("page-skeleton-card--ranked")}
          ${card("page-skeleton-card--ranked")}
          ${card("page-skeleton-card--ranked")}
        </section>
      </main>
    `;
  }

  if (kind === "apps-browse") {
    return `
      ${navMarkup()}
      <main class="page-skeleton-main page-skeleton-main--apps">
        <section class="page-skeleton-top-link">
          ${
      line("page-skeleton-block--button page-skeleton-block--button-small")
    }
        </section>
        <section class="page-skeleton-hero-center page-skeleton-hero-center--compact">
          ${line("page-skeleton-block--eyebrow")}
          ${line("page-skeleton-block--title page-skeleton-block--wide")}
          ${line("page-skeleton-block--body")}
          <span class="page-skeleton-browse-controls">
            <span class="page-skeleton-search"></span>
            <span class="page-skeleton-filter-pill"></span>
          </span>
        </section>
        <section class="page-skeleton-section-heading">
          <span>
            ${line("page-skeleton-block--eyebrow")}
            ${line("page-skeleton-block--title page-skeleton-block--heading")}
          </span>
        </section>
        <section class="page-skeleton-grid page-skeleton-grid--profiles">
          ${appCard()}
          ${appCard()}
          ${appCard()}
          ${appCard()}
          ${appCard()}
          ${appCard()}
        </section>
      </main>
    `;
  }

  if (kind === "apps-categories") {
    return `
      ${navMarkup()}
      <main class="page-skeleton-main page-skeleton-main--apps">
        <section class="page-skeleton-top-link">
          ${
      line("page-skeleton-block--button page-skeleton-block--button-small")
    }
        </section>
        <section class="page-skeleton-hero-center page-skeleton-hero-center--compact">
          ${line("page-skeleton-block--eyebrow")}
          ${line("page-skeleton-block--title page-skeleton-block--wide")}
          ${line("page-skeleton-block--body")}
          <span class="page-skeleton-search"></span>
        </section>
        <section class="page-skeleton-section-heading">
          <span>
            ${line("page-skeleton-block--eyebrow")}
            ${line("page-skeleton-block--title page-skeleton-block--heading")}
          </span>
        </section>
        <section class="page-skeleton-grid page-skeleton-grid--categories">
          ${card("page-skeleton-card--category")}
          ${card("page-skeleton-card--category")}
          ${card("page-skeleton-card--category")}
          ${card("page-skeleton-card--category")}
          ${card("page-skeleton-card--category")}
          ${card("page-skeleton-card--category")}
        </section>
      </main>
    `;
  }

  if (kind === "hosts") {
    return `
      ${navMarkup()}
      <main class="page-skeleton-main page-skeleton-main--hosts">
        <section class="page-skeleton-hero-center page-skeleton-hero-center--compact">
          ${line("page-skeleton-block--eyebrow")}
          ${line("page-skeleton-block--title page-skeleton-block--wide")}
          ${line("page-skeleton-block--body")}
          <span class="page-skeleton-search"></span>
          <span class="page-skeleton-tabs">
            ${line("page-skeleton-block--tab")}
            ${line("page-skeleton-block--tab")}
            ${line("page-skeleton-block--tab")}
          </span>
        </section>
        <section class="page-skeleton-grid page-skeleton-grid--hosts">
          ${hostCard()}
          ${hostCard()}
          ${hostCard()}
          ${hostCard()}
        </section>
      </main>
    `;
  }

  if (kind === "app-detail" || kind === "user" || kind === "host-detail") {
    return `
      ${navMarkup()}
      <main class="page-skeleton-main page-skeleton-main--profile">
        <section class="page-skeleton-toolbar">
          ${
      line("page-skeleton-block--button page-skeleton-block--button-small")
    }
          ${
      line("page-skeleton-block--button page-skeleton-block--button-small")
    }
        </section>
        <section class="page-skeleton-card page-skeleton-profile-card">
          <span class="page-skeleton-avatar"></span>
          <div class="page-skeleton-profile-lines">
            ${line("page-skeleton-block--title")}
            ${line("page-skeleton-block--short")}
            ${line("page-skeleton-block--body")}
            <span class="page-skeleton-row page-skeleton-row--chips">
              ${line("page-skeleton-block--chip")}
              ${line("page-skeleton-block--chip")}
            </span>
          </div>
          ${kind === "user" ? "" : card("page-skeleton-card--actions")}
        </section>
        ${
      kind === "app-detail"
        ? `
          <section class="page-skeleton-grid page-skeleton-grid--screenshots">
            ${card("page-skeleton-card--screenshot")}
            ${card("page-skeleton-card--screenshot")}
          </section>
          ${card("page-skeleton-card--reviews")}
        `
        : kind === "host-detail"
        ? `
          <section class="page-skeleton-grid page-skeleton-grid--host-detail">
            ${card("page-skeleton-card--detail")}
            ${card("page-skeleton-card--detail")}
          </section>
          ${card("page-skeleton-card--details")}
        `
        : card("page-skeleton-card--reviews")
    }
      </main>
    `;
  }

  if (kind === "signin" || kind === "account") {
    return `
      ${navMarkup()}
      <main class="page-skeleton-main page-skeleton-main--account">
        <section class="page-skeleton-account-heading">
          ${line("page-skeleton-block--eyebrow")}
          ${line("page-skeleton-block--title page-skeleton-block--wide")}
          ${line("page-skeleton-block--body")}
        </section>
        ${
      kind === "signin"
        ? filledCard(
          "page-skeleton-card--signin",
          `
            ${line("page-skeleton-block--title page-skeleton-block--heading")}
            ${line("page-skeleton-block--body")}
            ${line("page-skeleton-block--input")}
            ${line("page-skeleton-block--button")}
          `,
        )
        : `
          ${
          filledCard(
            "page-skeleton-card--account-profile",
            `
              <span class="page-skeleton-avatar page-skeleton-avatar--round"></span>
              <span class="page-skeleton-card-lines">
                ${
              line("page-skeleton-block--title page-skeleton-block--heading")
            }
                ${line("page-skeleton-block--short")}
                ${line("page-skeleton-block--body")}
                <span class="page-skeleton-row">
                  ${line("page-skeleton-block--button")}
                  ${
              line(
                "page-skeleton-block--button page-skeleton-block--button-secondary",
              )
            }
                </span>
              </span>
            `,
          )
        }
          ${
          filledCard(
            "page-skeleton-card--account",
            `
              ${line("page-skeleton-block--title page-skeleton-block--heading")}
              ${line("page-skeleton-block--body")}
            `,
          )
        }
        `
    }
      </main>
    `;
  }

  if (kind === "form") {
    return `
      ${navMarkup()}
      <main class="page-skeleton-main page-skeleton-main--account">
        <section class="page-skeleton-account-heading">
          ${line("page-skeleton-block--eyebrow")}
          ${line("page-skeleton-block--title page-skeleton-block--wide")}
          ${line("page-skeleton-block--body")}
        </section>
        ${
      filledCard(
        "page-skeleton-card--form",
        `
          ${line("page-skeleton-block--input")}
          ${line("page-skeleton-block--input")}
          ${line("page-skeleton-block--input page-skeleton-block--input-tall")}
          <span class="page-skeleton-row">
            ${line("page-skeleton-block--button")}
            ${
          line(
            "page-skeleton-block--button page-skeleton-block--button-secondary",
          )
        }
          </span>
        `,
      )
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
  showTimer = globalThis.setTimeout(() => showSkeleton(kind), skeletonDelayMs);
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
document.addEventListener("atmo:hide-page-skeleton", hideSkeleton);
