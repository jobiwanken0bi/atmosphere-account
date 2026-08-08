import { useSignal } from "@preact/signals";
import { createPortal } from "preact/compat";
import { useEffect, useId } from "preact/hooks";
import { useDialog } from "../lib/use-dialog.ts";
import ContextualSignInDialog from "./ContextualSignInDialog.tsx";
import { authActionCopy } from "../lib/oauth-action-copy.ts";
import {
  type ContextualReauthorization,
  contextualReauthorization,
  contextualReauthorizationFromApiPayload,
} from "../lib/reauth-required.ts";
import ContextualReauthorizationDialog from "./ContextualReauthorizationDialog.tsx";
import { isPlainLinkActivation } from "../lib/link-activation.ts";
import { oauthCancellationLocation } from "../lib/oauth-cancellation.ts";

interface Props {
  reviewId: number;
  signedIn: boolean;
  loginHref: string;
  returnTo: string;
  targetName: string;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  currentDid?: string;
  currentHandle?: string;
  copy: {
    button: string;
    modalTitle: string;
    modalBody: string;
    reasonLabel: string;
    detailsLabel: string;
    detailsPlaceholder: string;
    submit: string;
    submitting: string;
    cancel: string;
    done: string;
    sentTitle: string;
    sentBody: string;
    error: string;
    reasons: Record<"harmful" | "spam" | "off_topic" | "other", string>;
  };
}

export function reportReviewFailureMessage(
  friendlyMessage: string,
  _serverDetail?: unknown,
): string {
  return friendlyMessage;
}

export function reportReviewReauthorization(
  status: number,
  payload: unknown,
  returnTo: string,
  targetName: string,
): ContextualReauthorization | null {
  return contextualReauthorizationFromApiPayload(payload) ??
    (status === 401 ||
        (payload && typeof payload === "object" && !Array.isArray(payload) &&
          ["not_authenticated", "oauth_session_expired"].includes(
            String((payload as Record<string, unknown>).error ?? ""),
          ))
      ? contextualReauthorization({
        returnTo,
        action: "report_review",
        capabilities: ["identity"],
        targetName,
      })
      : null);
}

const REASONS: Array<keyof Props["copy"]["reasons"]> = [
  "harmful",
  "spam",
  "off_topic",
  "other",
];

const REPORT_DRAFT_PREFIX = "atmosphere:review-report-draft:";

export function reportReviewDraftKey(
  reviewId: number,
  ownerDid: string,
): string {
  return `${REPORT_DRAFT_PREFIX}${encodeURIComponent(ownerDid)}:${reviewId}`;
}

export function legacyReportReviewDraftKey(reviewId: number): string {
  return `${REPORT_DRAFT_PREFIX}${reviewId}`;
}

export function parseOwnedReportReviewDraft(
  value: string | null,
  ownerDid: string,
): { reason: keyof Props["copy"]["reasons"]; details: string } | null {
  if (!value) return null;
  try {
    const draft = JSON.parse(value) as Record<string, unknown>;
    if (
      draft.ownerDid !== ownerDid || typeof draft.reason !== "string" ||
      !REASONS.includes(draft.reason as keyof Props["copy"]["reasons"]) ||
      typeof draft.details !== "string"
    ) return null;
    return {
      reason: draft.reason as keyof Props["copy"]["reasons"],
      details: draft.details.slice(0, 500),
    };
  } catch {
    return null;
  }
}

export default function ReportReviewButton(
  {
    reviewId,
    signedIn,
    loginHref,
    returnTo,
    targetName,
    rememberedAccounts = [],
    currentDid,
    currentHandle,
    copy,
  }: Props,
) {
  const dialogId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const dialogTitleId = `report-review-title-${reviewId}-${dialogId}`;
  const dialogBodyId = `report-review-body-${reviewId}-${dialogId}`;
  const open = useSignal(false);
  const authOpen = useSignal(false);
  const authCopy = authActionCopy("report_review", targetName);
  const reason = useSignal<keyof Props["copy"]["reasons"]>("harmful");
  const details = useSignal("");
  const submitting = useSignal(false);
  const reauthorization = useSignal<ContextualReauthorization | null>(null);
  const status = useSignal<
    | { kind: "idle" }
    | { kind: "ok" }
    | { kind: "error"; text: string }
  >({ kind: "idle" });
  const draftKey = currentDid
    ? reportReviewDraftKey(reviewId, currentDid)
    : null;
  const oldDraftKey = legacyReportReviewDraftKey(reviewId);

  const clearDraft = () => {
    try {
      if (draftKey) sessionStorage.removeItem(draftKey);
      sessionStorage.removeItem(oldDraftKey);
    } catch {
      // Storage restrictions must not break dismissal or submission.
    }
  };

  const close = () => {
    clearDraft();
    open.value = false;
    reason.value = "harmful";
    details.value = "";
    status.value = { kind: "idle" };
  };

  const dialogRef = useDialog<HTMLDivElement>(open.value, close);

  useEffect(() => {
    if (!signedIn) return;
    // Discard the pre-account-binding key even when this particular report is
    // not being resumed; its author cannot be established safely.
    try {
      sessionStorage.removeItem(oldDraftKey);
    } catch {
      // Storage restrictions must not break the report dialog.
    }
    const cancellation = oauthCancellationLocation(
      globalThis.location.href,
      "report-draft",
      String(reviewId),
    );
    if (cancellation.wasCancelled) {
      globalThis.history.replaceState(null, "", cancellation.cleanLocation);
      clearDraft();
      return;
    }
    const url = new URL(globalThis.location.href);
    if (url.searchParams.get("report") !== String(reviewId)) return;
    url.searchParams.delete("report");
    globalThis.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    if (draftKey && currentDid) {
      let draft: ReturnType<typeof parseOwnedReportReviewDraft> = null;
      try {
        draft = parseOwnedReportReviewDraft(
          sessionStorage.getItem(draftKey),
          currentDid,
        );
      } catch {
        // Storage restrictions disable resume but must not break the dialog.
      }
      if (draft) {
        reason.value = draft.reason;
        details.value = draft.details;
      }
      clearDraft();
    }
    open.value = true;
  }, []);

  const submit = async () => {
    if (!signedIn) {
      status.value = { kind: "error", text: authCopy.signInBody };
      return;
    }
    submitting.value = true;
    try {
      const r = await fetch(
        `/api/registry/reviews/${encodeURIComponent(String(reviewId))}/report`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: reason.value,
            details: details.value.trim() || undefined,
          }),
        },
      );
      const payload = await r.json().catch(() => null);
      if (!r.ok) {
        const contextual = reportReviewReauthorization(
          r.status,
          payload,
          returnTo,
          targetName,
        );
        if (contextual) {
          if (!draftKey || !currentDid) throw new Error("missing draft owner");
          sessionStorage.setItem(
            draftKey,
            JSON.stringify({
              ownerDid: currentDid,
              reason: reason.value,
              details: details.value,
            }),
          );
          reauthorization.value = contextual;
          return;
        }
        throw new Error("report failed");
      }
      if (
        !payload || typeof payload !== "object" || Array.isArray(payload) ||
        (payload as Record<string, unknown>).ok !== true
      ) throw new Error("invalid report response");
      clearDraft();
      status.value = { kind: "ok" };
    } catch {
      status.value = {
        kind: "error",
        text: reportReviewFailureMessage(copy.error),
      };
    } finally {
      submitting.value = false;
    }
  };

  return (
    <>
      {signedIn
        ? (
          <button
            type="button"
            class="profile-report-button profile-review-report-button"
            aria-haspopup="dialog"
            aria-expanded={open.value ? "true" : "false"}
            onClick={() => open.value = true}
          >
            {copy.button}
          </button>
        )
        : (
          <a
            class="profile-report-button profile-review-report-button"
            href={loginHref}
            aria-haspopup="dialog"
            aria-expanded={authOpen.value ? "true" : "false"}
            onClick={(event) => {
              if (!isPlainLinkActivation(event)) return;
              event.preventDefault();
              authOpen.value = true;
            }}
          >
            {copy.button}
          </a>
        )}
      {authOpen.value && !signedIn && (
        <ContextualSignInDialog
          fallbackHref={loginHref}
          returnTo={returnTo}
          capabilities={["identity"]}
          action="report_review"
          targetName={targetName}
          rememberedAccounts={rememberedAccounts}
          closeLabel={copy.cancel}
          onClose={() => authOpen.value = false}
        />
      )}
      {open.value && createPortal(
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
              <h2
                id={dialogTitleId}
                class="modal-title"
              >
                {copy.modalTitle}
              </h2>
              <p id={dialogBodyId} class="modal-body-text">
                {signedIn ? copy.modalBody : authCopy.signInBody}
              </p>
            </div>
            {status.value.kind === "ok"
              ? (
                <>
                  <p
                    class="report-modal-status report-modal-status--ok"
                    role="status"
                  >
                    <strong>{copy.sentTitle}</strong>
                  </p>
                  <p class="modal-body-text">{copy.sentBody}</p>
                  <div
                    class="report-modal-actions"
                    style={{ marginTop: "1rem" }}
                  >
                    <button
                      type="button"
                      class="profile-form-button-primary"
                      onClick={close}
                    >
                      {copy.done}
                    </button>
                  </div>
                </>
              )
              : (
                <>
                  <fieldset class="report-modal-fieldset">
                    <legend>{copy.reasonLabel}</legend>
                    {REASONS.map((r) => (
                      <label key={r} class="report-modal-radio">
                        <input
                          type="radio"
                          name={`review-report-reason-${reviewId}`}
                          value={r}
                          checked={reason.value === r}
                          onChange={() =>
                            reason.value = r}
                        />
                        {copy.reasons[r]}
                      </label>
                    ))}
                  </fieldset>
                  <label
                    class="report-modal-radio"
                    style={{ display: "block" }}
                  >
                    <span style={{ display: "block", marginBottom: "0.4rem" }}>
                      {copy.detailsLabel}
                    </span>
                    <textarea
                      class="report-modal-textarea"
                      maxLength={500}
                      placeholder={copy.detailsPlaceholder}
                      value={details.value}
                      onInput={(e) =>
                        details.value =
                          (e.currentTarget as HTMLTextAreaElement).value}
                    />
                  </label>
                  {status.value.kind === "error" && (
                    <p
                      class="report-modal-status report-modal-status--error"
                      role="alert"
                    >
                      {status.value.text}
                    </p>
                  )}
                  <div
                    class="report-modal-actions"
                    style={{ marginTop: "1rem" }}
                  >
                    <button
                      type="button"
                      class="profile-form-button-link"
                      onClick={close}
                      disabled={submitting.value}
                    >
                      {copy.cancel}
                    </button>
                    <button
                      type="button"
                      class="profile-form-button-primary"
                      onClick={submit}
                      disabled={submitting.value || !signedIn}
                    >
                      {submitting.value ? copy.submitting : copy.submit}
                    </button>
                  </div>
                </>
              )}
          </div>
        </div>,
        document.body,
      )}
      {reauthorization.value && signedIn && currentDid && currentHandle && (
        <ContextualReauthorizationDialog
          authorization={reauthorization.value}
          currentDid={currentDid}
          currentHandle={currentHandle}
          rememberedAccounts={rememberedAccounts}
          closeLabel={copy.cancel}
          restrictToCurrentAccount
          onClose={() => {
            clearDraft();
            reauthorization.value = null;
          }}
        />
      )}
    </>
  );
}
