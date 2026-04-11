import { useEffect } from "preact/hooks";

export default function NavScroll() {
  useEffect(() => {
    const nav = document.getElementById("main-nav");
    if (!nav) return;

    const onScroll = () => {
      if (window.scrollY > 40) {
        nav.classList.add("scrolled");
      } else {
        nav.classList.remove("scrolled");
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return null;
}
