import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { useT } from "../i18n/mod.ts";

interface Props {
  /** Optional path to redirect to after successful login (defaults to /explore/manage) */
  returnTo?: string;
}

interface PreviewMatch {
  did: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
}

interface PreviewSuccess {
  found: true;
  matches: PreviewMatch[];
}

interface PreviewMiss {
  found: false;
  reason: "invalid_handle" | "not_found";
}

type PreviewResponse = PreviewSuccess | PreviewMiss;

export default function SignInForm({ returnTo: _returnTo }: Props) {
  const t = useT();
  const handle = useSignal("");
  const submitting = useSignal(false);
  const error = useSignal<string | null>(null);
  const matches = useSignal<PreviewMatch[]>([]);
  const previewLoading = useSignal(false);
  const missReason = useSignal<PreviewMiss["reason"] | null>(null);
  const showPreview = useSignal(false);

  const debounceRef = useRef<number | null>(null);
  const requestSeq = useRef(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocPointerDown(e: PointerEvent) {
      if (!wrapRef.current) return;
      const node = e.target;
      if (node instanceof Node && !wrapRef.current.contains(node)) {
        showPreview.value = false;
      }
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, []);

  function schedulePreview(value: string) {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const trimmed = value.trim().replace(/^@/, "").toLowerCase();
    if (!trimmed) {
      matches.value = [];
      missReason.value = null;
      previewLoading.value = false;
      showPreview.value = false;
      return;
    }
    matches.value = [];
    missReason.value = null;
    previewLoading.value = true;
    showPreview.value = true;
    const mySeq = ++requestSeq.current;
    debounceRef.current = setTimeout(() => {
      fetch(`/api/identity/preview?handle=${encodeURIComponent(trimmed)}`)
        .then((r) => r.json() as Promise<PreviewResponse>)
        .then((data) => {
          if (mySeq !== requestSeq.current) return;
          previewLoading.value = false;
          if (data.found) {
            matches.value = data.matches;
            missReason.value = null;
          } else {
            matches.value = [];
            missReason.value = data.reason;
          }
        })
        .catch(() => {
          if (mySeq !== requestSeq.current) return;
          previewLoading.value = false;
          matches.value = [];
          missReason.value = "not_found";
        });
    }, 150);
  }

  const onSubmit = (event: Event) => {
    event.preventDefault();
    if (!handle.value.trim()) return;
    submitting.value = true;
    error.value = null;
    const form = event.currentTarget as HTMLFormElement;
    form.submit();
  };

  const onSelectMatch = (m: PreviewMatch) => {
    handle.value = m.handle;
    showPreview.value = false;
  };

  return (
    <form
      method="POST"
      action="/oauth/login"
      onSubmit={onSubmit}
      class="signin-form"
    >
      <div class="signin-form-preview-wrap" ref={wrapRef}>
        <label class="signin-form-label" for="signin-handle">
          {t.explore.create.handlePlaceholder}
        </label>
        <div class="signin-form-row">
          <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
            <input
              id="signin-handle"
              name="handle"
              type="text"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellcheck={false}
              autoComplete="off"
              required
              placeholder={t.explore.create.handlePlaceholder}
              value={handle.value}
              onInput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                handle.value = v;
                schedulePreview(v);
              }}
              onFocus={() => {
                const v = handle.value;
                if (v.trim()) schedulePreview(v);
              }}
              class="signin-form-input"
              style={{ width: "100%" }}
              aria-autocomplete="list"
              aria-expanded={showPreview.value}
              aria-controls="signin-handle-preview"
            />
            {showPreview.value && (
              <div
                id="signin-handle-preview"
                class="signin-form-preview glass"
                role="listbox"
              >
                {previewLoading.value && (
                  <div class="signin-form-preview-status">
                    <span
                      class="signin-form-preview-spinner"
                      aria-hidden="true"
                    />
                    <span>{t.explore.create.previewLoading}</span>
                  </div>
                )}
                {!previewLoading.value && missReason.value !== null && (
                  <div class="signin-form-preview-status">
                    <span>{t.explore.create.previewNotFound}</span>
                  </div>
                )}
                {!previewLoading.value &&
                  missReason.value === null &&
                  matches.value.length > 0 && (
                  <div class="signin-form-preview-list">
                    {matches.value.map((m) => (
                      <button
                        key={m.did}
                        type="button"
                        class="signin-form-preview-row"
                        role="option"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          onSelectMatch(m);
                        }}
                      >
                        {m.avatarUrl
                          ? (
                            <img
                              class="signin-form-preview-avatar"
                              src={m.avatarUrl}
                              alt=""
                              loading="lazy"
                              decoding="async"
                            />
                          )
                          : (
                            <span
                              class="signin-form-preview-avatar"
                              aria-hidden="true"
                            />
                          )}
                        <span class="signin-form-preview-meta">
                          {m.displayName
                            ? (
                              <>
                                <span class="signin-form-preview-name">
                                  {m.displayName}
                                </span>
                                <span class="signin-form-preview-handle">
                                  @{m.handle}
                                </span>
                              </>
                            )
                            : (
                              <span class="signin-form-preview-name">
                                @{m.handle}
                              </span>
                            )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {!previewLoading.value &&
                  missReason.value === null &&
                  matches.value.length === 0 && (
                  <div class="signin-form-preview-status">
                    <span>{t.explore.create.previewNotFound}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            type="submit"
            class="signin-form-submit"
            disabled={submitting.value}
          >
            {submitting.value ? "…" : t.explore.create.signIn}
          </button>
        </div>
      </div>
      {error.value && <p class="signin-form-error">{error.value}</p>}
      <p class="signin-form-hint">{t.explore.create.whyHandle}</p>
    </form>
  );
}
