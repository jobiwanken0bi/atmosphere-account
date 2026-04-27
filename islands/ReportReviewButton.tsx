import { useSignal } from "@preact/signals";

interface Props {
  reviewId: number;
  signedIn: boolean;
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
    sentTitle: string;
    sentBody: string;
    signInRequired: string;
    error: string;
    reasons: Record<"harmful" | "spam" | "off_topic" | "other", string>;
  };
}

const REASONS: Array<keyof Props["copy"]["reasons"]> = [
  "harmful",
  "spam",
  "off_topic",
  "other",
];

export default function ReportReviewButton(
  { reviewId, signedIn, copy }: Props,
) {
  const open = useSignal(false);
  const reason = useSignal<keyof Props["copy"]["reasons"]>("harmful");
  const details = useSignal("");
  const submitting = useSignal(false);
  const status = useSignal<
    | { kind: "idle" }
    | { kind: "ok" }
    | { kind: "error"; text: string }
  >({ kind: "idle" });

  const close = () => {
    open.value = false;
    reason.value = "harmful";
    details.value = "";
    status.value = { kind: "idle" };
  };

  const submit = async () => {
    if (!signedIn) {
      status.value = { kind: "error", text: copy.signInRequired };
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
      if (!r.ok) throw new Error(await r.text());
      status.value = { kind: "ok" };
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
      <button
        type="button"
        class="profile-report-button profile-review-report-button"
        onClick={() => open.value = true}
      >
        {copy.button}
      </button>
      {open.value && (
        <div
          class="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div class="modal-card">
            <div class="modal-header">
              <p class="modal-title">{copy.modalTitle}</p>
              <p class="modal-body-text">
                {signedIn ? copy.modalBody : copy.signInRequired}
              </p>
            </div>
            {status.value.kind === "ok"
              ? (
                <>
                  <p class="report-modal-status report-modal-status--ok">
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
                      {copy.cancel}
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
                    <p class="report-modal-status report-modal-status--error">
                      {copy.error}: {status.value.text}
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
        </div>
      )}
    </>
  );
}
