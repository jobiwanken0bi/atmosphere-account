import { useSignal } from "@preact/signals";
import { useT } from "../i18n/mod.ts";
import { APP_SUBCATEGORIES, CATEGORIES } from "../lib/lexicons.ts";

/** The three read endpoints exposed in the playground. */
type EndpointKind = "profile" | "search" | "featured";

/** A built request: the URL to fetch + the params we used to build it
 *  (kept separately so the snippet generators don't have to re-parse). */
interface BuiltRequest {
  url: string;
  /** Just the path + query (e.g. `/api/registry/profile/alice.bsky.social`). */
  pathAndQuery: string;
}

/**
 * Interactive Profile API playground rendered inside the developer
 * resources page. Lets devs try each public read endpoint without
 * leaving the page, and copy the matching cURL / fetch snippet
 * straight into their own code.
 *
 * Intentionally dependency-free: no syntax highlighter, no tabs lib —
 * everything is a tiny amount of inline JSX so the island bundle stays
 * small (this is a reference page, not a hot path).
 */
export default function RegistryApiPlayground() {
  const t = useT();
  const tApi = t.developerResources.api;
  const tCat = t.categories;
  const tSub = t.subcategories;

  const kind = useSignal<EndpointKind>("profile");

  // Per-tab form state. Kept as separate signals so switching tabs
  // doesn't stomp the values you typed in the other tab.
  const profileId = useSignal<string>("");
  const searchQuery = useSignal<string>("");
  const searchCategory = useSignal<string>("");
  const searchSubcategory = useSignal<string>("");
  const searchPage = useSignal<string>("1");
  const searchPageSize = useSignal<string>("24");
  const featuredLimit = useSignal<string>("12");

  // Response state.
  const loading = useSignal<boolean>(false);
  const responseStatus = useSignal<number | null>(null);
  const responseBody = useSignal<string>("");
  const errorMessage = useSignal<string | null>(null);

  /** Build the request URL for whatever tab is currently active. */
  function buildRequest(): BuiltRequest | null {
    const origin = globalThis.location?.origin ?? "";
    if (kind.value === "profile") {
      const id = profileId.value.trim();
      if (!id) return null;
      const path = `/api/registry/profile/${encodeURIComponent(id)}`;
      return { url: `${origin}${path}`, pathAndQuery: path };
    }
    if (kind.value === "search") {
      const params = new URLSearchParams();
      const q = searchQuery.value.trim();
      if (q) params.set("q", q);
      if (searchCategory.value) params.set("category", searchCategory.value);
      const sub = searchSubcategory.value.trim();
      if (sub) params.set("subcategory", sub);
      const page = Number(searchPage.value) || 1;
      if (page !== 1) params.set("page", String(page));
      const pageSize = Number(searchPageSize.value) || 24;
      if (pageSize !== 24) params.set("pageSize", String(pageSize));
      const qs = params.toString();
      const path = `/api/registry/search${qs ? `?${qs}` : ""}`;
      return { url: `${origin}${path}`, pathAndQuery: path };
    }
    // featured
    const params = new URLSearchParams();
    const limit = Number(featuredLimit.value) || 12;
    if (limit !== 12) params.set("limit", String(limit));
    const qs = params.toString();
    const path = `/api/registry/featured${qs ? `?${qs}` : ""}`;
    return { url: `${origin}${path}`, pathAndQuery: path };
  }

  async function onFetch() {
    const built = buildRequest();
    if (!built) {
      errorMessage.value = tApi.errors.missingId;
      return;
    }
    loading.value = true;
    errorMessage.value = null;
    responseStatus.value = null;
    responseBody.value = "";
    try {
      const res = await fetch(built.url, {
        headers: { accept: "application/json" },
      });
      responseStatus.value = res.status;
      const text = await res.text();
      // Try to pretty-print JSON; fall back to raw text on parse error.
      try {
        responseBody.value = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        responseBody.value = text;
      }
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey.value = key;
      setTimeout(() => {
        if (copiedKey.value === key) copiedKey.value = null;
      }, 1500);
    } catch {
      // Best effort — older browsers / insecure contexts get nothing.
    }
  }
  const copiedKey = useSignal<string | null>(null);

  const built = buildRequest();
  const curlSnippet = built ? `curl -sSL '${built.url}'` : "";
  const fetchSnippet = built
    ? [
      `const res = await fetch('${built.url}', {`,
      `  headers: { accept: 'application/json' },`,
      `});`,
      `const data = await res.json();`,
    ].join("\n")
    : "";

  return (
    <div class="api-playground">
      <div class="api-playground-tabs" role="tablist">
        {(["profile", "search", "featured"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind.value === k}
            class={`api-playground-tab ${kind.value === k ? "is-active" : ""}`}
            onClick={() => (kind.value = k)}
          >
            {tApi.tabs[k]}
          </button>
        ))}
      </div>

      <div class="api-playground-form">
        {kind.value === "profile" && (
          <label class="api-playground-field">
            <span class="api-playground-label">{tApi.fields.profileId}</span>
            <input
              type="text"
              class="api-playground-input"
              placeholder={tApi.placeholders.profileId}
              value={profileId.value}
              onInput={(
                e,
              ) => (profileId.value =
                (e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onFetch();
                }
              }}
            />
          </label>
        )}

        {kind.value === "search" && (
          <div class="api-playground-grid">
            <label class="api-playground-field">
              <span class="api-playground-label">
                {tApi.fields.searchQuery}
              </span>
              <input
                type="text"
                class="api-playground-input"
                placeholder={tApi.placeholders.searchQuery}
                value={searchQuery.value}
                onInput={(
                  e,
                ) => (searchQuery.value =
                  (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label class="api-playground-field">
              <span class="api-playground-label">{tApi.fields.category}</span>
              <select
                class="api-playground-input"
                value={searchCategory.value}
                onChange={(
                  e,
                ) => (searchCategory.value =
                  (e.currentTarget as HTMLSelectElement).value)}
              >
                <option value="">{tApi.fields.anyCategory}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{tCat[c]}</option>
                ))}
              </select>
            </label>
            <label class="api-playground-field">
              <span class="api-playground-label">
                {tApi.fields.subcategory}
              </span>
              <select
                class="api-playground-input"
                value={searchSubcategory.value}
                onChange={(
                  e,
                ) => (searchSubcategory.value =
                  (e.currentTarget as HTMLSelectElement).value)}
              >
                <option value="">{tApi.fields.anySubcategory}</option>
                {APP_SUBCATEGORIES.map((s) => (
                  <option key={s} value={s}>{tSub[s]}</option>
                ))}
              </select>
            </label>
            <label class="api-playground-field">
              <span class="api-playground-label">{tApi.fields.page}</span>
              <input
                type="number"
                min={1}
                class="api-playground-input"
                value={searchPage.value}
                onInput={(
                  e,
                ) => (searchPage.value =
                  (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label class="api-playground-field">
              <span class="api-playground-label">{tApi.fields.pageSize}</span>
              <input
                type="number"
                min={1}
                max={48}
                class="api-playground-input"
                value={searchPageSize.value}
                onInput={(
                  e,
                ) => (searchPageSize.value =
                  (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
          </div>
        )}

        {kind.value === "featured" && (
          <label class="api-playground-field">
            <span class="api-playground-label">{tApi.fields.limit}</span>
            <input
              type="number"
              min={1}
              max={48}
              class="api-playground-input"
              value={featuredLimit.value}
              onInput={(
                e,
              ) => (featuredLimit.value =
                (e.currentTarget as HTMLInputElement).value)}
            />
          </label>
        )}

        <div class="api-playground-actions">
          <button
            type="button"
            class="api-playground-fetch"
            onClick={onFetch}
            disabled={loading.value || !built}
          >
            {loading.value ? tApi.fetching : tApi.fetch}
          </button>
          {built && (
            <code class="api-playground-url" title={built.pathAndQuery}>
              GET {built.pathAndQuery}
            </code>
          )}
        </div>
      </div>

      {(responseStatus.value !== null || errorMessage.value) && (
        <div class="api-playground-response">
          <div class="api-playground-response-header">
            <span class="api-playground-label">{tApi.response}</span>
            {responseStatus.value !== null && (
              <span
                class={`api-playground-status ${
                  responseStatus.value >= 200 && responseStatus.value < 300
                    ? "is-ok"
                    : "is-err"
                }`}
              >
                {responseStatus.value}
              </span>
            )}
          </div>
          {errorMessage.value && (
            <p class="api-playground-error">{errorMessage.value}</p>
          )}
          {responseBody.value && (
            <pre class="api-playground-pre"><code>{responseBody.value}</code></pre>
          )}
        </div>
      )}

      {built && (
        <div class="api-playground-snippets">
          <Snippet
            label="cURL"
            text={curlSnippet}
            copied={copiedKey.value === "curl"}
            onCopy={() => copy(curlSnippet, "curl")}
            copyLabel={tApi.copy}
            copiedLabel={tApi.copied}
          />
          <Snippet
            label="JavaScript"
            text={fetchSnippet}
            copied={copiedKey.value === "fetch"}
            onCopy={() => copy(fetchSnippet, "fetch")}
            copyLabel={tApi.copy}
            copiedLabel={tApi.copied}
          />
        </div>
      )}
    </div>
  );
}

interface SnippetProps {
  label: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
  copyLabel: string;
  copiedLabel: string;
}

function Snippet(
  { label, text, copied, onCopy, copyLabel, copiedLabel }: SnippetProps,
) {
  return (
    <div class="api-playground-snippet">
      <div class="api-playground-snippet-header">
        <span class="api-playground-label">{label}</span>
        <button
          type="button"
          class="api-playground-copy"
          onClick={onCopy}
          aria-live="polite"
        >
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre class="api-playground-pre"><code>{text}</code></pre>
    </div>
  );
}
