import { useSignal } from "@preact/signals";

interface Props {
  did: string;
  handle: string;
  name: string;
  /** Admin-only preview URL — bypasses the public approval gate. */
  previewUrl: string;
  /** When the icon was uploaded / last reindexed. */
  uploadedAt: number;
  copy: {
    approve: string;
    reject: string;
    rejectReasonPlaceholder: string;
    confirmReject: string;
    submit: string;
    cancel: string;
    pending: string;
    approved: string;
    rejected: string;
    error: string;
  };
}

type Status = "pending" | "approving" | "approved" | "rejecting" | "rejected";

/**
 * Per-row review widget on /admin/icons. Server renders the static
 * project info; this island owns the buttons + reject-reason flow and
 * removes the row from the DOM optimistically once the API returns.
 */
export default function AdminIconReview(
  { did, handle, name, previewUrl, uploadedAt, copy }: Props,
) {
  const status = useSignal<Status>("pending");
  const error = useSignal<string | null>(null);
  const showReject = useSignal(false);
  const reason = useSignal("");

  const onApprove = async () => {
    status.value = "approving";
    error.value = null;
    try {
      const r = await fetch(
        `/api/admin/icons/${encodeURIComponent(did)}/approve`,
        { method: "POST" },
      );
      if (!r.ok) throw new Error(await r.text());
      status.value = "approved";
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      status.value = "pending";
    }
  };

  const onReject = async () => {
    const text = reason.value.trim();
    if (!text) return;
    status.value = "rejecting";
    error.value = null;
    try {
      const r = await fetch(
        `/api/admin/icons/${encodeURIComponent(did)}/reject`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: text }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
      status.value = "rejected";
      showReject.value = false;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      status.value = "pending";
    }
  };

  if (status.value === "approved") {
    return (
      <div class="admin-icon-row admin-icon-row--done">
        <strong>{name}</strong>{" "}
        <span class="admin-status-badge admin-status-badge--approved">
          {copy.approved}
        </span>
      </div>
    );
  }
  if (status.value === "rejected") {
    return (
      <div class="admin-icon-row admin-icon-row--done">
        <strong>{name}</strong>{" "}
        <span class="admin-status-badge admin-status-badge--rejected">
          {copy.rejected}
        </span>
      </div>
    );
  }

  const uploaded = new Date(uploadedAt).toISOString().slice(0, 10);

  return (
    <div class="admin-icon-row">
      <div class="admin-icon-row-preview">
        <img src={previewUrl} alt="" class="admin-icon-row-img" />
      </div>
      <div class="admin-icon-row-meta">
        <p class="admin-icon-row-name">
          <strong>{name}</strong>
          <span class="admin-icon-row-handle">@{handle}</span>
        </p>
        <p class="admin-icon-row-did">
          <code>{did}</code>
        </p>
        <p class="admin-icon-row-uploaded">Uploaded {uploaded}</p>
      </div>
      <div class="admin-icon-row-actions">
        {!showReject.value
          ? (
            <>
              <button
                type="button"
                class="profile-form-button-primary"
                onClick={onApprove}
                disabled={status.value === "approving"}
              >
                {status.value === "approving" ? "…" : copy.approve}
              </button>
              <button
                type="button"
                class="profile-form-button-secondary"
                onClick={() => {
                  showReject.value = true;
                }}
              >
                {copy.reject}
              </button>
            </>
          )
          : (
            <div class="admin-icon-reject">
              <label class="admin-icon-reject-label">
                {copy.confirmReject}
                <textarea
                  class="admin-icon-reject-input"
                  rows={3}
                  maxLength={500}
                  placeholder={copy.rejectReasonPlaceholder}
                  value={reason.value}
                  onInput={(e) =>
                    reason.value = (e.currentTarget as HTMLTextAreaElement)
                      .value}
                />
              </label>
              <div class="admin-icon-reject-actions">
                <button
                  type="button"
                  class="profile-form-button-primary"
                  onClick={onReject}
                  disabled={status.value === "rejecting" ||
                    !reason.value.trim()}
                >
                  {status.value === "rejecting" ? "…" : copy.submit}
                </button>
                <button
                  type="button"
                  class="profile-form-button-link"
                  onClick={() => {
                    showReject.value = false;
                    reason.value = "";
                  }}
                >
                  {copy.cancel}
                </button>
              </div>
            </div>
          )}
        {error.value && (
          <p class="admin-icon-row-error">
            {copy.error}: {error.value}
          </p>
        )}
      </div>
    </div>
  );
}
