import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  APP_SUBCATEGORIES,
  CATEGORIES,
  type Category,
  LICENSE_TYPES,
  type LinkEntry,
} from "../lib/lexicons.ts";
import { LINK_KIND_ORDER } from "../lib/link-kinds.ts";
import { BSKY_CLIENTS, DEFAULT_BSKY_CLIENT_ID } from "../lib/bsky-clients.ts";
import { useT } from "../i18n/mod.ts";

interface ExistingLicense {
  type: string;
  spdxId: string | null;
  licenseUrl: string | null;
  notes: string | null;
}

interface ExistingProfile {
  name: string;
  description: string;
  /** All categories that apply to the project (always non-empty). The
   *  first item is the primary, used for sort/grouping in lists. */
  categories: string[];
  subcategories: string[];
  links: LinkEntry[];
  bskyClient: string | null;
  avatar: { ref: string; mime: string } | null;
  /** Joined license record, if the user has published one. */
  license: ExistingLicense | null;
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
  const tLink = t.linkKinds;
  const tLicense = t.licenseTypes as Record<string, string>;
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
  /** Local-only signal: signals don't deep-track array element mutations,
   *  so each edit replaces the entire array. */
  const links = useSignal<LinkEntry[]>(initial?.links ?? []);
  const bskyClient = useSignal<string>(
    initial?.bskyClient ?? DEFAULT_BSKY_CLIENT_ID,
  );
  /**
   * License state. `licenseType === ""` means "don't publish a license
   * record" — the form sends `license: null` in that case so the API
   * deletes any existing record.
   */
  const licenseType = useSignal<string>(initial?.license?.type ?? "");
  const licenseSpdx = useSignal<string>(initial?.license?.spdxId ?? "");
  const licenseUrl = useSignal<string>(initial?.license?.licenseUrl ?? "");
  const licenseNotes = useSignal<string>(initial?.license?.notes ?? "");

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

  /* ---------- Links editor helpers --------------------------------------- */
  const addLink = (kind: string = "website") => {
    if (links.value.length >= 12) return;
    links.value = [...links.value, { kind, url: "", label: "" }];
  };
  const removeLink = (index: number) => {
    links.value = links.value.filter((_, i) => i !== index);
  };
  const updateLink = (index: number, patch: Partial<LinkEntry>) => {
    links.value = links.value.map((entry, i) =>
      i === index ? { ...entry, ...patch } : entry
    );
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
    if (categories.value.length === 0) {
      message.value = { kind: "error", text: tForm.categoryRequired };
      return;
    }
    submitting.value = true;
    message.value = null;

    try {
      // Sanitise links: drop empty rows; require URL on every kept row;
      // for kind="other", require a label. Mirroring the validator means
      // the user gets fast client-side feedback.
      const cleanedLinks: LinkEntry[] = [];
      for (const l of links.value) {
        const url = (l.url ?? "").trim();
        if (!url) continue;
        const kind = (l.kind ?? "").trim() || "other";
        const label = (l.label ?? "").trim();
        if (kind === "other" && !label) {
          throw new Error(`Add a label for the "${tLink.other}" link or remove it.`);
        }
        const entry: LinkEntry = { kind, url };
        if (label) entry.label = label;
        cleanedLinks.push(entry);
      }

      const payload: Record<string, unknown> = {
        name: name.value.trim(),
        description: description.value.trim(),
        categories: categories.value,
        subcategories: showSubcategories ? subcategories.value : [],
        links: cleanedLinks,
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

      // License sub-record. Empty type = "don't publish" → null tells the
      // API to delete any existing license record so the badge goes away.
      if (licenseType.value) {
        payload.license = {
          type: licenseType.value,
          spdxId: licenseSpdx.value.trim() || undefined,
          licenseUrl: licenseUrl.value.trim() || undefined,
          notes: licenseNotes.value.trim() || undefined,
        };
      } else {
        payload.license = null;
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
      const json = await res.json().catch(() => ({})) as {
        licenseWarning?: string | null;
      };
      published.value = true;
      message.value = json.licenseWarning
        ? { kind: "error", text: json.licenseWarning }
        : { kind: "ok", text: tManage.savedToast };
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

          {/* ---------------- Links editor ----------------------------- */}
          <fieldset class="profile-form-field">
            <legend class="profile-form-label">{tForm.links.sectionLabel}</legend>
            <p class="profile-form-hint">{tForm.links.sectionHint}</p>
            {links.value.length === 0 && (
              <p class="profile-form-empty">{tForm.links.emptyHint}</p>
            )}
            <div class="link-editor-list">
              {links.value.map((entry, i) => (
                <div class="link-editor-row" key={i}>
                  <select
                    class="profile-form-input link-editor-kind"
                    value={entry.kind}
                    onChange={(e) =>
                      updateLink(i, {
                        kind: (e.currentTarget as HTMLSelectElement).value,
                      })}
                    aria-label={tForm.links.kindLabel}
                  >
                    {LINK_KIND_ORDER.map((k) => (
                      <option value={k} key={k}>
                        {tLink[k] ?? k}
                      </option>
                    ))}
                  </select>
                  <input
                    type="url"
                    class="profile-form-input link-editor-url"
                    placeholder={tForm.links.urlPlaceholder}
                    value={entry.url}
                    onInput={(e) =>
                      updateLink(i, {
                        url: (e.currentTarget as HTMLInputElement).value,
                      })}
                    aria-label={tForm.links.urlLabel}
                  />
                  <input
                    type="text"
                    class="profile-form-input link-editor-label"
                    placeholder={entry.kind === "other"
                      ? tForm.links.labelPlaceholderOther
                      : tForm.links.labelLabel}
                    value={entry.label ?? ""}
                    maxLength={64}
                    onInput={(e) =>
                      updateLink(i, {
                        label: (e.currentTarget as HTMLInputElement).value,
                      })}
                    aria-label={tForm.links.labelLabel}
                  />
                  <button
                    type="button"
                    class="profile-form-button-link link-editor-remove"
                    onClick={() => removeLink(i)}
                  >
                    {tForm.links.removeButton}
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              class="profile-form-button-secondary link-editor-add"
              onClick={() => addLink("website")}
              disabled={links.value.length >= 12}
            >
              + {tForm.links.addButton}
            </button>
          </fieldset>

          {/* ---------------- License section ------------------------- */}
          <fieldset class="profile-form-field profile-form-license">
            <legend class="profile-form-label">{tForm.license.sectionLabel}</legend>
            <p class="profile-form-hint">{tForm.license.sectionHint}</p>
            <label class="profile-form-field">
              <span class="profile-form-label profile-form-label--small">
                {tForm.license.typeLabel}
              </span>
              <select
                class="profile-form-input"
                value={licenseType.value}
                onChange={(e) =>
                  licenseType.value =
                    (e.currentTarget as HTMLSelectElement).value}
              >
                <option value="">{tForm.license.typeNone}</option>
                {LICENSE_TYPES.map((lt) => (
                  <option value={lt} key={lt}>{tLicense[lt] ?? lt}</option>
                ))}
              </select>
            </label>

            {licenseType.value && (
              <>
                <label class="profile-form-field">
                  <span class="profile-form-label profile-form-label--small">
                    {tForm.license.spdxLabel}
                  </span>
                  <input
                    type="text"
                    class="profile-form-input"
                    placeholder={tForm.license.spdxPlaceholder}
                    maxLength={64}
                    value={licenseSpdx.value}
                    onInput={(e) =>
                      licenseSpdx.value =
                        (e.currentTarget as HTMLInputElement).value}
                  />
                  <p class="profile-form-hint">{tForm.license.spdxHint}</p>
                </label>
                <label class="profile-form-field">
                  <span class="profile-form-label profile-form-label--small">
                    {tForm.license.urlLabel}
                  </span>
                  <input
                    type="url"
                    class="profile-form-input"
                    placeholder={tForm.license.urlPlaceholder}
                    value={licenseUrl.value}
                    onInput={(e) =>
                      licenseUrl.value =
                        (e.currentTarget as HTMLInputElement).value}
                  />
                </label>
                <label class="profile-form-field">
                  <span class="profile-form-label profile-form-label--small">
                    {tForm.license.notesLabel}
                  </span>
                  <input
                    type="text"
                    class="profile-form-input"
                    placeholder={tForm.license.notesPlaceholder}
                    maxLength={280}
                    value={licenseNotes.value}
                    onInput={(e) =>
                      licenseNotes.value =
                        (e.currentTarget as HTMLInputElement).value}
                  />
                </label>
              </>
            )}
          </fieldset>

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
