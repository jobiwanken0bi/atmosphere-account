import { useSignal } from "@preact/signals";

interface Props {
  reviewId: number;
  targetHandle: string;
  targetName: string;
  rating: number;
  body: string;
  updatedAt: number;
  copy: {
    viewProject: string;
    delete: string;
    deleting: string;
    deleted: string;
    error: string;
  };
}

export default function UserReviewRow(p: Props) {
  const status = useSignal<"idle" | "deleting" | "deleted">("idle");
  const error = useSignal<string | null>(null);

  const remove = async () => {
    status.value = "deleting";
    error.value = null;
    try {
      const r = await fetch(
        `/api/registry/reviews/${encodeURIComponent(String(p.reviewId))}`,
        { method: "DELETE" },
      );
      if (!r.ok) throw new Error(await r.text());
      status.value = "deleted";
    } catch (err) {
      error.value = err instanceof Error ? err.message : p.copy.error;
      status.value = "idle";
    }
  };

  if (status.value === "deleted") {
    return (
      <article class="user-review-row glass user-review-row--deleted">
        {p.copy.deleted}
      </article>
    );
  }

  return (
    <article class="user-review-row glass">
      <div class="user-review-row-header">
        <div>
          <h2>{p.targetName}</h2>
          <p>
            <a href={`/explore/${encodeURIComponent(p.targetHandle)}`}>
              @{p.targetHandle}
            </a>
          </p>
        </div>
        <p class="profile-review-stars" aria-label={`${p.rating} stars`}>
          {"★".repeat(p.rating)}
          <span aria-hidden="true">{"☆".repeat(5 - p.rating)}</span>
        </p>
      </div>
      {p.body && <p class="user-review-row-body">{p.body}</p>}
      <div class="user-review-row-actions">
        <span>{new Date(p.updatedAt).toISOString().slice(0, 10)}</span>
        <a
          class="profile-form-button-secondary"
          href={`/explore/${encodeURIComponent(p.targetHandle)}`}
        >
          {p.copy.viewProject}
        </a>
        <button
          type="button"
          class="profile-form-button-danger"
          onClick={remove}
          disabled={status.value === "deleting"}
        >
          {status.value === "deleting" ? p.copy.deleting : p.copy.delete}
        </button>
      </div>
      {error.value && (
        <p class="report-modal-status report-modal-status--error">
          {p.copy.error}: {error.value}
        </p>
      )}
    </article>
  );
}
