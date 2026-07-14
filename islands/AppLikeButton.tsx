import { useSignal } from "@preact/signals";
import ContentVisualIcon from "../components/icons/ContentVisualIcon.tsx";

interface AppLikeCopy {
  like: string;
  unlike: string;
  signIn: string;
  error: string;
  countOne: string;
  countMany: string;
}

interface Props {
  identifier: string;
  signedIn: boolean;
  isOwner: boolean;
  loginHref: string;
  reauthHref: string;
  initiallyLiked: boolean;
  count: number;
  copy: AppLikeCopy;
}

interface AppLikeErrorBody {
  error?: string;
  reauthUrl?: string;
}

export function appLikeEndpoint(identifier: string): string {
  return `/api/apps/${encodeURIComponent(identifier)}/favorite`;
}

export function appLikeReauthHref(handle: string, next: string): string {
  const params = new URLSearchParams({ handle, next });
  return `/oauth/login?${params.toString()}`;
}

export function appLikeCountLabel(
  count: number,
  copy: Pick<AppLikeCopy, "countOne" | "countMany">,
): string {
  return (count === 1 ? copy.countOne : copy.countMany).replace(
    "{count}",
    count.toLocaleString(),
  );
}

export default function AppLikeButton(
  {
    identifier,
    signedIn,
    isOwner,
    loginHref,
    reauthHref,
    initiallyLiked,
    count,
    copy,
  }: Props,
) {
  const busy = useSignal(false);
  const liked = useSignal(initiallyLiked);
  const likeCount = useSignal(count);
  const error = useSignal("");

  if (isOwner) return null;

  if (!signedIn) {
    return (
      <a
        class="profile-form-button-secondary app-like-button"
        href={loginHref}
        aria-label={`${copy.signIn}. ${
          appLikeCountLabel(likeCount.value, copy)
        }`}
      >
        <ContentVisualIcon name="like" class="app-like-icon" />
        <span class="app-like-count" aria-hidden="true">
          {likeCount.value.toLocaleString()}
        </span>
      </a>
    );
  }

  const submit = async () => {
    if (busy.value) return;
    const previousLiked = liked.value;
    const previousCount = likeCount.value;
    const nextLiked = !previousLiked;
    busy.value = true;
    error.value = "";
    liked.value = nextLiked;
    likeCount.value = Math.max(0, previousCount + (nextLiked ? 1 : -1));
    try {
      const res = await fetch(appLikeEndpoint(identifier), {
        method: nextLiked ? "POST" : "DELETE",
      });
      const body = await res.json().catch(() => null) as
        | AppLikeErrorBody
        | null;
      if (!res.ok) {
        if (
          res.status === 401 || body?.error === "reauth_required" ||
          body?.error === "oauth_session_expired"
        ) {
          globalThis.location.assign(body?.reauthUrl || reauthHref);
          return;
        }
        throw new Error(copy.error);
      }
    } catch {
      liked.value = previousLiked;
      likeCount.value = previousCount;
      error.value = copy.error;
    } finally {
      busy.value = false;
    }
  };

  return (
    <div class="app-like-control">
      <button
        type="button"
        class={`profile-form-button-secondary app-like-button${
          liked.value ? " is-liked" : ""
        }`}
        onClick={submit}
        disabled={busy.value}
        aria-pressed={liked.value}
        aria-label={`${liked.value ? copy.unlike : copy.like}. ${
          appLikeCountLabel(likeCount.value, copy)
        }`}
      >
        <ContentVisualIcon name="like" class="app-like-icon" />
        <span class="app-like-count" aria-hidden="true">
          {likeCount.value.toLocaleString()}
        </span>
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
