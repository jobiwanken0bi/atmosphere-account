import { useSignal } from "@preact/signals";

interface Props {
  did: string;
  label: string;
  doneLabel: string;
  errorPrefix: string;
}

/**
 * Compact one-click verifier for existing profiles in the admin roster.
 * The request queue keeps its richer Grant/Deny row; this is for profiles
 * that simply have not been verified yet.
 */
export default function AdminIconAccessVerifyButton(p: Props) {
  const status = useSignal<
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "done" }
    | { kind: "error"; text: string }
  >({ kind: "idle" });

  const onClick = async () => {
    status.value = { kind: "submitting" };
    try {
      const r = await fetch(
        `/api/admin/icon-access/${encodeURIComponent(p.did)}/grant`,
        { method: "POST" },
      );
      if (!r.ok) throw new Error(await r.text());
      status.value = { kind: "done" };
    } catch (err) {
      status.value = {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      };
    }
  };

  if (status.value.kind === "done") {
    return (
      <span class="admin-status-badge admin-status-badge--approved">
        {p.doneLabel}
      </span>
    );
  }

  const submitting = status.value.kind === "submitting";

  return (
    <>
      <button
        type="button"
        class="profile-form-button-primary"
        onClick={onClick}
        disabled={submitting}
      >
        {submitting ? "..." : p.label}
      </button>
      {status.value.kind === "error" && (
        <p class="admin-icon-row-error">
          {p.errorPrefix}: {status.value.text}
        </p>
      )}
    </>
  );
}
