import { useSignal } from "@preact/signals";

interface Props {
  did: string;
  label: string;
  promptText: string;
  doneLabel: string;
  errorPrefix: string;
}

/**
 * Compact revoke button used per-row on the granted list of
 * /admin/icon-access. Posts to the same `deny` endpoint the pending
 * queue uses, since "revoke a granted project" and "deny a pending
 * request" land the row in the same `denied` state.
 */
export default function AdminIconAccessRevoke(p: Props) {
  const status = useSignal<
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "done" }
    | { kind: "error"; text: string }
  >({ kind: "idle" });

  const onClick = async () => {
    const reason = globalThis.prompt(p.promptText, "");
    // null = cancelled; empty string = no reason but proceed.
    if (reason === null) return;
    status.value = { kind: "submitting" };
    try {
      const r = await fetch(
        `/api/admin/icon-access/${encodeURIComponent(p.did)}/deny`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() || undefined }),
        },
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
      <span class="admin-status-badge admin-status-badge--rejected">
        {p.doneLabel}
      </span>
    );
  }

  const submitting = status.value.kind === "submitting";
  return (
    <>
      <button
        type="button"
        class="profile-form-button-secondary"
        onClick={onClick}
        disabled={submitting}
      >
        {submitting ? "…" : p.label}
      </button>
      {status.value.kind === "error" && (
        <p class="admin-icon-row-error">
          {p.errorPrefix}: {status.value.text}
        </p>
      )}
    </>
  );
}
