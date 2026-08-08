import { useSignal } from "@preact/signals";
import { createPortal } from "preact/compat";
import { useId } from "preact/hooks";
import { useDialog } from "../lib/use-dialog.ts";

interface Props {
  /** Handle or DID of the profile being reported. The API accepts both. */
  targetId: string;
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
    duplicate: string;
    error: string;
    reasons: Record<
      "not_a_project" | "harmful" | "impersonation" | "spam" | "other",
      string
    >;
  };
}

const REASONS: Array<keyof Props["copy"]["reasons"]> = [
  "not_a_project",
  "harmful",
  "impersonation",
  "spam",
  "other",
];

/** Public report failures must never surface API codes, proxy HTML, or other
 * implementation detail in the non-technical profile UI. */
export function reportProfileFailureMessage(friendlyMessage: string): string {
  return friendlyMessage;
}

export function reportProfileSubmissionResult(
  payload: unknown,
): "ok" | "duplicate" | "error" {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "error";
  }
  const result = payload as Record<string, unknown>;
  if (result.ok !== true) return "error";
  return result.deduped === true ? "duplicate" : "ok";
}

/**
 * Mounted on /explore/<handle>. Opens a modal where any visitor can
 * submit a moderation report against the profile. Stays in island form
 * because the modal + submission state needs interactivity, but the
 * trigger is a single small button so the JS payload is minimal.
 */
export default function ReportProfileButton({ targetId, copy }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const dialogTitleId = `report-profile-title-${id}`;
  const dialogBodyId = `report-profile-body-${id}`;
  const reasonName = `report-profile-reason-${id}`;
  const open = useSignal(false);
  const reason = useSignal<keyof Props["copy"]["reasons"]>("not_a_project");
  const details = useSignal("");
  const submitting = useSignal(false);
  const status = useSignal<
    | { kind: "idle" }
    | { kind: "ok" }
    | { kind: "duplicate" }
    | { kind: "error"; text: string }
  >({ kind: "idle" });

  const reset = () => {
    reason.value = "not_a_project";
    details.value = "";
    status.value = { kind: "idle" };
  };

  const close = () => {
    open.value = false;
    reset();
  };

  const dialogRef = useDialog<HTMLDivElement>(open.value, close);

  const submit = async () => {
    submitting.value = true;
    try {
      const r = await fetch(
        `/api/registry/profile/${encodeURIComponent(targetId)}/report`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: reason.value,
            details: details.value.trim() || undefined,
          }),
        },
      );
      if (!r.ok) {
        // Consume the body so the connection can be reused, but do not show
        // untrusted server text in this public, non-technical UI.
        await r.text().catch(() => "");
        status.value = {
          kind: "error",
          text: reportProfileFailureMessage(copy.error),
        };
        return;
      }
      const payload = await r.json().catch(() => null);
      const result = reportProfileSubmissionResult(payload);
      status.value = result === "error"
        ? {
          kind: "error",
          text: reportProfileFailureMessage(copy.error),
        }
        : { kind: result };
    } catch {
      status.value = {
        kind: "error",
        text: reportProfileFailureMessage(copy.error),
      };
    } finally {
      submitting.value = false;
    }
  };

  return (
    <>
      <div class="profile-report-row">
        <button
          type="button"
          class="profile-report-button"
          onClick={() => {
            open.value = true;
          }}
        >
          {copy.button}
        </button>
      </div>

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
              <h2 id={dialogTitleId} class="modal-title">
                {copy.modalTitle}
              </h2>
              <p id={dialogBodyId} class="modal-body-text">{copy.modalBody}</p>
            </div>

            {status.value.kind === "ok" || status.value.kind === "duplicate"
              ? (
                <>
                  <p
                    class="report-modal-status report-modal-status--ok"
                    role="status"
                  >
                    <strong>
                      {status.value.kind === "duplicate"
                        ? copy.duplicate
                        : copy.sentTitle}
                    </strong>
                  </p>
                  {status.value.kind === "ok" && (
                    <p class="modal-body-text">{copy.sentBody}</p>
                  )}
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
                          name={reasonName}
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
                      disabled={submitting.value}
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
    </>
  );
}
