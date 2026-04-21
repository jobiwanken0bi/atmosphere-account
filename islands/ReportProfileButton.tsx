import { useSignal } from "@preact/signals";

interface Props {
  /** Handle or DID of the profile being reported. The API accepts both. */
  targetId: string;
  /** Whether the viewer is signed in (controls the modal copy). */
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

/**
 * Mounted on /explore/<handle>. Opens a modal where any visitor can
 * submit a moderation report against the profile. Stays in island form
 * because the modal + submission state needs interactivity, but the
 * trigger is a single small button so the JS payload is minimal.
 */
export default function ReportProfileButton({ targetId, copy }: Props) {
  const open = useSignal(false);
  const reason = useSignal<keyof Props["copy"]["reasons"]>("not_a_project");
  const details = useSignal("");
  const submitting = useSignal(false);
  const status = useSignal<
    | { kind: "idle" }
    | { kind: "ok" }
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
        const text = await r.text();
        status.value = { kind: "error", text: text || copy.error };
        return;
      }
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
              <p class="modal-body-text">{copy.modalBody}</p>
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
                          name="report-reason"
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
                      disabled={submitting.value}
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
