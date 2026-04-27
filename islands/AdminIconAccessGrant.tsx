import { useSignal } from "@preact/signals";

interface Props {
  copy: {
    inputLabel: string;
    placeholder: string;
    help: string;
    submit: string;
    successSuffix: string;
    notFound: string;
    error: string;
  };
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; name: string; handle: string }
  | { kind: "error"; text: string };

/**
 * Admin-only proactive verification form. This complements the pending
 * request queue: projects can still request verification, but admins can
 * also grant it directly after finding a published profile.
 */
export default function AdminIconAccessGrant({ copy }: Props) {
  const identifier = useSignal("");
  const status = useSignal<Status>({ kind: "idle" });

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    const value = identifier.value.trim();
    if (!value) return;
    status.value = { kind: "submitting" };
    try {
      const r = await fetch("/api/admin/icon-access/grant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: value }),
      });
      const payload = await r.json().catch(() => null) as {
        error?: string;
        profile?: { name?: string; handle?: string };
      } | null;
      if (!r.ok) {
        const message = payload?.error === "profile_not_found"
          ? copy.notFound
          : JSON.stringify(payload ?? { status: r.status });
        throw new Error(message);
      }
      status.value = {
        kind: "success",
        name: payload?.profile?.name ?? value,
        handle: payload?.profile?.handle ?? value.replace(/^@/, ""),
      };
      identifier.value = "";
    } catch (err) {
      status.value = {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const submitting = status.value.kind === "submitting";

  return (
    <form class="admin-verify-form glass" onSubmit={onSubmit}>
      <label class="signin-form-label" for="admin-verify-identifier">
        {copy.inputLabel}
      </label>
      <div class="admin-verify-form-row">
        <input
          id="admin-verify-identifier"
          type="text"
          class="signin-form-input"
          placeholder={copy.placeholder}
          value={identifier.value}
          onInput={(event) => {
            identifier.value = (event.currentTarget as HTMLInputElement).value;
            if (status.value.kind !== "submitting") {
              status.value = { kind: "idle" };
            }
          }}
        />
        <button
          type="submit"
          class="profile-form-button-primary"
          disabled={submitting || !identifier.value.trim()}
        >
          {submitting ? "..." : copy.submit}
        </button>
      </div>
      <p class="signin-form-hint">{copy.help}</p>
      {status.value.kind === "success" && (
        <p class="profile-form-status profile-form-status--ok">
          {status.value.name} (@{status.value.handle}) {copy.successSuffix}
        </p>
      )}
      {status.value.kind === "error" && (
        <p class="profile-form-status profile-form-status--error">
          {copy.error}: {status.value.text}
        </p>
      )}
    </form>
  );
}
