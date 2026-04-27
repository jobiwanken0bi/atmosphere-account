import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { useT } from "../i18n/mod.ts";

interface IconVariant {
  iconUrl: string;
  downloadFilename: string;
}

interface IconDownload {
  did: string;
  handle: string;
  name: string;
  color: IconVariant | null;
  bw: IconVariant | null;
  indexedAt: number;
}

type Tab = "color" | "bw";

export default function SvgIconDownloads() {
  const t = useT().developerResources.icons;
  const icons = useSignal<IconDownload[]>([]);
  const query = useSignal("");
  const tab = useSignal<Tab>("color");
  const loading = useSignal(true);
  const error = useSignal<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadIcons() {
      loading.value = true;
      error.value = null;
      try {
        const res = await fetch("/api/registry/icons", {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as { icons?: IconDownload[] };
        if (!cancelled) {
          icons.value = Array.isArray(json.icons) ? json.icons : [];
        }
      } catch (err) {
        if (!cancelled) {
          error.value = err instanceof Error ? err.message : String(err);
        }
      } finally {
        if (!cancelled) loading.value = false;
      }
    }
    loadIcons();
    return () => {
      cancelled = true;
    };
  }, []);

  const needle = query.value.trim().toLowerCase();
  const matchesQuery = (icon: IconDownload) =>
    needle
      ? `${icon.name} ${icon.handle}`.toLowerCase().includes(needle)
      : true;

  const activeVariant = (icon: IconDownload): IconVariant | null =>
    tab.value === "bw" ? icon.bw : icon.color;

  // Only show projects that have published the currently-selected
  // variant. Switching tabs swaps the grid; the totals reflect the
  // chosen variant so the count never lies.
  const filtered = icons.value
    .filter(matchesQuery)
    .filter((icon) => activeVariant(icon) !== null);

  return (
    <div class="svg-download-tool">
      <div class="svg-download-toolbar">
        <label class="api-playground-field svg-download-search">
          <span class="api-playground-label">{t.searchLabel}</span>
          <input
            type="search"
            class="api-playground-input"
            placeholder={t.searchPlaceholder}
            value={query.value}
            onInput={(
              e,
            ) => (query.value = (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <div
          class="svg-download-tabs"
          role="tablist"
          aria-label={t.variantToggleLabel}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab.value === "color"}
            class={`svg-download-tab ${
              tab.value === "color" ? "is-active" : ""
            }`}
            onClick={() => (tab.value = "color")}
          >
            {t.variantColor}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab.value === "bw"}
            class={`svg-download-tab ${tab.value === "bw" ? "is-active" : ""}`}
            onClick={() => (tab.value = "bw")}
          >
            {t.variantBw}
          </button>
        </div>
        <a
          href="/api/registry/icons.zip"
          download="atmosphere-project-icons.zip"
          class="badge-download-btn font-mono svg-download-zip"
        >
          {t.downloadZip}
        </a>
      </div>

      <div class="svg-download-meta">
        {loading.value
          ? t.loading
          : t.count.replace("{count}", String(filtered.length))}
      </div>

      {error.value && (
        <p class="api-playground-error">
          {t.error.replace("{error}", error.value)}
        </p>
      )}

      {!loading.value && !error.value && filtered.length === 0 && (
        <p class="text-body-sm svg-download-empty">
          {icons.value.length === 0
            ? t.empty
            : tab.value === "bw"
            ? t.emptyBw
            : t.noResults}
        </p>
      )}

      {filtered.length > 0 && (
        <div class="svg-download-grid">
          {filtered.map((icon) => {
            const variant = activeVariant(icon)!;
            return (
              <article
                class="svg-download-card"
                key={`${icon.did}-${tab.value}`}
              >
                <div
                  class={`svg-download-preview ${
                    tab.value === "bw" ? "svg-download-preview--bw" : ""
                  }`}
                >
                  <img
                    src={variant.iconUrl}
                    alt={t.iconAlt.replace("{name}", icon.name)}
                    loading="lazy"
                  />
                </div>
                <div class="svg-download-details">
                  <h3 class="svg-download-name">{icon.name}</h3>
                  <p class="svg-download-handle">@{icon.handle}</p>
                </div>
                <a
                  href={variant.iconUrl}
                  download={variant.downloadFilename}
                  class="badge-download-btn font-mono svg-download-button"
                >
                  {tab.value === "bw" ? t.downloadSvgBw : t.downloadSvg}
                </a>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
