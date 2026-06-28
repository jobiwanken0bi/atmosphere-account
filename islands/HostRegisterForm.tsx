import { useSignal } from "@preact/signals";
import type { HostSignupStatus } from "../lib/account-hosts.ts";

interface RegisterValues {
  host: string;
  displayName: string;
  description: string;
  homepageUrl: string;
  serviceEndpoint: string;
  accountManagementUrl: string;
  supportUrl: string;
  signupStatus: HostSignupStatus;
  avatarUrl: string | null;
  bskyProfileVisible: boolean;
}

interface Props {
  values: RegisterValues;
  hasOAuthSession: boolean;
}

const SIGNUP_STATUSES: Array<{
  value: HostSignupStatus;
  label: string;
}> = [
  { value: "open", label: "Open signup" },
  { value: "invite_required", label: "Invite required" },
  { value: "closed", label: "Closed" },
  { value: "unknown", label: "Not sure yet" },
];

export default function HostRegisterForm({ values, hasOAuthSession }: Props) {
  const avatarPreview = useSignal<string | null>(values.avatarUrl);
  const host = useSignal(values.host);
  const displayName = useSignal(values.displayName);
  const homepageUrl = useSignal(values.homepageUrl);
  const serviceEndpoint = useSignal(values.serviceEndpoint);
  const accountManagementUrl = useSignal(values.accountManagementUrl);
  const supportUrl = useSignal(values.supportUrl);
  const signupStatus = useSignal(values.signupStatus);
  const description = useSignal(values.description);
  const bskyProfileVisible = useSignal(values.bskyProfileVisible);

  function onAvatarChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    avatarPreview.value = URL.createObjectURL(file);
  }

  return (
    <form method="POST" encType="multipart/form-data" class="host-manage-form">
      <div class="profile-form-row host-register-profile-row">
        <div class="profile-form-avatar">
          {avatarPreview.value
            ? (
              <img
                src={avatarPreview.value}
                alt="Host avatar preview"
                class="profile-form-avatar-img"
              />
            )
            : (
              <div class="profile-form-avatar-placeholder" aria-hidden="true">
                {values.displayName.trim().slice(0, 1).toUpperCase() || "A"}
              </div>
            )}
          <label class="profile-form-button-secondary">
            {avatarPreview.value ? "Replace avatar" : "Upload avatar"}
            <input
              type="file"
              name="avatarUpload"
              accept="image/png,image/jpeg,image/webp"
              class="sr-only"
              onChange={onAvatarChange}
            />
          </label>
          <p class="profile-form-hint host-register-avatar-hint">
            {values.avatarUrl
              ? "Prefilled from the signed-in account's Bluesky profile."
              : "Use the host logo, icon, or account avatar."}
          </p>
          {!hasOAuthSession && (
            <p class="profile-form-hint host-register-avatar-hint">
              Uploaded images publish after signing in with a real OAuth
              session.
            </p>
          )}
        </div>

        <div class="profile-form-fields">
          <label class="profile-form-field">
            <span class="profile-form-label">Host domain</span>
            <input
              class="profile-form-input"
              name="host"
              type="text"
              value={host.value}
              onInput={(event) =>
                host.value = (event.currentTarget as HTMLInputElement).value}
              placeholder="pckt.cafe"
              required
              autoComplete="off"
              spellcheck={false}
            />
            <span class="profile-form-hint">
              Usually the domain people get in their handle, like pckt.cafe or
              npmx.social.
            </span>
          </label>
          <label class="profile-form-field">
            <span class="profile-form-label">Host name</span>
            <input
              class="profile-form-input"
              name="displayName"
              type="text"
              value={displayName.value}
              onInput={(event) =>
                displayName.value =
                  (event.currentTarget as HTMLInputElement).value}
              placeholder="Pckt"
              required
              maxLength={80}
            />
          </label>
          <label class="profile-form-field">
            <span class="profile-form-label">Website or signup URL</span>
            <input
              class="profile-form-input"
              name="homepageUrl"
              type="url"
              value={homepageUrl.value}
              onInput={(event) => {
                const value = (event.currentTarget as HTMLInputElement).value;
                homepageUrl.value = value;
                if (!serviceEndpoint.value) {
                  const origin = originFromUrl(value);
                  serviceEndpoint.value = origin;
                }
              }}
              placeholder="https://pckt.cafe"
            />
          </label>
          <label class="profile-form-field">
            <span class="profile-form-label">PDS service endpoint</span>
            <input
              class="profile-form-input"
              name="serviceEndpoint"
              type="url"
              value={serviceEndpoint.value}
              onInput={(event) => {
                const value = (event.currentTarget as HTMLInputElement).value;
                serviceEndpoint.value = value;
              }}
              placeholder="https://pds.example"
              required
            />
            <span class="profile-form-hint">
              The PDS origin that owns account controls for this host.
            </span>
          </label>
          <label class="profile-form-field">
            <span class="profile-form-label">Account management URL</span>
            <input
              class="profile-form-input"
              name="accountManagementUrl"
              type="url"
              value={accountManagementUrl.value}
              onInput={(event) =>
                accountManagementUrl.value =
                  (event.currentTarget as HTMLInputElement).value}
              placeholder="https://pds.example/account"
            />
            <span class="profile-form-hint">
              Optional. Add this when the host has a working account page for
              passwords, sessions, connected apps, and recovery.
            </span>
          </label>
          <label class="profile-form-field">
            <span class="profile-form-label">Support URL</span>
            <input
              class="profile-form-input"
              name="supportUrl"
              type="url"
              value={supportUrl.value}
              onInput={(event) =>
                supportUrl.value =
                  (event.currentTarget as HTMLInputElement).value}
              placeholder="https://pds.example/support"
            />
          </label>
          <label class="profile-form-field">
            <span class="profile-form-label">Signup status</span>
            <select
              class="profile-form-input"
              name="signupStatus"
              value={signupStatus.value}
              onChange={(event) =>
                signupStatus.value = (event.currentTarget as HTMLSelectElement)
                  .value as HostSignupStatus}
            >
              {SIGNUP_STATUSES.map((status) => (
                <option
                  value={status.value}
                  selected={signupStatus.value === status.value}
                >
                  {status.label}
                </option>
              ))}
            </select>
          </label>
          <label class="profile-form-field">
            <span class="profile-form-label">Description</span>
            <textarea
              class="profile-form-input"
              name="description"
              rows={4}
              maxLength={600}
              placeholder="A short, non-technical description of who this host is for."
              value={description.value}
              onInput={(event) =>
                description.value =
                  (event.currentTarget as HTMLTextAreaElement).value}
            >
              {description.value}
            </textarea>
          </label>
          <input type="hidden" name="bskyProfileVisible" value="0" />
          <div
            class={`atmosphere-row host-profile-toggle ${
              bskyProfileVisible.value ? "is-on" : ""
            }`}
          >
            <label class="atmosphere-row-toggle">
              <input
                type="checkbox"
                name="bskyProfileVisible"
                value="1"
                checked={bskyProfileVisible.value}
                onChange={(event) =>
                  bskyProfileVisible.value =
                    (event.currentTarget as HTMLInputElement).checked}
              />
              <span class="atmosphere-toggle-track" aria-hidden="true">
                <span class="atmosphere-toggle-thumb" />
              </span>
            </label>
            <span class="atmosphere-row-body">
              <span class="atmosphere-row-copy">
                <span class="atmosphere-row-title">
                  Show Bluesky profile button
                </span>
                <span class="atmosphere-row-subtitle">
                  Adds a small Bluesky icon link to the public host page.
                </span>
              </span>
            </span>
          </div>
        </div>
      </div>

      <div class="host-manage-actions">
        <button
          type="submit"
          class="directory-register-button host-manage-save"
        >
          <span class="directory-register-button-icon">+</span>
          <span>Create host profile</span>
        </button>
        <p class="profile-form-hint host-register-submit-hint">
          Creates a claimed host listing and saves the public profile details.
        </p>
      </div>
    </form>
  );
}

function originFromUrl(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}
