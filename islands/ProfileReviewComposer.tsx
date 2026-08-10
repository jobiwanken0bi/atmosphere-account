import { useSignal } from "@preact/signals";
import { useEffect, useId, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import type { ReviewRow } from "../lib/reviews.ts";
import { useDialog } from "../lib/use-dialog.ts";
import {
  type ContextualReauthorization,
  contextualReauthorization,
  contextualReauthorizationFromApiPayload,
} from "../lib/reauth-required.ts";
import ContextualSignInDialog from "./ContextualSignInDialog.tsx";
import ContextualReauthorizationDialog from "./ContextualReauthorizationDialog.tsx";
import { isPlainLinkActivation } from "../lib/link-activation.ts";
import type { OAuthCapability } from "../lib/oauth-scopes.ts";
import type { OAuthAction } from "../lib/oauth-action.ts";
import { oauthCancellationLocation } from "../lib/oauth-cancellation.ts";
import {
  createAppReviewRkey,
  isAppReviewRkey,
} from "../lib/app-review-write.ts";
import ContentVisualIcon from "../components/icons/ContentVisualIcon.tsx";

type ReviewAuthorizationAction = Extract<
  OAuthAction,
  "review" | "review_manage" | "legacy_review" | "legacy_review_manage"
>;

interface Props {
  targetId: string;
  signedIn: boolean;
  isOwner: boolean;
  loginHref: string;
  returnTo: string;
  authCapabilities: readonly OAuthCapability[];
  authAction: ReviewAuthorizationAction;
  authTargetName: string;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  currentDid?: string;
  currentHandle?: string;
  ownReview: Pick<ReviewRow, "id" | "rating" | "body"> | null;
  submitEndpoint?: string;
  deleteEndpoint?: string;
  maxBodyLength?: number;
  copy: {
    heading: string;
    modalBody: string;
    ownerNote: string;
    ratingLabel: string;
    bodyLabel: string;
    bodyPlaceholder: string;
    charsRemainingSuffix: string;
    submit: string;
    update: string;
    submitting: string;
    delete: string;
    cancel: string;
    saved: string;
    deleted: string;
    error: string;
  };
}

/**
 * A rendered page can outlive its site session. When an existing review is
 * updated after that happens, the local 401 fallback must request the manage
 * capability (and stay on the review's current account), even though the
 * page's original signed-out CTA was built for creating a review.
 */
export function reviewMutationAuthorization(
  action: ReviewAuthorizationAction,
  hasExistingReview: boolean,
): {
  action: ReviewAuthorizationAction;
  capabilities: readonly OAuthCapability[];
} {
  const resolved = hasExistingReview
    ? action === "review"
      ? "review_manage"
      : action === "legacy_review"
      ? "legacy_review_manage"
      : action
    : action;
  return {
    action: resolved,
    capabilities: resolved === "legacy_review_manage"
      ? ["legacy_review"]
      : [resolved],
  };
}

export function reviewMutationFailureMessage(
  friendlyMessage: string,
  _serverDetail?: unknown,
): string {
  return friendlyMessage;
}

export function cancelReviewReauthorization(
  draftKey: string,
  storage: Pick<Storage, "removeItem"> = globalThis.sessionStorage,
): void {
  try {
    storage.removeItem(draftKey);
  } catch {
    // Private browsing policies can disable storage; dismissal must still
    // close the dialog and never replay a write.
  }
}

const REVIEW_DRAFT_PREFIX = "atmosphere:review-draft:";

export function reviewDraftKey(targetId: string, ownerDid: string): string {
  return `${REVIEW_DRAFT_PREFIX}${encodeURIComponent(ownerDid)}:${
    encodeURIComponent(targetId)
  }`;
}

export function legacyReviewDraftKey(targetId: string): string {
  return `${REVIEW_DRAFT_PREFIX}${targetId}`;
}

export function shouldResumeReviewComposer(
  href: string,
  signedIn: boolean,
  isOwner: boolean,
): boolean {
  return signedIn && !isOwner &&
    new URL(href, "https://atmosphere.invalid").searchParams.get("review") ===
      "compose";
}

export function parseOwnedReviewDraft(
  value: string | null,
  ownerDid: string,
): {
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
  reviewRkey?: string;
} | null {
  if (!value) return null;
  try {
    const draft = JSON.parse(value) as Record<string, unknown>;
    if (
      draft.ownerDid !== ownerDid || typeof draft.rating !== "number" ||
      !Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5 ||
      typeof draft.body !== "string" ||
      (draft.reviewRkey !== undefined &&
        !isAppReviewRkey(draft.reviewRkey))
    ) return null;
    return {
      rating: draft.rating as 1 | 2 | 3 | 4 | 5,
      body: draft.body,
      ...(typeof draft.reviewRkey === "string"
        ? { reviewRkey: draft.reviewRkey }
        : {}),
    };
  } catch {
    return null;
  }
}

const MAX_BODY = 300;

export default function ProfileReviewComposer(
  {
    targetId,
    signedIn,
    isOwner,
    loginHref,
    returnTo,
    authCapabilities,
    authAction,
    authTargetName,
    rememberedAccounts = [],
    currentDid,
    currentHandle,
    ownReview,
    submitEndpoint,
    deleteEndpoint,
    maxBodyLength,
    copy,
  }: Props,
) {
  const maxBody = maxBodyLength ?? MAX_BODY;
  const dialogId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const dialogTitleId = `profile-review-title-${dialogId}`;
  const dialogBodyId = `profile-review-body-${dialogId}`;
  const rating = useSignal<1 | 2 | 3 | 4 | 5>(ownReview?.rating ?? 5);
  const body = useSignal(ownReview?.body ?? "");
  const open = useSignal(false);
  const authOpen = useSignal(false);
  const reauthorization = useSignal<ContextualReauthorization | null>(null);
  const submitting = useSignal(false);
  const status = useSignal<
    | { kind: "idle" }
    | { kind: "ok"; text: string }
    | { kind: "error"; text: string }
  >({ kind: "idle" });
  const draftKey = currentDid ? reviewDraftKey(targetId, currentDid) : null;
  const oldDraftKey = legacyReviewDraftKey(targetId);
  const isNewSharedAppReview = !ownReview &&
    (authAction === "review" || authAction === "review_manage");
  const [reviewRkey, setReviewRkey] = useState<string | null>(
    () => isNewSharedAppReview ? createAppReviewRkey() : null,
  );
  const mutationAuthorization = reviewMutationAuthorization(
    authAction,
    !!ownReview,
  );

  const reauthorizationForFailure = (
    response: Response,
    payload: { error?: string; reauthUrl?: string } | null,
  ): ContextualReauthorization | null => {
    return contextualReauthorizationFromApiPayload(payload) ??
      (response.status === 401 || payload?.error === "not_authenticated" ||
          payload?.error === "oauth_session_expired"
        ? contextualReauthorization({
          returnTo,
          action: mutationAuthorization.action,
          capabilities: mutationAuthorization.capabilities,
          targetName: authTargetName,
        })
        : null);
  };

  useEffect(() => {
    const cancellation = oauthCancellationLocation(
      globalThis.location.href,
      "review-draft",
    );
    if (cancellation.wasCancelled) {
      globalThis.history.replaceState(null, "", cancellation.cleanLocation);
      if (draftKey) cancelReviewReauthorization(draftKey);
    }
    // Pre-account-binding drafts cannot be attributed safely. Discard them
    // instead of exposing one person's text after an account switch.
    cancelReviewReauthorization(oldDraftKey);
    const shouldResume = shouldResumeReviewComposer(
      globalThis.location.href,
      signedIn,
      isOwner,
    );
    if (!shouldResume) {
      if (draftKey) cancelReviewReauthorization(draftKey);
      return;
    }
    let saved: ReturnType<typeof parseOwnedReviewDraft> = null;
    if (draftKey && currentDid) {
      try {
        saved = parseOwnedReviewDraft(
          sessionStorage.getItem(draftKey),
          currentDid,
        );
      } catch {
        // Storage restrictions disable resume but must not break the editor.
      }
    }
    if (saved) {
      rating.value = saved.rating;
      body.value = saved.body.slice(0, maxBody);
      if (isNewSharedAppReview && saved.reviewRkey) {
        setReviewRkey(saved.reviewRkey);
      }
    } else if (draftKey) {
      cancelReviewReauthorization(draftKey);
    }
    const url = new URL(globalThis.location.href);
    open.value = true;
    url.searchParams.delete("review");
    globalThis.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  const close = () => {
    if (draftKey) cancelReviewReauthorization(draftKey);
    cancelReviewReauthorization(oldDraftKey);
    open.value = false;
  };

  const dialogRef = useDialog<HTMLDivElement>(
    open.value && signedIn && !isOwner,
    close,
  );

  const submit = async () => {
    if (submitting.value) return;
    submitting.value = true;
    status.value = { kind: "idle" };
    try {
      if (isNewSharedAppReview && !isAppReviewRkey(reviewRkey)) {
        throw new Error("invalid review key");
      }
      const r = await fetch(
        submitEndpoint ??
          `/api/registry/profile/${encodeURIComponent(targetId)}/reviews`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            rating: rating.value,
            body: body.value.trim(),
            ...(isNewSharedAppReview ? { rkey: reviewRkey } : {}),
          }),
        },
      );
      const payload = await r.json().catch(() => null) as
        | { ok?: unknown; error?: string; reauthUrl?: string }
        | null;
      if (!r.ok) {
        const contextual = reauthorizationForFailure(r, payload);
        if (contextual) {
          if (!draftKey || !currentDid) throw new Error("missing draft owner");
          sessionStorage.setItem(
            draftKey,
            JSON.stringify({
              ownerDid: currentDid,
              rating: rating.value,
              body: body.value,
              ...(isNewSharedAppReview ? { reviewRkey } : {}),
            }),
          );
          reauthorization.value = contextual;
          return;
        }
        throw new Error("review save failed");
      }
      if (payload?.ok !== true) throw new Error("invalid review response");
      if (draftKey) cancelReviewReauthorization(draftKey);
      status.value = { kind: "ok", text: copy.saved };
      globalThis.location.reload();
    } catch {
      status.value = {
        kind: "error",
        text: reviewMutationFailureMessage(copy.error),
      };
    } finally {
      submitting.value = false;
    }
  };

  const remove = async () => {
    if (submitting.value) return;
    if (!globalThis.confirm("Delete this review? This can’t be undone.")) {
      return;
    }
    submitting.value = true;
    status.value = { kind: "idle" };
    try {
      const r = await fetch(
        deleteEndpoint ??
          `/api/registry/profile/${encodeURIComponent(targetId)}/reviews/me`,
        { method: "DELETE" },
      );
      const payload = await r.json().catch(() => null) as
        | { ok?: unknown; error?: string; reauthUrl?: string }
        | null;
      if (!r.ok) {
        const contextual = reauthorizationForFailure(r, payload);
        if (contextual) {
          if (!draftKey || !currentDid) throw new Error("missing draft owner");
          sessionStorage.setItem(
            draftKey,
            JSON.stringify({
              ownerDid: currentDid,
              rating: rating.value,
              body: body.value,
            }),
          );
          reauthorization.value = contextual;
          return;
        }
        throw new Error("review delete failed");
      }
      if (payload?.ok !== true) throw new Error("invalid review response");
      if (draftKey) cancelReviewReauthorization(draftKey);
      status.value = { kind: "ok", text: copy.deleted };
      globalThis.location.reload();
    } catch {
      status.value = {
        kind: "error",
        text: reviewMutationFailureMessage(copy.error),
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
            <a
              class="explore-cta-primary profile-review-write-button"
              href={loginHref}
              aria-haspopup="dialog"
              aria-expanded={authOpen.value ? "true" : "false"}
              onClick={(event) => {
                if (!isPlainLinkActivation(event)) return;
                event.preventDefault();
                authOpen.value = true;
              }}
            >
              <ContentVisualIcon
                name="pen"
                class="profile-review-write-icon"
              />
              {copy.heading}
            </a>
          )
          : isOwner
          ? <p class="text-body profile-review-owner-note">{copy.ownerNote}</p>
          : (
            <button
              type="button"
              class="explore-cta-primary profile-review-write-button"
              aria-haspopup="dialog"
              aria-expanded={open.value ? "true" : "false"}
              onClick={() => {
                open.value = true;
              }}
            >
              {!ownReview && (
                <ContentVisualIcon
                  name="pen"
                  class="profile-review-write-icon"
                />
              )}
              {ownReview ? copy.update : copy.heading}
            </button>
          )}
      </div>

      {open.value && signedIn && !isOwner && createPortal(
        <div
          class="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            class="modal-card"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogBodyId}
            tabIndex={-1}
          >
            <div class="modal-header">
              <h2 id={dialogTitleId} class="modal-title">
                {copy.heading}
              </h2>
              <p id={dialogBodyId} class="modal-body-text">
                {copy.modalBody}
              </p>
            </div>
            <fieldset
              class="profile-review-rating-field"
              role="radiogroup"
            >
              <legend>{copy.ratingLabel}</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  class={n <= rating.value
                    ? "profile-review-star is-active"
                    : "profile-review-star"}
                  role="radio"
                  aria-checked={n === rating.value}
                  aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
                  tabIndex={n === rating.value ? 0 : -1}
                  onClick={() => rating.value = n as 1 | 2 | 3 | 4 | 5}
                  onKeyDown={(event) => {
                    const delta = event.key === "ArrowRight" ||
                        event.key === "ArrowDown"
                      ? 1
                      : event.key === "ArrowLeft" || event.key === "ArrowUp"
                      ? -1
                      : 0;
                    if (!delta) return;
                    event.preventDefault();
                    const next = Math.min(5, Math.max(1, n + delta)) as
                      | 1
                      | 2
                      | 3
                      | 4
                      | 5;
                    rating.value = next;
                    const group = event.currentTarget.parentElement;
                    group?.querySelector<HTMLButtonElement>(
                      `[aria-label="${next} ${next === 1 ? "star" : "stars"}"]`,
                    )?.focus();
                  }}
                  key={n}
                >
                  ★
                </button>
              ))}
            </fieldset>
            <label class="profile-review-body-field">
              <span>{copy.bodyLabel}</span>
              <textarea
                maxLength={maxBody}
                value={body.value}
                placeholder={copy.bodyPlaceholder}
                onInput={(e) =>
                  body.value = (e.currentTarget as HTMLTextAreaElement).value}
              />
            </label>
            <p class="profile-review-char-count">
              {maxBody - body.value.length} {copy.charsRemainingSuffix}
            </p>
            <div class="profile-review-composer-actions">
              <button
                type="button"
                class="profile-form-button-link"
                onClick={close}
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
                role={status.value.kind === "error" ? "alert" : "status"}
              >
                {status.value.text}
              </p>
            )}
          </div>
        </div>,
        document.body,
      )}

      {authOpen.value && !signedIn && (
        <ContextualSignInDialog
          fallbackHref={loginHref}
          returnTo={returnTo}
          capabilities={authCapabilities}
          action={authAction}
          targetName={authTargetName}
          rememberedAccounts={rememberedAccounts}
          onClose={() => authOpen.value = false}
        />
      )}
      {reauthorization.value && signedIn && currentDid && currentHandle && (
        <ContextualReauthorizationDialog
          authorization={reauthorization.value}
          currentDid={currentDid}
          currentHandle={currentHandle}
          rememberedAccounts={rememberedAccounts}
          restrictToCurrentAccount
          onClose={() => {
            if (draftKey) cancelReviewReauthorization(draftKey);
            reauthorization.value = null;
          }}
        />
      )}
    </>
  );
}
