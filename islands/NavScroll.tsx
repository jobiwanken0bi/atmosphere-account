import { useEffect } from "preact/hooks";

export default function NavScroll() {
  useEffect(() => {
    const nav = document.getElementById("main-nav");
    if (!nav) return;

    const path = globalThis.location.pathname;
    nav.querySelectorAll<HTMLAnchorElement>(".nav-links .nav-btn").forEach(
      (link) => {
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
      },
    );

    const onScroll = () => {
      if (globalThis.scrollY > 40) {
        nav.classList.add("scrolled");
      } else {
        nav.classList.remove("scrolled");
      }
    };

    onScroll();
    globalThis.addEventListener("scroll", onScroll, { passive: true });
    return () => globalThis.removeEventListener("scroll", onScroll);
  }, []);

  return <span hidden aria-hidden="true" data-nav-scroll-sentinel />;
}
