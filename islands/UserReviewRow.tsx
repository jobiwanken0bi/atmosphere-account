import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import AtmosphereHandle from "../components/AtmosphereHandle.tsx";
import {
  type ContextualReauthorization,
  contextualReauthorization,
  contextualReauthorizationFromApiPayload,
} from "../lib/reauth-required.ts";
import ContextualReauthorizationDialog from "./ContextualReauthorizationDialog.tsx";
import {
  accountReviewDeleteResumeLocation,
  accountReviewDeleteReturnPath,
} from "../lib/app-interaction-reauth.ts";

interface Props {
  reviewId: number;
  targetHandle: string;
  targetName: string;
  rating: number;
  body: string;
  updatedAt: number;
  currentDid: string;
  currentHandle: string;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  copy: {
    viewProject: string;
    delete: string;
    confirmDelete: string;
    deleting: string;
    deleted: string;
    error: string;
  };
}

export default function UserReviewRow(p: Props) {
  const status = useSignal<"idle" | "deleting" | "deleted">("idle");
  const error = useSignal<string | null>(null);
  const reauthorization = useSignal<ContextualReauthorization | null>(null);

  const remove = async () => {
    if (status.value === "deleting") return;
    if (!globalThis.confirm(p.copy.confirmDelete)) return;
    status.value = "deleting";
    error.value = null;
    try {
      const r = await fetch(
        `/api/registry/reviews/${encodeURIComponent(String(p.reviewId))}`,
        { method: "DELETE" },
      );
      const payload = await r.json().catch(() => null) as
        | { ok?: unknown; error?: string; detail?: string; reauthUrl?: string }
        | null;
      if (!r.ok) {
        const contextual = contextualReauthorizationFromApiPayload(payload) ??
          (r.status === 401 || payload?.error === "not_authenticated" ||
              payload?.error === "oauth_session_expired"
            ? contextualReauthorization({
              returnTo: accountReviewDeleteReturnPath(p.reviewId),
              action: "legacy_review_manage",
              capabilities: ["legacy_review"],
              targetName: p.targetName,
            })
            : null);
        if (contextual) {
          status.value = "idle";
          reauthorization.value = contextual;
          return;
        }
        throw new Error(p.copy.error);
      }
      if (payload?.ok !== true) throw new Error(p.copy.error);
      status.value = "deleted";
    } catch {
      error.value = p.copy.error;
      status.value = "idle";
    }
  };

  useEffect(() => {
    const resume = accountReviewDeleteResumeLocation(
      globalThis.location.href,
      p.reviewId,
    );
    if (!resume.shouldConfirm) return;
    globalThis.history.replaceState(null, "", resume.cleanLocation);
    void remove();
  }, []);

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
            <a href={`/apps/${encodeURIComponent(p.targetHandle)}`}>
              <AtmosphereHandle handle={p.targetHandle} />
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
          href={`/apps/${encodeURIComponent(p.targetHandle)}`}
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
        <p
          class="report-modal-status report-modal-status--error"
          role="alert"
        >
          {error.value}
        </p>
      )}
      {reauthorization.value && (
        <ContextualReauthorizationDialog
          authorization={reauthorization.value}
          currentDid={p.currentDid}
          currentHandle={p.currentHandle}
          rememberedAccounts={p.rememberedAccounts}
          restrictToCurrentAccount
          onClose={() => reauthorization.value = null}
        />
      )}
    </article>
  );
}
