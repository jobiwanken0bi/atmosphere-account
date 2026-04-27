const carouselSelector = "[data-screenshot-carousel]";
const directionSelector = "[data-screenshot-direction]";

function updateButtons(shell) {
  const track = shell.querySelector(".profile-screenshots-carousel");
  if (!track) return;

  const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth);
  const atStart = track.scrollLeft <= 1;
  const atEnd = track.scrollLeft >= maxScrollLeft - 1;

  for (const button of shell.querySelectorAll(directionSelector)) {
    const isPrevious = button.dataset.screenshotDirection === "-1";
    const disabled = maxScrollLeft <= 1 || (isPrevious ? atStart : atEnd);
    button.disabled = disabled;
    button.setAttribute("aria-disabled", disabled ? "true" : "false");
  }
}

function scrollCarousel(button) {
  const shell = button.closest(carouselSelector);
  const track = shell?.querySelector(".profile-screenshots-carousel");
  const firstCard = track?.querySelector(".profile-screenshot-card");
  if (!track || !firstCard) return;

  const direction = button.dataset.screenshotDirection === "-1" ? -1 : 1;
  const gap = Number.parseFloat(getComputedStyle(track).columnGap || "0") || 0;
  const cardStep = firstCard.getBoundingClientRect().width + gap;
  const step = Math.min(
    Math.max(cardStep, 220),
    Math.max(track.clientWidth * 0.85, 220),
  );

  track.scrollBy({
    left: direction * step,
    behavior: "smooth",
  });
  globalThis.setTimeout(() => updateButtons(shell), 350);
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const button = target.closest(directionSelector);
  if (!(button instanceof HTMLButtonElement)) return;

  event.preventDefault();
  event.stopPropagation();
  scrollCarousel(button);
});

for (const shell of document.querySelectorAll(carouselSelector)) {
  updateButtons(shell);
  const track = shell.querySelector(".profile-screenshots-carousel");
  track?.addEventListener("scroll", () => updateButtons(shell), {
    passive: true,
  });
}

globalThis.addEventListener("resize", () => {
  for (const shell of document.querySelectorAll(carouselSelector)) {
    updateButtons(shell);
  }
});
