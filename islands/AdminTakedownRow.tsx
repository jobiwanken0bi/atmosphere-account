import { useSignal } from "@preact/signals";

interface Props {
  did: string;
  handle: string;
  name: string;
  reason: string;
  by: string;
  at: number;
  copy: {
    reasonLabel: string;
    byLabel: string;
    atLabel: string;
    restore: string;
    confirmRestore: string;
    restored: string;
    error: string;
  };
}

/**
 * Single row in /admin/takedowns. Shows the taken-down profile's
 * metadata + a Restore button that POSTs to
 * /api/admin/profiles/:did/restore. On success the row collapses to a
 * lightweight "restored" confirmation so the page doesn't need a full
 * reload to feel responsive.
 */
export default function AdminTakedownRow(p: Props) {
  const status = useSignal<
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "done" }
    | { kind: "error"; text: string }
  >({ kind: "idle" });

  const restore = async () => {
    if (!confirm(p.copy.confirmRestore)) return;
    status.value = { kind: "submitting" };
    try {
      const r = await fetch(
        `/api/admin/profiles/${encodeURIComponent(p.did)}/restore`,
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
      <div class="admin-report-row admin-report-row--done">
        <div class="admin-report-meta">
          <span>
            <strong>@{p.handle}</strong>
          </span>
          <span>
            <span class="admin-status-badge admin-status-badge--approved">
              {p.copy.restored}
            </span>
          </span>
        </div>
      </div>
    );
  }

  const at = new Date(p.at).toISOString().slice(0, 10);
  return (
    <div class="admin-report-row">
      <div class="admin-report-meta">
        <span>
          <strong>{p.name}</strong>
          <span class="admin-featured-handle">@{p.handle}</span>
        </span>
        <span>
          {p.copy.atLabel}: <strong>{at}</strong>
        </span>
        <span>
          {p.copy.byLabel}: <strong>{p.by}</strong>
        </span>
      </div>
      <p class="admin-report-details">
        <strong>{p.copy.reasonLabel}:</strong> {p.reason}
      </p>
      <div class="admin-report-actions">
        <button
          type="button"
          class="profile-form-button-secondary"
          onClick={restore}
          disabled={status.value.kind === "submitting"}
        >
          {p.copy.restore}
        </button>
      </div>
      {status.value.kind === "error" && (
        <p class="admin-icon-row-error">
          {p.copy.error}: {status.value.text}
        </p>
      )}
    </div>
  );
}
