import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  APP_SUBCATEGORIES,
  CATEGORIES,
  type Category,
} from "../lib/lexicons.ts";
import { BSKY_CLIENTS, DEFAULT_BSKY_CLIENT_ID } from "../lib/bsky-clients.ts";
import { useT } from "../i18n/mod.ts";

interface ExistingProfile {
  name: string;
  description: string;
  /** All categories that apply to the project (always non-empty). The
   *  first item is the primary, used for sort/grouping in lists. */
  categories: string[];
  subcategories: string[];
  website: string | null;
  repoUrl: string | null;
  openSource: boolean;
  bskyClient: string | null;
  avatar: { ref: string; mime: string } | null;
}

interface Props {
  did: string;
  handle: string;
  initial: ExistingProfile | null;
  /** Direct image URL to show in the avatar slot before any registry record
   *  exists (e.g. the user's PDS-hosted Bluesky avatar). */
  initialAvatarUrl?: string | null;
  /** Whether the registry currently has a published record for this user.
   *  Drives the live/inactive status pill at the top of the form. */
  initialPublished: boolean;
}

interface BlobRefShape {
  $type: "blob";
  ref: { $link: string };
  mimeType: string;
  size: number;
}

async function readFileAsBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

export default function CreateProfileForm(
  { did, handle, initial, initialAvatarUrl, initialPublished }: Props,
) {
  const t = useT();
  const tForm = t.forms.profile;
  const tManage = t.explore.manage;
  /** Live registry status. Flips on save (-> true) and delete (-> false).
   *  Drives the colored pill that tells the user whether their entry is
   *  visible in /explore right now. */
  const published = useSignal<boolean>(initialPublished);

  const name = useSignal(initial?.name ?? "");
  const description = useSignal(initial?.description ?? "");
  // categories is the source of truth — the lexicon requires it to be a
  // non-empty array. The first item is treated as the primary category.
  const categories = useSignal<string[]>(
    initial?.categories?.length ? initial.categories : ["app"],
  );
  const subcategories = useSignal<string[]>(initial?.subcategories ?? []);
  const website = useSignal(initial?.website ?? "");
  const repoUrl = useSignal(initial?.repoUrl ?? "");
  const openSource = useSignal<boolean>(initial?.openSource ?? false);
  const bskyClient = useSignal<string>(
    initial?.bskyClient ?? DEFAULT_BSKY_CLIENT_ID,
  );
  const avatarKeep = useSignal<BlobRefShape | null>(null);
  /** Preview URL precedence: locally-picked file blob > existing registry
   *  record (cached proxy) > prefill source (Bluesky PDS getBlob) > none. */
  const avatarPreview = useSignal<string | null>(
    initial?.avatar
      ? `/api/registry/avatar/${encodeURIComponent(did)}`
      : (initialAvatarUrl ?? null),
  );
  const avatarFile = useSignal<File | null>(null);
  const avatarRemoved = useSignal(false);

  const submitting = useSignal(false);
  const deleting = useSignal(false);
  const message = useSignal<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  useEffect(() => {
    if (!initial?.avatar) return;
    avatarKeep.value = {
      $type: "blob",
      ref: { $link: initial.avatar.ref },
      mimeType: initial.avatar.mime,
      size: 0,
    };
  }, []);

  const toggleSub = (key: string) => {
    const current = subcategories.value;
    if (current.includes(key)) {
      subcategories.value = current.filter((k) => k !== key);
    } else {
      if (current.length >= 5) return;
      subcategories.value = [...current, key];
    }
  };

  const toggleCategory = (key: string) => {
    const current = categories.value;
    if (current.includes(key)) {
      // Don't let the user unselect their last remaining category — at
      // least one is required by the lexicon.
      if (current.length <= 1) return;
      categories.value = current.filter((k) => k !== key);
    } else {
      if (current.length >= 4) return;
      categories.value = [...current, key];
    }
  };

  /**
   * `app` is the only category with subcategories defined right now. If
   * the user deselects `app`, hide the subcategory chips by clearing the
   * underlying selection (kept as an effect-like helper so the form's
   * payload doesn't carry stale subcategories on submit).
   */
  const showSubcategories = categories.value.includes("app");

  const onAvatarChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      message.value = { kind: "error", text: tForm.avatarTooLarge };
      input.value = "";
      return;
    }
    avatarFile.value = file;
    avatarRemoved.value = false;
    avatarPreview.value = URL.createObjectURL(file);
  };

  const removeAvatar = () => {
    avatarFile.value = null;
    avatarKeep.value = null;
    avatarRemoved.value = true;
    avatarPreview.value = null;
  };

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    if (submitting.value) return;
    if (categories.value.length === 0) {
      message.value = { kind: "error", text: tForm.categoryRequired };
      return;
    }
    submitting.value = true;
    message.value = null;

    try {
      const payload: Record<string, unknown> = {
        name: name.value.trim(),
        description: description.value.trim(),
        categories: categories.value,
        subcategories: showSubcategories ? subcategories.value : [],
        website: website.value.trim() || undefined,
        repoUrl: repoUrl.value.trim() || undefined,
        openSource: openSource.value,
        bskyClient: bskyClient.value || undefined,
      };
      if (avatarFile.value) {
        payload.avatarUpload = {
          dataBase64: await readFileAsBase64(avatarFile.value),
          mimeType: avatarFile.value.type,
        };
      } else if (!avatarRemoved.value && avatarKeep.value) {
        payload.avatar = avatarKeep.value;
      } else {
        payload.avatar = null;
      }

      const res = await fetch("/api/registry/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      published.value = true;
      message.value = { kind: "ok", text: tManage.savedToast };
    } catch (err) {
      message.value = {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      };
    } finally {
      submitting.value = false;
    }
  };

  const onDelete = async () => {
    if (!confirm(tForm.confirmDelete)) return;
    deleting.value = true;
    message.value = null;
    try {
      const res = await fetch("/api/registry/profile", { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      published.value = false;
      message.value = { kind: "ok", text: tManage.deletedToast };
    } catch (err) {
      message.value = {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      };
    } finally {
      deleting.value = false;
    }
  };

  return (
    <form class="profile-form glass" onSubmit={onSubmit}>
      <div
        class={`profile-status profile-status--${
          published.value ? "live" : "inactive"
        }`}
        role="status"
        aria-live="polite"
      >
        <span class="profile-status-dot" aria-hidden="true" />
        <span class="profile-status-text">
          <span class="profile-status-title">
            {published.value
              ? tManage.statusLiveTitle
              : tManage.statusInactiveTitle}
          </span>
          <span class="profile-status-sub">
            {published.value
              ? tManage.statusLiveSub
              : tManage.statusInactiveSub}
          </span>
        </span>
      </div>
      <div class="profile-form-row">
        <div class="profile-form-avatar">
          {avatarPreview.value
            ? (
              <img
                src={avatarPreview.value}
                alt=""
                class="profile-form-avatar-img"
              />
            )
            : (
              <div class="profile-form-avatar-placeholder" aria-hidden="true">
                +
              </div>
            )}
          <label class="profile-form-button-secondary">
            {avatarPreview.value ? tForm.avatarReplace : tForm.avatarLabel}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={onAvatarChange}
            />
          </label>
          {avatarPreview.value && (
            <button
              type="button"
              class="profile-form-button-link"
              onClick={removeAvatar}
            >
              {tForm.avatarRemove}
            </button>
          )}
          <p class="profile-form-hint">{tForm.avatarHint}</p>
        </div>

        <div class="profile-form-fields">
          <div class="profile-form-handle-row">
            <span class="profile-form-label">{tForm.handleLabel}</span>
            <span class="profile-form-handle-value">@{handle}</span>
          </div>

          <label class="profile-form-field">
            <span class="profile-form-label">
              {tForm.nameLabel} <em class="profile-form-required">*</em>
            </span>
            <input
              type="text"
              required
              maxLength={60}
              placeholder={tForm.namePlaceholder}
              value={name.value}
              onInput={(e) =>
                name.value = (e.currentTarget as HTMLInputElement).value}
              class="profile-form-input"
            />
          </label>

          <label class="profile-form-field">
            <span class="profile-form-label">
              {tForm.descriptionLabel} <em class="profile-form-required">*</em>
            </span>
            <textarea
              required
              maxLength={500}
              rows={3}
              placeholder={tForm.descriptionPlaceholder}
              value={description.value}
              onInput={(e) =>
                description.value =
                  (e.currentTarget as HTMLTextAreaElement).value}
              class="profile-form-input"
            />
          </label>

          <fieldset class="profile-form-field">
            <legend class="profile-form-label">{tForm.categoryLabel}</legend>
            <div class="profile-form-chips" role="group">
              {CATEGORIES.map((c: Category) => {
                const selected = categories.value.includes(c);
                return (
                  <label
                    key={c}
                    class={`profile-form-chip ${
                      selected ? "is-selected" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="categories"
                      value={c}
                      checked={selected}
                      onChange={() => toggleCategory(c)}
                    />
                    <span>{t.categories[c]}</span>
                  </label>
                );
              })}
            </div>
            <p class="profile-form-hint">{tForm.categoryHint}</p>
          </fieldset>

          {showSubcategories && (
            <fieldset class="profile-form-field">
              <legend class="profile-form-label">
                {tForm.subcategoriesLabel}
              </legend>
              <div class="profile-form-chips">
                {APP_SUBCATEGORIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    class={`profile-form-chip ${
                      subcategories.value.includes(s) ? "is-selected" : ""
                    }`}
                    onClick={() => toggleSub(s)}
                  >
                    {t.subcategories[s]}
                  </button>
                ))}
              </div>
              <p class="profile-form-hint">{tForm.subcategoriesHint}</p>
            </fieldset>
          )}

          <label class="profile-form-field">
            <span class="profile-form-label">{tForm.websiteLabel}</span>
            <input
              type="url"
              placeholder={tForm.websitePlaceholder}
              value={website.value}
              onInput={(e) =>
                website.value = (e.currentTarget as HTMLInputElement).value}
              class="profile-form-input"
            />
          </label>

          <label class="profile-form-field">
            <span class="profile-form-label">{tForm.repoUrlLabel}</span>
            <input
              type="url"
              placeholder={tForm.repoUrlPlaceholder}
              value={repoUrl.value}
              onInput={(e) =>
                repoUrl.value = (e.currentTarget as HTMLInputElement).value}
              class="profile-form-input"
            />
            <p class="profile-form-hint">{tForm.repoUrlHint}</p>
          </label>

          <label class="profile-form-toggle">
            <input
              type="checkbox"
              checked={openSource.value}
              onChange={(e) =>
                openSource.value = (e.currentTarget as HTMLInputElement).checked}
            />
            <span class="profile-form-toggle-body">
              <span class="profile-form-toggle-label">
                {tForm.openSourceLabel}
              </span>
              <span class="profile-form-toggle-hint">
                {tForm.openSourceHint}
              </span>
            </span>
          </label>

          <fieldset class="profile-form-field">
            <legend class="profile-form-label">{tForm.bskyClientLabel}</legend>
            <p class="profile-form-hint">{tForm.bskyClientHint}</p>
            <div class="bsky-client-list">
              {BSKY_CLIENTS.map((c) => {
                const selected = bskyClient.value === c.id;
                return (
                  <label
                    key={c.id}
                    class={`bsky-client-row ${selected ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="bskyClient"
                      value={c.id}
                      checked={selected}
                      onChange={() => bskyClient.value = c.id}
                    />
                    <img
                      src={c.iconUrl}
                      alt=""
                      class="bsky-client-icon"
                      loading="lazy"
                      decoding="async"
                    />
                    <span class="bsky-client-meta">
                      <span class="bsky-client-name">{c.name}</span>
                      <span class="bsky-client-domain">{c.domain}</span>
                    </span>
                    <span class="bsky-client-radio" aria-hidden="true" />
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      </div>

      <div class="profile-form-actions">
        <button
          type="submit"
          disabled={submitting.value}
          class="profile-form-button-primary"
        >
          {submitting.value
            ? tManage.savingButton
            : published.value
            ? tManage.updateButton
            : tManage.publishButton}
        </button>
        {published.value && (
          <button
            type="button"
            disabled={deleting.value}
            onClick={onDelete}
            class="profile-form-button-danger"
          >
            {deleting.value ? tManage.deletingButton : tManage.deleteButton}
          </button>
        )}
        {message.value && (
          <span
            class={`profile-form-status profile-form-status--${message.value.kind}`}
            role="status"
          >
            {message.value.text}
          </span>
        )}
      </div>
    </form>
  );
}
