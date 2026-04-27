import { useSignal } from "@preact/signals";

interface Props {
  reviewId: number;
  initialBody: string;
  copy: {
    button: string;
    updateButton: string;
    deleteButton: string;
    placeholder: string;
    submit: string;
    submitting: string;
    cancel: string;
    error: string;
  };
}

const MAX_RESPONSE = 500;

export default function ReviewResponseComposer(
  { reviewId, initialBody, copy }: Props,
) {
  const open = useSignal(false);
  const body = useSignal(initialBody);
  const submitting = useSignal(false);
  const error = useSignal<string | null>(null);

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
      if (!r.ok) throw new Error(await r.text());
      globalThis.location.reload();
    } catch (err) {
      error.value = err instanceof Error ? err.message : copy.error;
    } finally {
      submitting.value = false;
    }
  };

  const remove = async () => {
    submitting.value = true;
    error.value = null;
    try {
      const r = await fetch(
        `/api/registry/reviews/${
          encodeURIComponent(String(reviewId))
        }/response`,
        { method: "DELETE" },
      );
      if (!r.ok) throw new Error(await r.text());
      globalThis.location.reload();
    } catch (err) {
      error.value = err instanceof Error ? err.message : copy.error;
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
      <textarea
        maxLength={MAX_RESPONSE}
        placeholder={copy.placeholder}
        value={body.value}
        onInput={(e) =>
          body.value = (e.currentTarget as HTMLTextAreaElement).value}
      />
      <div class="profile-review-composer-actions">
        <button
          type="button"
          class="profile-form-button-link"
          onClick={() => open.value = false}
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
        <p class="report-modal-status report-modal-status--error">
          {copy.error}: {error.value}
        </p>
      )}
    </div>
  );
}
