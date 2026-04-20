import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  APP_SUBCATEGORIES,
  CATEGORIES,
  type Category,
} from "../lib/lexicons.ts";
import { useT } from "../i18n/mod.ts";

interface ExistingProfile {
  name: string;
  description: string;
  category: string;
  subcategories: string[];
  website: string | null;
  supportUrl: string | null;
  bskyHandle: string | null;
  atmosphereHandle: string | null;
  tags: string[];
  avatar: { ref: string; mime: string } | null;
}

interface Props {
  did: string;
  handle: string;
  initial: ExistingProfile | null;
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

export default function CreateProfileForm({ did, handle, initial }: Props) {
  const t = useT();
  const tForm = t.forms.profile;

  const name = useSignal(initial?.name ?? "");
  const description = useSignal(initial?.description ?? "");
  const category = useSignal<string>(initial?.category ?? "app");
  const subcategories = useSignal<string[]>(initial?.subcategories ?? []);
  const website = useSignal(initial?.website ?? "");
  const supportUrl = useSignal(initial?.supportUrl ?? "");
  const bskyHandle = useSignal(initial?.bskyHandle ?? handle);
  const atmosphereHandle = useSignal(initial?.atmosphereHandle ?? handle);
  const tagsText = useSignal((initial?.tags ?? []).join(", "));
  const avatarKeep = useSignal<BlobRefShape | null>(null);
  const avatarPreview = useSignal<string | null>(
    initial?.avatar ? `/api/registry/avatar/${encodeURIComponent(did)}` : null,
  );
  const avatarFile = useSignal<File | null>(null);
  const avatarRemoved = useSignal(false);

  const submitting = useSignal(false);
  const deleting = useSignal(false);
  const message = useSignal<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  // Pull existing avatar BlobRef so we can echo it back unchanged.
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
    submitting.value = true;
    message.value = null;

    try {
      const tags = tagsText.value.split(",").map((s) => s.trim()).filter(
        Boolean,
      ).slice(0, 10);
      const payload: Record<string, unknown> = {
        name: name.value.trim(),
        description: description.value.trim(),
        category: category.value,
        subcategories: subcategories.value,
        website: website.value.trim() || undefined,
        supportUrl: supportUrl.value.trim() || undefined,
        bskyHandle: bskyHandle.value.trim() || undefined,
        atmosphereHandle: atmosphereHandle.value.trim() || undefined,
        tags,
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
      message.value = { kind: "ok", text: t.explore.manage.savedToast };
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
      message.value = { kind: "ok", text: t.explore.manage.deletedToast };
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
            <div class="profile-form-chips">
              {CATEGORIES.map((c: Category) => (
                <label
                  key={c}
                  class={`profile-form-chip ${
                    category.value === c ? "is-selected" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="category"
                    value={c}
                    checked={category.value === c}
                    onChange={() => category.value = c}
                  />
                  <span>{t.categories[c]}</span>
                </label>
              ))}
            </div>
            <p class="profile-form-hint">{tForm.categoryHint}</p>
          </fieldset>

          {category.value === "app" && (
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
            <span class="profile-form-label">{tForm.supportUrlLabel}</span>
            <input
              type="url"
              placeholder={tForm.supportUrlPlaceholder}
              value={supportUrl.value}
              onInput={(e) =>
                supportUrl.value = (e.currentTarget as HTMLInputElement).value}
              class="profile-form-input"
            />
          </label>

          <div class="profile-form-row-2">
            <label class="profile-form-field">
              <span class="profile-form-label">{tForm.bskyHandleLabel}</span>
              <input
                type="text"
                placeholder={tForm.bskyHandlePlaceholder}
                value={bskyHandle.value}
                onInput={(e) =>
                  bskyHandle.value =
                    (e.currentTarget as HTMLInputElement).value}
                class="profile-form-input"
              />
            </label>
            <label class="profile-form-field">
              <span class="profile-form-label">
                {tForm.atmosphereHandleLabel}
              </span>
              <input
                type="text"
                placeholder={tForm.atmosphereHandlePlaceholder}
                value={atmosphereHandle.value}
                onInput={(e) =>
                  atmosphereHandle.value =
                    (e.currentTarget as HTMLInputElement).value}
                class="profile-form-input"
              />
            </label>
          </div>

          <label class="profile-form-field">
            <span class="profile-form-label">{tForm.tagsLabel}</span>
            <input
              type="text"
              placeholder={tForm.tagsPlaceholder}
              value={tagsText.value}
              onInput={(e) =>
                tagsText.value = (e.currentTarget as HTMLInputElement).value}
              class="profile-form-input"
            />
            <p class="profile-form-hint">{tForm.tagsHint}</p>
          </label>
        </div>
      </div>

      <div class="profile-form-actions">
        <button
          type="submit"
          disabled={submitting.value}
          class="profile-form-button-primary"
        >
          {submitting.value
            ? t.explore.manage.savingButton
            : t.explore.manage.saveButton}
        </button>
        {initial && (
          <button
            type="button"
            disabled={deleting.value}
            onClick={onDelete}
            class="profile-form-button-danger"
          >
            {deleting.value
              ? t.explore.manage.deletingButton
              : t.explore.manage.deleteButton}
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
