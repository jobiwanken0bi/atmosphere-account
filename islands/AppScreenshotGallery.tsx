import { useSignal } from "@preact/signals";
import { createPortal } from "preact/compat";
import { useEffect } from "preact/hooks";
import { useDialog } from "../lib/use-dialog.ts";

export interface AppScreenshot {
  src: string;
  alt: string;
  fullSrc?: string;
  fallbackSrc?: string;
}

interface Props {
  screenshots: AppScreenshot[];
  appName: string;
  glass?: boolean;
}

interface ViewerProps {
  screenshots: AppScreenshot[];
  appName: string;
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

function ScreenshotViewer(
  { screenshots, appName, index, onIndexChange, onClose }: ViewerProps,
) {
  const dialogRef = useDialog<HTMLDivElement>(true, onClose);
  const hasPrevious = index > 0;
  const hasNext = index < screenshots.length - 1;
  const screenshot = screenshots[index];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && hasPrevious) {
        event.preventDefault();
        onIndexChange(index - 1);
      } else if (event.key === "ArrowRight" && hasNext) {
        event.preventDefault();
        onIndexChange(index + 1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [index, hasPrevious, hasNext]);

  return createPortal(
    <div
      class="modal-backdrop screenshot-viewer-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        class="screenshot-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`${appName} screenshot viewer`}
        tabIndex={-1}
      >
        <button
          type="button"
          class="auth-dialog-close screenshot-viewer-close"
          aria-label="Close screenshot viewer"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
        {screenshots.length > 1 && (
          <button
            type="button"
            class="screenshot-viewer-arrow screenshot-viewer-arrow--previous"
            aria-label="Previous screenshot"
            disabled={!hasPrevious}
            onClick={() => onIndexChange(index - 1)}
          >
            <span aria-hidden="true">←</span>
          </button>
        )}
        <figure class="screenshot-viewer-figure">
          <img
            src={screenshot.fullSrc ?? screenshot.src}
            data-fallback-src={screenshot.src}
            alt={screenshot.alt}
            onError={(event) => {
              const image = event.currentTarget;
              if (image.dataset.fallbackApplied === "true") return;
              image.dataset.fallbackApplied = "true";
              image.src = screenshot.src;
            }}
          />
          <figcaption>
            Screenshot {index + 1} of {screenshots.length}
          </figcaption>
        </figure>
        {screenshots.length > 1 && (
          <button
            type="button"
            class="screenshot-viewer-arrow screenshot-viewer-arrow--next"
            aria-label="Next screenshot"
            disabled={!hasNext}
            onClick={() => onIndexChange(index + 1)}
          >
            <span aria-hidden="true">→</span>
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default function AppScreenshotGallery(
  { screenshots: allScreenshots, appName, glass = true }: Props,
) {
  const screenshots = allScreenshots.slice(0, 4);
  const activeIndex = useSignal(0);
  const viewerOpen = useSignal(false);
  if (screenshots.length === 0) return null;

  const hasPrevious = activeIndex.value > 0;
  const hasNext = activeIndex.value < screenshots.length - 1;

  return (
    <section
      class={`profile-screenshots app-detail-screenshots${
        glass ? " glass" : ""
      }`}
      aria-labelledby="app-screenshots-heading"
    >
      <h2 id="app-screenshots-heading" class="profile-card-section-title">
        Screenshots
      </h2>
      <div class="profile-screenshots-shell">
        {screenshots.length > 1 && (
          <button
            type="button"
            class="profile-screenshots-arrow profile-screenshots-arrow--prev"
            aria-label="Previous screenshot"
            disabled={!hasPrevious}
            onClick={() => activeIndex.value -= 1}
          >
            <span aria-hidden="true">←</span>
          </button>
        )}
        <div
          class={`profile-screenshot-grid profile-screenshot-grid--${screenshots.length}`}
        >
          {screenshots.map((screenshot, index) => (
            <button
              type="button"
              class={`profile-screenshot-card${
                index === activeIndex.value ? " is-active" : ""
              }`}
              aria-label={`Open ${appName} screenshot ${
                index + 1
              } of ${screenshots.length}`}
              aria-haspopup="dialog"
              onClick={() => {
                activeIndex.value = index;
                viewerOpen.value = true;
              }}
              key={screenshot.src}
            >
              <img
                src={screenshot.src}
                data-fallback-src={screenshot.fallbackSrc}
                alt={screenshot.alt}
                loading="lazy"
                decoding="async"
                class="profile-screenshot-img"
              />
            </button>
          ))}
        </div>
        {screenshots.length > 1 && (
          <button
            type="button"
            class="profile-screenshots-arrow profile-screenshots-arrow--next"
            aria-label="Next screenshot"
            disabled={!hasNext}
            onClick={() => activeIndex.value += 1}
          >
            <span aria-hidden="true">→</span>
          </button>
        )}
        {screenshots.length > 1 && (
          <p class="profile-screenshot-position" aria-live="polite">
            {activeIndex.value + 1} / {screenshots.length}
          </p>
        )}
      </div>
      {viewerOpen.value && (
        <ScreenshotViewer
          screenshots={screenshots}
          appName={appName}
          index={activeIndex.value}
          onIndexChange={(index) => activeIndex.value = index}
          onClose={() => viewerOpen.value = false}
        />
      )}
    </section>
  );
}
