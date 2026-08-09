import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import type { ReviewRow } from "../lib/reviews.ts";
import { useDialog } from "../lib/use-dialog.ts";
import { reauthUrlFromApiPayload } from "../lib/reauth-required.ts";
import type { OAuthCapability } from "../lib/oauth-scopes.ts";
import type { OAuthAction } from "../lib/oauth-action.ts";
import {
  isPlainPrimaryActivation,
  LoginWithAtmosphereDialog,
} from "./ContextualSignInLink.tsx";

interface Props {
  targetId: string;
  signedIn: boolean;
  isOwner: boolean;
  loginHref: string;
  returnTo: string;
  authCapabilities: readonly OAuthCapability[];
  authAction: OAuthAction;
  authTargetName: string;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  ownReview: Pick<ReviewRow, "id" | "rating" | "body"> | null;
  submitEndpoint?: string;
  deleteEndpoint?: string;
  maxBodyLength?: number;
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
    signInTitle: string;
    signInBody: string;
    cancel: string;
    saved: string;
    deleted: string;
    error: string;
  };
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
    ownReview,
    submitEndpoint,
    deleteEndpoint,
    maxBodyLength,
    copy,
  }: Props,
) {
  const maxBody = maxBodyLength ?? MAX_BODY;
  const rating = useSignal<1 | 2 | 3 | 4 | 5>(ownReview?.rating ?? 5);
  const body = useSignal(ownReview?.body ?? "");
  const open = useSignal(false);
  const authOpen = useSignal(false);
  const submitting = useSignal(false);
  const status = useSignal<
    | { kind: "idle" }
    | { kind: "ok"; text: string }
    | { kind: "error"; text: string }
  >({ kind: "idle" });
  const draftKey = `atmosphere:review-draft:${targetId}`;

  useEffect(() => {
    const saved = sessionStorage.getItem(draftKey);
    if (saved) {
      try {
        const draft = JSON.parse(saved) as { rating?: number; body?: string };
        if (draft.rating && draft.rating >= 1 && draft.rating <= 5) {
          rating.value = draft.rating as 1 | 2 | 3 | 4 | 5;
        }
        if (typeof draft.body === "string") body.value = draft.body;
      } catch {
        sessionStorage.removeItem(draftKey);
      }
    }
    const url = new URL(globalThis.location.href);
    if (
      url.searchParams.get("review") === "compose" && signedIn && !isOwner
    ) {
      open.value = true;
      url.searchParams.delete("review");
      globalThis.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }, []);

  const close = () => {
    open.value = false;
  };

  const dialogRef = useDialog<HTMLDivElement>(
    open.value && signedIn && !isOwner,
    close,
  );
  const authDialogRef = useDialog<HTMLDivElement>(
    authOpen.value && !signedIn,
    () => authOpen.value = false,
  );

  const submit = async () => {
    submitting.value = true;
    status.value = { kind: "idle" };
    try {
      const r = await fetch(
        submitEndpoint ??
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
      if (!r.ok) {
        const payload = await r.json().catch(() => null) as
          | { error?: string; detail?: string; reauthUrl?: string }
          | null;
        if (payload?.error === "reauth_required") {
          const reauthUrl = reauthUrlFromApiPayload(payload);
          if (reauthUrl) {
            sessionStorage.setItem(
              draftKey,
              JSON.stringify({
                rating: rating.value,
                body: body.value,
              }),
            );
            globalThis.location.assign(reauthUrl);
            return;
          }
        }
        throw new Error(payload?.detail || copy.error);
      }
      sessionStorage.removeItem(draftKey);
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
        deleteEndpoint ??
          `/api/registry/profile/${encodeURIComponent(targetId)}/reviews/me`,
        { method: "DELETE" },
      );
      if (!r.ok) {
        const payload = await r.json().catch(() => null) as
          | { error?: string; detail?: string; reauthUrl?: string }
          | null;
        if (payload?.error === "reauth_required") {
          const reauthUrl = reauthUrlFromApiPayload(payload);
          if (reauthUrl) {
            globalThis.location.assign(reauthUrl);
            return;
          }
        }
        throw new Error(payload?.detail || copy.error);
      }
      sessionStorage.removeItem(draftKey);
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
              <a
                class="explore-cta-primary"
                href={loginHref}
                aria-haspopup="dialog"
                onClick={(event) => {
                  if (!isPlainPrimaryActivation(event)) return;
                  event.preventDefault();
                  authOpen.value = true;
                }}
              >
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
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            class="modal-card"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-review-title"
            tabIndex={-1}
          >
            <div class="modal-header">
              <h2 id="profile-review-title" class="modal-title">
                {copy.heading}
              </h2>
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

      {authOpen.value && !signedIn && createPortal(
        <div
          class="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) authOpen.value = false;
          }}
        >
          <LoginWithAtmosphereDialog
            id="review-signin-title"
            body={copy.signInBody}
            onClose={() => authOpen.value = false}
            dialogRef={authDialogRef}
            returnTo={returnTo}
            capabilities={authCapabilities}
            action={authAction}
            targetName={authTargetName}
            rememberedAccounts={rememberedAccounts}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
