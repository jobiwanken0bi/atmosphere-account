import { useEffect, useRef } from "preact/hooks";

export default function LottieHero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    const script = document.createElement("script");
    script.src =
      "https://unpkg.com/@lottiefiles/lottie-player@2.0.8/dist/lottie-player.js";
    script.onload = () => {
      if (!containerRef.current) return;

      const player = document.createElement("lottie-player") as any;
      player.setAttribute("src", "/atmosphere.json");
      player.setAttribute("background", "transparent");
      player.setAttribute("loop", "");
      player.setAttribute("autoplay", "");
      player.style.width = "100%";
      player.style.height = "100%";
      containerRef.current.prepend(player);

      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            try {
              if (e.isIntersecting) {
                player.play?.();
              } else {
                player.pause?.();
              }
            } catch (_) {
              // player not ready yet
            }
          });
        },
        { threshold: 0.15 },
      );
      io.observe(containerRef.current);
    };
    document.head.appendChild(script);
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
  );
}
