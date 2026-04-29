import { useSignal } from "@preact/signals";
import { createPortal } from "preact/compat";
import type { ReviewRow } from "../lib/reviews.ts";

interface Props {
  targetId: string;
  signedIn: boolean;
  isOwner: boolean;
  loginHref: string;
  ownReview: Pick<ReviewRow, "id" | "rating" | "body"> | null;
  copy: {
    heading: string;
    modalBody: string;
    signedOut: string;
    ownerNote: string;
    ratingLabel: string;
    bodyLabel: string;
    bodyPlaceholder: string;
    charsRemainingSuffix: string;
    submit: string;
    update: string;
    submitting: string;
    delete: string;
    signIn: string;
    cancel: string;
    saved: string;
    deleted: string;
    error: string;
  };
}

const MAX_BODY = 300;

export default function ProfileReviewComposer(
  { targetId, signedIn, isOwner, loginHref, ownReview, copy }: Props,
) {
  const rating = useSignal<1 | 2 | 3 | 4 | 5>(ownReview?.rating ?? 5);
  const body = useSignal(ownReview?.body ?? "");
  const open = useSignal(false);
  const submitting = useSignal(false);
  const status = useSignal<
    | { kind: "idle" }
    | { kind: "ok"; text: string }
    | { kind: "error"; text: string }
  >({ kind: "idle" });

  const submit = async () => {
    submitting.value = true;
    status.value = { kind: "idle" };
    try {
      const r = await fetch(
        `/api/registry/profile/${encodeURIComponent(targetId)}/reviews`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            rating: rating.value,
            body: body.value.trim(),
          }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
      status.value = { kind: "ok", text: copy.saved };
      globalThis.location.reload();
    } catch (err) {
      status.value = {
        kind: "error",
        text: err instanceof Error ? err.message : copy.error,
      };
    } finally {
      submitting.value = false;
    }
  };

  const remove = async () => {
    submitting.value = true;
    status.value = { kind: "idle" };
    try {
      const r = await fetch(
        `/api/registry/profile/${encodeURIComponent(targetId)}/reviews/me`,
        { method: "DELETE" },
      );
      if (!r.ok) throw new Error(await r.text());
      status.value = { kind: "ok", text: copy.deleted };
      globalThis.location.reload();
    } catch (err) {
      status.value = {
        kind: "error",
        text: err instanceof Error ? err.message : copy.error,
      };
    } finally {
      submitting.value = false;
    }
  };

  return (
    <>
      <div class="profile-review-action-row">
        {!signedIn
          ? (
            <>
              <span class="profile-review-action-hint">{copy.signedOut}</span>
              <a class="explore-cta-primary" href={loginHref}>
                {copy.signIn}
              </a>
            </>
          )
          : isOwner
          ? <p class="text-body profile-review-owner-note">{copy.ownerNote}</p>
          : (
            <button
              type="button"
              class="explore-cta-primary profile-review-write-button"
              onClick={() => {
                open.value = true;
              }}
            >
              {!ownReview && (
                <span class="profile-review-write-icon" aria-hidden="true">
                  ✎
                </span>
              )}
              {ownReview ? copy.update : copy.heading}
            </button>
          )}
      </div>

      {open.value && signedIn && !isOwner && createPortal(
        <div
          class="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) open.value = false;
          }}
        >
          <div class="modal-card">
            <div class="modal-header">
              <p class="modal-title">{copy.heading}</p>
              <p class="modal-body-text">{copy.modalBody}</p>
            </div>
            <fieldset class="profile-review-rating-field">
              <legend>{copy.ratingLabel}</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  class={n <= rating.value
                    ? "profile-review-star is-active"
                    : "profile-review-star"}
                  aria-pressed={n <= rating.value}
                  onClick={() => rating.value = n as 1 | 2 | 3 | 4 | 5}
                  key={n}
                >
                  ★
                </button>
              ))}
            </fieldset>
            <label class="profile-review-body-field">
              <span>{copy.bodyLabel}</span>
              <textarea
                maxLength={MAX_BODY}
                value={body.value}
                placeholder={copy.bodyPlaceholder}
                onInput={(e) =>
                  body.value = (e.currentTarget as HTMLTextAreaElement).value}
              />
            </label>
            <p class="profile-review-char-count">
              {MAX_BODY - body.value.length} {copy.charsRemainingSuffix}
            </p>
            <div class="profile-review-composer-actions">
              <button
                type="button"
                class="profile-form-button-link"
                onClick={() => {
                  open.value = false;
                }}
                disabled={submitting.value}
              >
                {copy.cancel}
              </button>
              {ownReview && (
                <button
                  type="button"
                  class="profile-form-button-danger"
                  onClick={remove}
                  disabled={submitting.value}
                >
                  {copy.delete}
                </button>
              )}
              <button
                type="button"
                class="profile-form-button-primary"
                onClick={submit}
                disabled={submitting.value}
              >
                {submitting.value
                  ? copy.submitting
                  : ownReview
                  ? copy.update
                  : copy.submit}
              </button>
            </div>
            {status.value.kind !== "idle" && (
              <p
                class={status.value.kind === "ok"
                  ? "report-modal-status report-modal-status--ok"
                  : "report-modal-status report-modal-status--error"}
              >
                {status.value.text}
              </p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
