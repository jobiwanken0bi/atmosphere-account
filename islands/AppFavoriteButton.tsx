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
  const saveCount = useSignal(count);
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
      // Update in place instead of a full reload — keeps scroll position and
      // any in-progress review draft, and reflects the new state instantly.
      const nowFavorited = !favorited.value;
      favorited.value = nowFavorited;
      saveCount.value = Math.max(0, saveCount.value + (nowFavorited ? 1 : -1));
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
        {saveCount.value > 0 && (
          <span
            aria-label={`${saveCount.value} ${
              saveCount.value === 1 ? "save" : "saves"
            }`}
          >
            {saveCount.value}
          </span>
        )}
      </button>
      {error.value && (
        <p
          class="report-modal-status report-modal-status--error"
          role="alert"
        >
          {error.value}
        </p>
      )}
    </div>
  );
}
