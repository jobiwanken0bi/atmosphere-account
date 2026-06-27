import { useSignal } from "@preact/signals";

interface Props {
  identifier: string;
  signedIn: boolean;
  isOwner: boolean;
  loginHref: string;
  initiallyFavorited: boolean;
  count: number;
}

export default function AppFavoriteButton(
  { identifier, signedIn, isOwner, loginHref, initiallyFavorited, count }:
    Props,
) {
  const busy = useSignal(false);
  const favorited = useSignal(initiallyFavorited);
  const error = useSignal("");

  if (!signedIn) {
    return (
      <a
        class="profile-form-button-secondary app-favorite-button"
        href={loginHref}
      >
        Save
      </a>
    );
  }
  if (isOwner) return null;

  const submit = async () => {
    busy.value = true;
    error.value = "";
    try {
      const res = await fetch(
        `/api/apps/${encodeURIComponent(identifier)}/favorite`,
        { method: favorited.value ? "DELETE" : "POST" },
      );
      if (!res.ok) throw new Error(await res.text());
      favorited.value = !favorited.value;
      globalThis.location.reload();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Could not save";
    } finally {
      busy.value = false;
    }
  };

  return (
    <div class="app-favorite-control">
      <button
        type="button"
        class="profile-form-button-secondary app-favorite-button"
        onClick={submit}
        disabled={busy.value}
        aria-pressed={favorited.value}
      >
        {favorited.value ? "Saved" : "Save"}
        {count > 0 && <span>{count}</span>}
      </button>
      {error.value && (
        <p class="report-modal-status report-modal-status--error">
          {error.value}
        </p>
      )}
    </div>
  );
}
