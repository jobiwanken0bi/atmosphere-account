function syncNavState() {
  const nav = document.getElementById("main-nav");
  if (!nav) return;

  const path = globalThis.location.pathname;
  nav.querySelectorAll(".nav-links .nav-btn").forEach((link) => {
    const href = link.getAttribute("href");
    const active = href === "/apps"
      ? path === "/apps" || path.startsWith("/apps/")
      : href === "/hosts"
      ? path === "/hosts" || path.startsWith("/hosts/")
      : href === path;

    if (active) {
      link.setAttribute("aria-current", "page");
      link.dataset.current = "true";
    } else {
      link.removeAttribute("aria-current");
      delete link.dataset.current;
    }
  });

  if (nav.dataset.scrollEffects === "false") {
    nav.classList.remove("scrolled");
    return;
  }

  nav.classList.toggle("scrolled", globalThis.scrollY > 40);
}

syncNavState();
globalThis.addEventListener("scroll", syncNavState, { passive: true });
globalThis.addEventListener("pageshow", syncNavState);
