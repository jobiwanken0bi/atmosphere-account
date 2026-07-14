function applyMediaFallback(image) {
  const fallback = image.dataset.fallbackSrc;
  if (!fallback || image.dataset.fallbackApplied === "true") return;
  image.dataset.fallbackApplied = "true";
  image.src = fallback;
}

for (const image of document.querySelectorAll("img[data-fallback-src]")) {
  image.addEventListener("error", () => applyMediaFallback(image), {
    once: true,
  });
  if (image.complete && image.naturalWidth === 0) applyMediaFallback(image);
}
