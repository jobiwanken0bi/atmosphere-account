import { useSignal } from "@preact/signals";
import { useT } from "../i18n/mod.ts";

interface Props {
  /** Optional path to redirect to after successful login (defaults to /explore/manage) */
  returnTo?: string;
}

export default function SignInForm({ returnTo: _returnTo }: Props) {
  const t = useT();
  const handle = useSignal("");
  const submitting = useSignal(false);
  const error = useSignal<string | null>(null);

  const onSubmit = (event: Event) => {
    event.preventDefault();
    if (!handle.value.trim()) return;
    submitting.value = true;
    error.value = null;
    const form = event.currentTarget as HTMLFormElement;
    form.submit();
  };

  return (
    <form
      method="POST"
      action="/oauth/login"
      onSubmit={onSubmit}
      class="signin-form"
    >
      <label class="signin-form-label" for="signin-handle">
        {t.explore.create.handlePlaceholder}
      </label>
      <div class="signin-form-row">
        <input
          id="signin-handle"
          name="handle"
          type="text"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellcheck={false}
          required
          placeholder={t.explore.create.handlePlaceholder}
          value={handle.value}
          onInput={(e) =>
            handle.value = (e.currentTarget as HTMLInputElement).value}
          class="signin-form-input"
        />
        <button
          type="submit"
          class="signin-form-submit"
          disabled={submitting.value}
        >
          {submitting.value ? "…" : t.explore.create.signIn}
        </button>
      </div>
      {error.value && <p class="signin-form-error">{error.value}</p>}
      <p class="signin-form-hint">{t.explore.create.whyHandle}</p>
    </form>
  );
}
