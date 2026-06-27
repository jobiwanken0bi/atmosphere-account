import { useSignal } from "@preact/signals";

interface Props {
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  microblogVisible: boolean;
  websiteUrl: string | null;
  websiteVisible: boolean;
  nameLabel: string;
  namePlaceholder: string;
  bioLabel: string;
  bioPlaceholder: string;
  saveLabel: string;
  savingLabel: string;
  savedLabel: string;
  errorLabel: string;
  onSaved?: () => void;
}

export default function UserProfileEditForm(
  {
    displayName: initialDisplayName,
    bio: initialBio,
    avatarUrl,
    microblogVisible: initialMicroblogVisible,
    websiteUrl: initialWebsiteUrl,
    websiteVisible: initialWebsiteVisible,
    nameLabel,
    namePlaceholder,
    bioLabel,
    bioPlaceholder,
    saveLabel,
    savingLabel,
    savedLabel,
    errorLabel,
    onSaved,
  }: Props,
) {
  const displayName = useSignal(initialDisplayName);
  const bio = useSignal(initialBio);
  const avatarPreview = useSignal<string | null>(avatarUrl);
  const microblogVisible = useSignal(initialMicroblogVisible);
  const websiteUrl = useSignal(initialWebsiteUrl ?? "");
  const websiteVisible = useSignal(initialWebsiteVisible);
  const submitting = useSignal(false);
  const message = useSignal<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    submitting.value = true;
    message.value = null;
    const form = event.currentTarget as HTMLFormElement;
    try {
      const response = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || errorLabel);
      }
      message.value = { kind: "ok", text: savedLabel };
      onSaved?.();
    } catch (err) {
      message.value = {
        kind: "error",
        text: err instanceof Error ? err.message : errorLabel,
      };
    } finally {
      submitting.value = false;
    }
  };

  return (
    <form
      method="POST"
      action="/api/account/profile"
      class="user-profile-client-form"
      onSubmit={onSubmit}
    >
      <div class="account-profile-edit-avatar-row">
        <div class="account-profile-edit-avatar-preview" aria-hidden="true">
          {avatarPreview.value
            ? (
              <img
                src={avatarPreview.value}
                alt=""
                loading="lazy"
                decoding="async"
              />
            )
            : <span>{displayName.value.trim().charAt(0).toUpperCase()}</span>}
        </div>
        <div class="account-profile-edit-avatar-copy">
          <span class="user-bsky-picker-label">Avatar</span>
          <label class="account-profile-edit-avatar-button">
            <input
              type="file"
              name="avatarUpload"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = (event.currentTarget as HTMLInputElement)
                  .files?.[0] ?? null;
                if (file) avatarPreview.value = URL.createObjectURL(file);
              }}
            />
            <span>
              {avatarPreview.value ? "Replace avatar" : "Upload avatar"}
            </span>
          </label>
          <p class="profile-form-hint">
            PNG, JPEG, or WebP. Saved with your account.
          </p>
        </div>
      </div>

      <label class="profile-form-field">
        <span class="user-bsky-picker-label">{nameLabel}</span>
        <input
          type="text"
          name="displayName"
          value={displayName.value}
          maxLength={60}
          required
          placeholder={namePlaceholder}
          class="profile-form-input account-profile-edit-input"
          onInput={(event) =>
            displayName.value = (event.currentTarget as HTMLInputElement).value}
        />
      </label>
      <label class="profile-form-field">
        <span class="user-bsky-picker-label">{bioLabel}</span>
        <textarea
          name="bio"
          value={bio.value}
          maxLength={500}
          placeholder={bioPlaceholder}
          class="profile-form-input account-profile-edit-input user-profile-bio-input"
          onInput={(event) =>
            bio.value = (event.currentTarget as HTMLTextAreaElement).value}
        />
      </label>
      <section class="account-profile-edit-link-settings">
        <div>
          <span class="user-bsky-picker-label">Public links</span>
          <p class="profile-form-hint">
            Choose which links appear on your public Atmosphere profile.
          </p>
        </div>
        <label class="account-profile-edit-toggle-row">
          <span class="account-profile-edit-toggle-copy">
            <strong>Show Bluesky profile</strong>
            <small>
              The viewer is chosen from the button beside Account home.
            </small>
          </span>
          <span class="account-profile-edit-switch">
            <input type="hidden" name="bskyButtonVisible" value="0" />
            <input
              type="checkbox"
              name="bskyButtonVisible"
              value="1"
              checked={microblogVisible.value}
              onChange={(event) =>
                microblogVisible.value =
                  (event.currentTarget as HTMLInputElement).checked}
            />
            <span aria-hidden="true" />
          </span>
        </label>
        <label class="account-profile-edit-toggle-row">
          <span class="account-profile-edit-toggle-copy">
            <strong>Show website link</strong>
            <small>Add a personal site, portfolio, or homepage.</small>
          </span>
          <span class="account-profile-edit-switch">
            <input type="hidden" name="websiteVisible" value="0" />
            <input
              type="checkbox"
              name="websiteVisible"
              value="1"
              checked={websiteVisible.value}
              onChange={(event) =>
                websiteVisible.value =
                  (event.currentTarget as HTMLInputElement).checked}
            />
            <span aria-hidden="true" />
          </span>
        </label>
        <label class="profile-form-field account-profile-edit-website-field">
          <span class="user-bsky-picker-label">Website</span>
          <input
            type="text"
            name="websiteUrl"
            value={websiteUrl.value}
            maxLength={512}
            inputMode="url"
            placeholder="you.com"
            class="profile-form-input account-profile-edit-input"
            onInput={(event) =>
              websiteUrl.value =
                (event.currentTarget as HTMLInputElement).value}
          />
          <span class="profile-form-hint">
            You can paste a full URL or just a domain.
          </span>
        </label>
      </section>
      <div class="user-profile-save-row">
        <button
          type="submit"
          class="profile-form-button-primary"
          disabled={submitting.value}
        >
          {submitting.value ? savingLabel : saveLabel}
        </button>
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
