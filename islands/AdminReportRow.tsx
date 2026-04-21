import { useSignal } from "@preact/signals";

interface Props {
  id: number;
  targetDid: string;
  targetHandle: string;
  reporterDid: string | null;
  reason: string;
  reasonLabel: string;
  details: string | null;
  createdAt: number;
  copy: {
    action: string;
    dismiss: string;
    takedown: string;
    takedownPrompt: string;
    takedownDoneLabel: string;
    actionedLabel: string;
    dismissedLabel: string;
    noteLabel: string;
    notePlaceholder: string;
    reasonLabel: string;
    reporterLabel: string;
    anonymousReporter: string;
    detailsLabel: string;
    submittedAt: string;
    error: string;
  };
}

type ResolutionKind = "actioned" | "dismissed" | "taken_down";

export default function AdminReportRow(p: Props) {
  const notes = useSignal("");
  const status = useSignal<
    | { kind: "open" }
    | { kind: "submitting" }
    | { kind: "done"; action: ResolutionKind }
    | { kind: "error"; text: string }
  >({ kind: "open" });

  const resolve = async (action: "actioned" | "dismissed") => {
    status.value = { kind: "submitting" };
    try {
      const r = await fetch(
        `/api/admin/reports/${p.id}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            notes: notes.value.trim() || undefined,
          }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
      status.value = { kind: "done", action };
    } catch (err) {
      status.value = {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      };
    }
  };

  /**
   * Take down the *target profile* (not just the report). The reason
   * field is required by the API; we collect it via a prompt() so the
   * row stays compact. Side effects on success: the profile becomes
   * invisible to /explore + public APIs, and *all* open reports
   * against this DID are auto-resolved as actioned (so this row's
   * sibling reports also disappear on the next page load).
   */
  const takedown = async () => {
    const reason = window.prompt(p.copy.takedownPrompt, "");
    if (!reason || !reason.trim()) return;
    status.value = { kind: "submitting" };
    try {
      const r = await fetch(
        `/api/admin/profiles/${encodeURIComponent(p.targetDid)}/takedown`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: reason.trim(),
            notes: notes.value.trim() || undefined,
          }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
      status.value = { kind: "done", action: "taken_down" };
    } catch (err) {
      status.value = {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      };
    }
  };

  if (status.value.kind === "done") {
    const label = status.value.action === "actioned"
      ? p.copy.actionedLabel
      : status.value.action === "dismissed"
      ? p.copy.dismissedLabel
      : p.copy.takedownDoneLabel;
    return (
      <div class="admin-report-row admin-report-row--done">
        <div class="admin-report-meta">
          <span>
            <strong>@{p.targetHandle}</strong>
          </span>
          <span>{p.reasonLabel}</span>
          <span>
            <span class="admin-status-badge admin-status-badge--approved">
              {label}
            </span>
          </span>
        </div>
      </div>
    );
  }

  const submitted = new Date(p.createdAt).toISOString().slice(0, 10);
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
          {p.copy.reporterLabel}:{" "}
          <strong>{p.reporterDid ?? p.copy.anonymousReporter}</strong>
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
          onClick={takedown}
          disabled={status.value.kind === "submitting"}
        >
          {p.copy.takedown}
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
