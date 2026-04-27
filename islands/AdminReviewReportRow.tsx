import { useSignal } from "@preact/signals";

interface Props {
  id: number;
  reviewId: number;
  targetHandle: string;
  reviewerDid: string | null;
  reporterDid: string | null;
  rating: number | null;
  body: string | null;
  reviewStatus: string | null;
  reasonLabel: string;
  details: string | null;
  createdAt: number;
  copy: {
    action: string;
    dismiss: string;
    hide: string;
    remove: string;
    restore: string;
    actionedLabel: string;
    dismissedLabel: string;
    hiddenLabel: string;
    removedLabel: string;
    restoredLabel: string;
    notePlaceholder: string;
    reasonLabel: string;
    reporterLabel: string;
    reviewerLabel: string;
    detailsLabel: string;
    reviewLabel: string;
    submittedAt: string;
    error: string;
  };
}

type DoneKind = "actioned" | "dismissed" | "hidden" | "removed" | "restored";

export default function AdminReviewReportRow(p: Props) {
  const notes = useSignal("");
  const status = useSignal<
    | { kind: "open" }
    | { kind: "submitting" }
    | { kind: "done"; action: DoneKind }
    | { kind: "error"; text: string }
  >({ kind: "open" });

  const resolve = async (action: "actioned" | "dismissed") => {
    status.value = { kind: "submitting" };
    try {
      const r = await fetch(`/api/admin/review-reports/${p.id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          notes: notes.value.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      status.value = { kind: "done", action };
    } catch (err) {
      status.value = {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const moderate = async (action: "hide" | "remove" | "restore") => {
    status.value = { kind: "submitting" };
    try {
      const r = await fetch(`/api/admin/reviews/${p.reviewId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: notes.value.trim() || undefined }),
      });
      if (!r.ok) throw new Error(await r.text());
      if (action !== "restore") {
        await resolve("actioned");
        status.value = {
          kind: "done",
          action: action === "hide" ? "hidden" : "removed",
        };
        return;
      }
      status.value = { kind: "done", action: "restored" };
    } catch (err) {
      status.value = {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      };
    }
  };

  if (status.value.kind === "done") {
    const labels: Record<DoneKind, string> = {
      actioned: p.copy.actionedLabel,
      dismissed: p.copy.dismissedLabel,
      hidden: p.copy.hiddenLabel,
      removed: p.copy.removedLabel,
      restored: p.copy.restoredLabel,
    };
    return (
      <div class="admin-report-row admin-report-row--done">
        <div class="admin-report-meta">
          <span>
            <strong>@{p.targetHandle}</strong>
          </span>
          <span>{p.reasonLabel}</span>
          <span>
            <span class="admin-status-badge admin-status-badge--approved">
              {labels[status.value.action]}
            </span>
          </span>
        </div>
      </div>
    );
  }

  const submitted = new Date(p.createdAt).toISOString().slice(0, 10);
  const reviewMissing = p.rating == null || p.body == null;
  return (
    <div class="admin-report-row">
      <div class="admin-report-meta">
        <span>
          <strong>
            <a href={`/explore/${p.targetHandle}`}>@{p.targetHandle}</a>
          </strong>
        </span>
        <span>
          {p.copy.reasonLabel}: <strong>{p.reasonLabel}</strong>
        </span>
        <span>
          {p.copy.reporterLabel}: <strong>{p.reporterDid ?? "Unknown"}</strong>
        </span>
        <span>
          {p.copy.reviewerLabel}: <strong>{p.reviewerDid ?? "Unknown"}</strong>
        </span>
        <span>
          {p.copy.submittedAt}: <strong>{submitted}</strong>
        </span>
      </div>
      {p.details && (
        <p class="admin-report-details">
          <strong>{p.copy.detailsLabel}:</strong> {p.details}
        </p>
      )}
      <p class="admin-report-details">
        <strong>{p.copy.reviewLabel}:</strong> {reviewMissing
          ? "Review no longer exists."
          : `${"★".repeat(p.rating!)} ${p.body || "(no text)"}`}
      </p>
      <div class="admin-report-actions">
        <input
          type="text"
          class="admin-report-notes-input"
          placeholder={p.copy.notePlaceholder}
          value={notes.value}
          onInput={(e) =>
            notes.value = (e.currentTarget as HTMLInputElement).value}
        />
        <button
          type="button"
          class="profile-form-button-primary"
          onClick={() => resolve("actioned")}
          disabled={status.value.kind === "submitting"}
        >
          {p.copy.action}
        </button>
        <button
          type="button"
          class="profile-form-button-secondary"
          onClick={() => resolve("dismissed")}
          disabled={status.value.kind === "submitting"}
        >
          {p.copy.dismiss}
        </button>
        <button
          type="button"
          class="admin-report-takedown-button"
          onClick={() => moderate("hide")}
          disabled={status.value.kind === "submitting" || reviewMissing}
        >
          {p.copy.hide}
        </button>
        <button
          type="button"
          class="admin-report-takedown-button"
          onClick={() => moderate("remove")}
          disabled={status.value.kind === "submitting" || reviewMissing}
        >
          {p.copy.remove}
        </button>
        {p.reviewStatus && p.reviewStatus !== "visible" && (
          <button
            type="button"
            class="profile-form-button-secondary"
            onClick={() => moderate("restore")}
            disabled={status.value.kind === "submitting" || reviewMissing}
          >
            {p.copy.restore}
          </button>
        )}
      </div>
      {status.value.kind === "error" && (
        <p class="admin-icon-row-error">
          {p.copy.error}: {status.value.text}
        </p>
      )}
    </div>
  );
}
