const skeletonId = "page-loading-skeleton";
let showTimer = 0;

function isNonHomePage(url) {
  return url.origin === globalThis.location.origin && url.pathname !== "/";
}

function ensureSkeleton() {
  let skeleton = document.getElementById(skeletonId);
  if (skeleton) return skeleton;

  skeleton = document.createElement("div");
  skeleton.id = skeletonId;
  skeleton.className = "page-skeleton";
  skeleton.setAttribute("aria-hidden", "true");
  skeleton.innerHTML = `
    <div class="page-skeleton-nav">
      <span class="page-skeleton-logo"></span>
      <span class="page-skeleton-pill"></span>
    </div>
    <main class="page-skeleton-main">
      <section class="page-skeleton-card page-skeleton-card--hero">
        <span class="page-skeleton-block page-skeleton-block--title"></span>
        <span class="page-skeleton-block page-skeleton-block--body"></span>
        <span class="page-skeleton-block page-skeleton-block--short"></span>
      </section>
      <section class="page-skeleton-grid">
        <span class="page-skeleton-card"></span>
        <span class="page-skeleton-card"></span>
        <span class="page-skeleton-card"></span>
      </section>
    </main>
  `;
  document.body.appendChild(skeleton);
  return skeleton;
}

function showSkeleton() {
  ensureSkeleton().classList.add("page-skeleton--visible");
}

function scheduleSkeleton() {
  clearTimeout(showTimer);
  showTimer = globalThis.setTimeout(showSkeleton, 120);
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
  if (!isNonHomePage(url)) return;

  scheduleSkeleton();
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  globalThis.setTimeout(() => {
    if (event.defaultPrevented) return;
    const url = new URL(form.action || globalThis.location.href);
    if (!isNonHomePage(url) || url.pathname.startsWith("/api/")) return;
    scheduleSkeleton();
  }, 0);
});

globalThis.addEventListener("pageshow", hideSkeleton);
