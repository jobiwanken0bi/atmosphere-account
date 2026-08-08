import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import {
  type ContextualReauthorization,
  contextualReauthorization,
  contextualReauthorizationFromApiPayload,
} from "../lib/reauth-required.ts";
import {
  reviewResponseResumeLocation,
  reviewResponseReturnPath,
} from "../lib/app-interaction-reauth.ts";
import { oauthCancellationLocation } from "../lib/oauth-cancellation.ts";
import {
  isValidOauthResumeProof,
  oauthResumeProofValue,
} from "../lib/oauth-resume-proof.ts";
import ContextualReauthorizationDialog from "./ContextualReauthorizationDialog.tsx";

interface Props {
  reviewId: number;
  initialBody: string;
  returnTo: string;
  targetName: string;
  currentDid: string;
  currentHandle: string;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  copy: {
    button: string;
    updateButton: string;
    deleteButton: string;
    confirmDelete: string;
    bodyLabel: string;
    placeholder: string;
    submit: string;
    submitting: string;
    cancel: string;
    error: string;
  };
}

const MAX_RESPONSE = 500;
const REVIEW_RESPONSE_DRAFT_PREFIX = "atmosphere:review-response-draft:";

export function reviewResponseDraftKey(
  reviewId: number,
  ownerDid: string,
): string {
  return `${REVIEW_RESPONSE_DRAFT_PREFIX}${encodeURIComponent(ownerDid)}:${
    encodeURIComponent(String(reviewId))
  }`;
}

export function legacyReviewResponseDraftKey(reviewId: number): string {
  return `${REVIEW_RESPONSE_DRAFT_PREFIX}${reviewId}`;
}

export function reviewResponseResumeProofKey(
  reviewId: number,
  ownerDid: string,
): string {
  return `atmosphere:oauth-resume-proof:review-response:${
    encodeURIComponent(reviewResponseDraftKey(reviewId, ownerDid))
  }`;
}

export function parseOwnedReviewResponseDraft(
  value: string | null,
  ownerDid: string,
): string | null {
  if (!value) return null;
  try {
    const draft = JSON.parse(value) as Record<string, unknown>;
    return draft.ownerDid === ownerDid && typeof draft.body === "string"
      ? draft.body.slice(0, MAX_RESPONSE)
      : null;
  } catch {
    return null;
  }
}

export function clearReviewResponseDraft(
  reviewId: number,
  ownerDid: string,
  storage: Pick<Storage, "removeItem"> = globalThis.sessionStorage,
): void {
  try {
    storage.removeItem(reviewResponseDraftKey(reviewId, ownerDid));
    storage.removeItem(reviewResponseResumeProofKey(reviewId, ownerDid));
    // Old drafts were not attributable to an account and must never be
    // restored after a switch.
    storage.removeItem(legacyReviewResponseDraftKey(reviewId));
  } catch {
    // Storage restrictions must not break the composer or deletion flow.
  }
}

export function confirmReviewResponseDelete(
  message: string,
  confirmAction: (message: string) => boolean = globalThis.confirm,
): boolean {
  return confirmAction(message);
}

export function reviewResponseReauthorization(
  status: number,
  payload: unknown,
  returnTo: string,
  reviewId: number,
  targetName: string,
): ContextualReauthorization | null {
  return contextualReauthorizationFromApiPayload(payload) ??
    (status === 401 ||
        (payload && typeof payload === "object" && !Array.isArray(payload) &&
          ["not_authenticated", "oauth_session_expired"].includes(
            String((payload as Record<string, unknown>).error ?? ""),
          ))
      ? contextualReauthorization({
        returnTo: reviewResponseReturnPath(returnTo, reviewId),
        action: "review_response",
        capabilities: ["identity"],
        targetName,
      })
      : null);
}

export default function ReviewResponseComposer(
  {
    reviewId,
    initialBody,
    returnTo,
    targetName,
    currentDid,
    currentHandle,
    rememberedAccounts = [],
    copy,
  }: Props,
) {
  const open = useSignal(false);
  const body = useSignal(initialBody);
  const submitting = useSignal(false);
  const error = useSignal<string | null>(null);
  const reauthorization = useSignal<ContextualReauthorization | null>(null);
  const draftKey = reviewResponseDraftKey(reviewId, currentDid);
  const resumeProofKey = reviewResponseResumeProofKey(reviewId, currentDid);
  const oldDraftKey = legacyReviewResponseDraftKey(reviewId);

  useEffect(() => {
    // Legacy plaintext drafts had no account owner. Never retain or restore
    // them after this safer format is available.
    try {
      sessionStorage.removeItem(oldDraftKey);
    } catch {
      // Storage restrictions must not break the composer.
    }
    const cancellation = oauthCancellationLocation(
      globalThis.location.href,
      "review-response",
      String(reviewId),
    );
    if (cancellation.wasCancelled) {
      globalThis.history.replaceState(null, "", cancellation.cleanLocation);
      clearReviewResponseDraft(reviewId, currentDid);
      return;
    }

    const resume = reviewResponseResumeLocation(
      globalThis.location.href,
      reviewId,
    );
    if (resume.hadMarker) {
      globalThis.history.replaceState(null, "", resume.cleanLocation);
    }
    let proof: string | null = null;
    try {
      proof = sessionStorage.getItem(resumeProofKey);
      sessionStorage.removeItem(resumeProofKey);
    } catch {
      // Fail closed: a return marker without same-tab proof restores nothing.
    }
    if (
      !resume.shouldResume ||
      !isValidOauthResumeProof(proof, currentDid, draftKey)
    ) {
      // This also removes a draft left by an abandoned authorization when the
      // owner later returns through an ordinary navigation.
      clearReviewResponseDraft(reviewId, currentDid);
      return;
    }
    let saved: string | null = null;
    try {
      saved = parseOwnedReviewResponseDraft(
        sessionStorage.getItem(draftKey),
        currentDid,
      );
    } catch {
      // Storage restrictions disable resume but must not break the composer.
    }
    clearReviewResponseDraft(reviewId, currentDid);
    if (saved !== null) {
      body.value = saved;
      open.value = true;
    }
  }, []);

  const authorizationFor = async (
    response: Response,
  ): Promise<ContextualReauthorization | null> => {
    const payload = response.headers.get("content-type")?.includes(
        "application/json",
      )
      ? await response.clone().json().catch(() => null)
      : null;
    return reviewResponseReauthorization(
      response.status,
      payload,
      returnTo,
      reviewId,
      targetName,
    );
  };

  const requestAuthorization = (
    authorization: ContextualReauthorization,
  ) => {
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ ownerDid: currentDid, body: body.value }),
      );
    } catch {
      error.value = copy.error;
      return;
    }
    reauthorization.value = authorization;
  };

  const close = () => {
    clearReviewResponseDraft(reviewId, currentDid);
    open.value = false;
  };

  const save = async () => {
    submitting.value = true;
    error.value = null;
    try {
      const r = await fetch(
        `/api/registry/reviews/${
          encodeURIComponent(String(reviewId))
        }/response`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: body.value.trim() }),
        },
      );
      if (!r.ok) {
        const authorization = await authorizationFor(r);
        if (authorization) {
          requestAuthorization(authorization);
          return;
        }
        throw new Error(copy.error);
      }
      const payload = await r.json().catch(() => null) as
        | { ok?: unknown }
        | null;
      if (payload?.ok !== true) throw new Error(copy.error);
      clearReviewResponseDraft(reviewId, currentDid);
      globalThis.location.reload();
    } catch {
      error.value = copy.error;
    } finally {
      submitting.value = false;
    }
  };

  const remove = async () => {
    if (!confirmReviewResponseDelete(copy.confirmDelete)) return;
    submitting.value = true;
    error.value = null;
    try {
      const r = await fetch(
        `/api/registry/reviews/${
          encodeURIComponent(String(reviewId))
        }/response`,
        { method: "DELETE" },
      );
      if (!r.ok) {
        const authorization = await authorizationFor(r);
        if (authorization) {
          requestAuthorization(authorization);
          return;
        }
        throw new Error(copy.error);
      }
      const payload = await r.json().catch(() => null) as
        | { ok?: unknown }
        | null;
      if (payload?.ok !== true) throw new Error(copy.error);
      clearReviewResponseDraft(reviewId, currentDid);
      globalThis.location.reload();
    } catch {
      error.value = copy.error;
    } finally {
      submitting.value = false;
    }
  };

  if (!open.value) {
    return (
      <button
        type="button"
        class="profile-form-button-secondary profile-review-response-toggle"
        onClick={() => open.value = true}
      >
        {initialBody ? copy.updateButton : copy.button}
      </button>
    );
  }

  return (
    <div class="profile-review-response-composer">
      <label class="profile-review-body-field">
        <span>{copy.bodyLabel}</span>
        <textarea
          maxLength={MAX_RESPONSE}
          placeholder={copy.placeholder}
          value={body.value}
          onInput={(e) =>
            body.value = (e.currentTarget as HTMLTextAreaElement).value}
        />
      </label>
      <div class="profile-review-composer-actions">
        <button
          type="button"
          class="profile-form-button-link"
          onClick={close}
          disabled={submitting.value}
        >
          {copy.cancel}
        </button>
        {initialBody && (
          <button
            type="button"
            class="profile-form-button-danger"
            onClick={remove}
            disabled={submitting.value}
          >
            {copy.deleteButton}
          </button>
        )}
        <button
          type="button"
          class="profile-form-button-primary"
          onClick={save}
          disabled={submitting.value || body.value.trim().length === 0}
        >
          {submitting.value ? copy.submitting : copy.submit}
        </button>
      </div>
      {error.value && (
        <p class="report-modal-status report-modal-status--error" role="alert">
          {error.value}
        </p>
      )}
      {reauthorization.value && (
        <ContextualReauthorizationDialog
          authorization={reauthorization.value}
          currentDid={currentDid}
          currentHandle={currentHandle}
          rememberedAccounts={rememberedAccounts}
          restrictToCurrentAccount
          closeLabel={copy.cancel}
          onAuthorizationStart={() => {
            armReviewResponseResume(
              resumeProofKey,
              currentDid,
              draftKey,
            );
          }}
          onClose={() => {
            clearReviewResponseDraft(reviewId, currentDid);
            reauthorization.value = null;
          }}
        />
      )}
    </div>
  );
}

export function armReviewResponseResume(
  proofKey: string,
  ownerDid: string,
  draftKey: string,
  storage: Pick<Storage, "setItem"> = globalThis.sessionStorage,
): boolean {
  try {
    storage.setItem(
      proofKey,
      oauthResumeProofValue(ownerDid, draftKey),
    );
    return true;
  } catch {
    return false;
  }
}
