import { useSignal } from "@preact/signals";

interface Props {
  did: string;
  handle: string;
  name: string;
  /** Contact email captured at request time (always present for `requested` rows). */
  email: string;
  /** ms epoch — when the row entered the `requested` state. */
  requestedAt: number;
  copy: {
    grant: string;
    deny: string;
    denyPrompt: string;
    grantedLabel: string;
    deniedLabel: string;
    requestedAtLabel: string;
    emailLabel: string;
    viewProfile: string;
    error: string;
  };
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "granted" }
  | { kind: "denied" }
  | { kind: "error"; text: string };

/**
 * Per-row Grant / Deny widget on /admin/icon-access. Mirrors the
 * structure of AdminReportRow — the grid layout is server-rendered
 * around it, this island only owns the buttons and the optimistic
 * "Granted / Denied" state pill.
 */
export default function AdminIconAccessRow(p: Props) {
  const status = useSignal<Status>({ kind: "idle" });

  const grant = async () => {
    status.value = { kind: "submitting" };
    try {
      const r = await fetch(
        `/api/admin/icon-access/${encodeURIComponent(p.did)}/grant`,
        { method: "POST" },
      );
      if (!r.ok) throw new Error(await r.text());
      status.value = { kind: "granted" };
    } catch (err) {
      status.value = {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const deny = async () => {
    const reason = globalThis.prompt(p.copy.denyPrompt, "");
    // An empty / cancelled prompt means abort — but a valid empty
    // string from the user is allowed; deny without a reason is fine
    // (admin may not want to share their rationale).
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
      status.value = { kind: "denied" };
    } catch (err) {
      status.value = {
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      };
    }
  };

  if (status.value.kind === "granted") {
    return (
      <div class="admin-icon-row admin-icon-row--done">
        <strong>{p.name}</strong>{" "}
        <span class="admin-status-badge admin-status-badge--approved">
          {p.copy.grantedLabel}
        </span>
      </div>
    );
  }
  if (status.value.kind === "denied") {
    return (
      <div class="admin-icon-row admin-icon-row--done">
        <strong>{p.name}</strong>{" "}
        <span class="admin-status-badge admin-status-badge--rejected">
          {p.copy.deniedLabel}
        </span>
      </div>
    );
  }

  const requested = new Date(p.requestedAt).toISOString().slice(0, 10);
  const submitting = status.value.kind === "submitting";

  return (
    <div class="admin-icon-row">
      <div class="admin-icon-row-meta">
        <p class="admin-icon-row-name">
          <strong>{p.name}</strong>
          <span class="admin-icon-row-handle">
            <a
              href={`/explore/${encodeURIComponent(p.handle)}`}
              target="_blank"
              rel="noopener noreferrer"
              class="text-link-button"
            >
              @{p.handle} ↗
            </a>
          </span>
        </p>
        <p class="admin-icon-row-did">
          <code>{p.did}</code>
        </p>
        <p class="admin-icon-row-uploaded">
          <strong>{p.copy.emailLabel}:</strong>{" "}
          <a href={`mailto:${p.email}`} class="text-link-button">{p.email}</a>
        </p>
        <p class="admin-icon-row-uploaded">
          {p.copy.requestedAtLabel} {requested}
        </p>
      </div>
      <div class="admin-icon-row-actions">
        <button
          type="button"
          class="profile-form-button-primary"
          onClick={grant}
          disabled={submitting}
        >
          {submitting ? "…" : p.copy.grant}
        </button>
        <button
          type="button"
          class="profile-form-button-secondary"
          onClick={deny}
          disabled={submitting}
        >
          {p.copy.deny}
        </button>
        {status.value.kind === "error" && (
          <p class="admin-icon-row-error">
            {p.copy.error}: {status.value.text}
          </p>
        )}
      </div>
    </div>
  );
}
