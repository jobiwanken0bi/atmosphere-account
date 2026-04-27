import { useSignal } from "@preact/signals";
import { useT } from "../i18n/mod.ts";
import type { ProfileUpdateRow } from "../lib/profile-updates.ts";

export type EditableProfileUpdate = Pick<
  ProfileUpdateRow,
  | "rkey"
  | "title"
  | "body"
  | "version"
  | "tangledCommitUrl"
  | "createdAt"
>;

interface Props {
  initialUpdates: EditableProfileUpdate[];
  disabled?: boolean;
}

function dateLabel(ms: number): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ms));
}

function updateFromResponse(update: unknown): EditableProfileUpdate | null {
  if (!update || typeof update !== "object") return null;
  const u = update as Record<string, unknown>;
  if (typeof u.rkey !== "string" || typeof u.title !== "string") return null;
  if (typeof u.body !== "string" || typeof u.createdAt !== "number") {
    return null;
  }
  return {
    rkey: u.rkey,
    title: u.title,
    body: u.body,
    version: typeof u.version === "string" ? u.version : null,
    tangledCommitUrl: typeof u.tangledCommitUrl === "string"
      ? u.tangledCommitUrl
      : null,
    createdAt: u.createdAt,
  };
}

export default function ProfileUpdateEditor(
  { initialUpdates, disabled = false }: Props,
) {
  const t = useT().forms.profile.profileUpdates;
  const updates = useSignal<EditableProfileUpdate[]>(initialUpdates);
  const editingRkey = useSignal<string | null>(null);
  const title = useSignal("");
  const version = useSignal("");
  const body = useSignal("");
  const tangledCommitUrl = useSignal("");
  const submitting = useSignal(false);
  const deletingRkey = useSignal<string | null>(null);
  const message = useSignal<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  const resetForm = () => {
    editingRkey.value = null;
    title.value = "";
    version.value = "";
    body.value = "";
    tangledCommitUrl.value = "";
  };

  const editUpdate = (update: EditableProfileUpdate) => {
    editingRkey.value = update.rkey;
    title.value = update.title;
    version.value = update.version ?? "";
    body.value = update.body;
    tangledCommitUrl.value = update.tangledCommitUrl ?? "";
    message.value = null;
  };

  const saveUpdate = async (event: Event) => {
    event.preventDefault();
    if (disabled || submitting.value) return;
    submitting.value = true;
    message.value = null;
    try {
      const res = await fetch("/api/registry/profile/updates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rkey: editingRkey.value ?? undefined,
          title: title.value,
          version: version.value,
          body: body.value,
          tangledCommitUrl: tangledCommitUrl.value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.error || t.saveError);
      }
      const update = updateFromResponse(data.update);
      if (update) {
        updates.value = [
          update,
          ...updates.value.filter((row) => row.rkey !== update.rkey),
        ].sort((a, b) => b.createdAt - a.createdAt);
      }
      resetForm();
      message.value = { kind: "ok", text: t.saved };
    } catch (err) {
      message.value = {
        kind: "error",
        text: err instanceof Error ? err.message : t.saveError,
      };
    } finally {
      submitting.value = false;
    }
  };

  const deleteUpdate = async (rkey: string) => {
    if (disabled || deletingRkey.value) return;
    if (!confirm(t.confirmDelete)) return;
    deletingRkey.value = rkey;
    message.value = null;
    try {
      const res = await fetch(
        `/api/registry/profile/updates?rkey=${encodeURIComponent(rkey)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || t.deleteError);
      updates.value = updates.value.filter((update) => update.rkey !== rkey);
      if (editingRkey.value === rkey) resetForm();
      message.value = { kind: "ok", text: t.deleted };
    } catch (err) {
      message.value = {
        kind: "error",
        text: err instanceof Error ? err.message : t.deleteError,
      };
    } finally {
      deletingRkey.value = null;
    }
  };

  return (
    <section class="profile-update-editor glass">
      <div class="profile-update-editor-header">
        <div>
          <p class="text-eyebrow">{t.eyebrow}</p>
          <h2>{t.title}</h2>
          <p>{t.body}</p>
        </div>
      </div>

      <form class="profile-update-form" onSubmit={saveUpdate}>
        <div class="profile-update-form-grid">
          <label class="profile-form-field">
            <span class="profile-form-label">{t.titleLabel}</span>
            <input
              type="text"
              required
              maxLength={80}
              value={title.value}
              placeholder={t.titlePlaceholder}
              onInput={(e) =>
                title.value = (e.currentTarget as HTMLInputElement).value}
              class="profile-form-input"
              disabled={disabled}
            />
          </label>
          <label class="profile-form-field">
            <span class="profile-form-label">{t.versionLabel}</span>
            <input
              type="text"
              maxLength={32}
              value={version.value}
              placeholder={t.versionPlaceholder}
              onInput={(e) =>
                version.value = (e.currentTarget as HTMLInputElement).value}
              class="profile-form-input"
              disabled={disabled}
            />
          </label>
        </div>
        <label class="profile-form-field">
          <span class="profile-form-label">{t.notesLabel}</span>
          <textarea
            required
            maxLength={1000}
            rows={5}
            value={body.value}
            placeholder={t.notesPlaceholder}
            onInput={(e) =>
              body.value = (e.currentTarget as HTMLTextAreaElement).value}
            class="profile-form-input"
            disabled={disabled}
          />
        </label>
        <label class="profile-form-field">
          <span class="profile-form-label">{t.commitLabel}</span>
          <input
            type="url"
            maxLength={512}
            value={tangledCommitUrl.value}
            placeholder={t.commitPlaceholder}
            onInput={(e) =>
              tangledCommitUrl.value =
                (e.currentTarget as HTMLInputElement).value}
            class="profile-form-input"
            disabled={disabled}
          />
        </label>
        <div class="profile-update-actions">
          <button
            type="submit"
            class="profile-form-button-primary"
            disabled={disabled || submitting.value}
          >
            {submitting.value
              ? t.saving
              : editingRkey.value
              ? t.updateButton
              : t.publishButton}
          </button>
          {editingRkey.value && (
            <button
              type="button"
              class="profile-form-button-secondary"
              onClick={resetForm}
              disabled={submitting.value}
            >
              {t.cancelEdit}
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

      {updates.value.length > 0 && (
        <div class="profile-update-list">
          {updates.value.map((update) => (
            <article class="profile-update-list-item" key={update.rkey}>
              <div>
                <div class="profile-update-list-meta">
                  {update.version && <span>{update.version}</span>}
                  <time dateTime={new Date(update.createdAt).toISOString()}>
                    {dateLabel(update.createdAt)}
                  </time>
                </div>
                <h3>{update.title}</h3>
                <p>{update.body}</p>
              </div>
              <div class="profile-update-list-actions">
                <button
                  type="button"
                  class="profile-form-button-secondary"
                  onClick={() =>
                    editUpdate(update)}
                >
                  {t.edit}
                </button>
                <button
                  type="button"
                  class="profile-form-button-link"
                  onClick={() =>
                    deleteUpdate(update.rkey)}
                  disabled={deletingRkey.value === update.rkey}
                >
                  {deletingRkey.value === update.rkey ? t.deleting : t.delete}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
