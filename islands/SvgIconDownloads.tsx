import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { useT } from "../i18n/mod.ts";

interface IconDownload {
  did: string;
  handle: string;
  name: string;
  iconUrl: string;
  downloadFilename: string;
  indexedAt: number;
}

export default function SvgIconDownloads() {
  const t = useT().developerResources.icons;
  const icons = useSignal<IconDownload[]>([]);
  const query = useSignal("");
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
  const filtered = needle
    ? icons.value.filter((icon) =>
      `${icon.name} ${icon.handle}`.toLowerCase().includes(needle)
    )
    : icons.value;

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
          {icons.value.length === 0 ? t.empty : t.noResults}
        </p>
      )}

      {filtered.length > 0 && (
        <div class="svg-download-grid">
          {filtered.map((icon) => (
            <article class="svg-download-card" key={icon.did}>
              <div class="svg-download-preview">
                <img
                  src={icon.iconUrl}
                  alt={t.iconAlt.replace("{name}", icon.name)}
                  loading="lazy"
                />
              </div>
              <div class="svg-download-details">
                <h3 class="svg-download-name">{icon.name}</h3>
                <p class="svg-download-handle">@{icon.handle}</p>
              </div>
              <a
                href={icon.iconUrl}
                download={icon.downloadFilename}
                class="badge-download-btn font-mono svg-download-button"
              >
                {t.downloadSvg}
              </a>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
