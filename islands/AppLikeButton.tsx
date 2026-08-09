import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import ContentVisualIcon from "../components/icons/ContentVisualIcon.tsx";
import { createPortal } from "preact/compat";
import { useDialog } from "../lib/use-dialog.ts";
import { reauthUrlFromApiPayload } from "../lib/reauth-required.ts";
import { oauthLoginUrl } from "../lib/oauth-action.ts";
import {
  isPlainPrimaryActivation,
  LoginWithAtmosphereDialog,
} from "./ContextualSignInLink.tsx";
import {
  type FavoriteMutationIntent,
  favoriteRequestMethod,
  favoriteResumeIntent,
  favoriteTargetLiked,
} from "../lib/favorite-resume.ts";

interface AppLikeCopy {
  like: string;
  unlike: string;
  signIn: string;
  signInTitle: string;
  signInBody: string;
  cancel: string;
  error: string;
  countOne: string;
  countMany: string;
}

interface Props {
  identifier: string;
  signedIn: boolean;
  isOwner: boolean;
  loginHref: string;
  reauthSaveHref: string;
  reauthRemoveHref: string;
  returnTo: string;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  targetName: string;
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
  return oauthLoginUrl({
    handle,
    next,
    action: "favorite",
    capabilities: ["favorite"],
  });
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
    reauthSaveHref,
    reauthRemoveHref,
    returnTo,
    rememberedAccounts = [],
    targetName,
    initiallyLiked,
    count,
    copy,
  }: Props,
) {
  const busy = useSignal(false);
  const liked = useSignal(initiallyLiked);
  const likeCount = useSignal(count);
  const error = useSignal("");
  const authOpen = useSignal(false);
  const authDialogRef = useDialog<HTMLDivElement>(
    authOpen.value && !signedIn,
    () => authOpen.value = false,
  );

  useEffect(() => {
    if (!signedIn || isOwner) return;
    const url = new URL(globalThis.location.href);
    const rawPending = url.searchParams.get("favorite");
    const pending = favoriteResumeIntent(rawPending);
    if (!pending && rawPending !== "toggle") return;
    url.searchParams.delete("favorite");
    globalThis.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    // `toggle` was used by older reauthorization links, but it is ambiguous
    // after an account switch or concurrent state change. Consume it without
    // performing a write; new links always carry an absolute intent.
    if (pending) void submit(pending);
  }, []);

  if (isOwner) return null;

  if (!signedIn) {
    return (
      <>
        <a
          class="profile-form-button-secondary app-like-button"
          href={loginHref}
          aria-haspopup="dialog"
          aria-label={`${copy.signIn}. ${
            appLikeCountLabel(likeCount.value, copy)
          }`}
          onClick={(event) => {
            if (!isPlainPrimaryActivation(event)) return;
            event.preventDefault();
            authOpen.value = true;
          }}
        >
          <ContentVisualIcon name="like" class="app-like-icon" />
          <span class="app-like-count" aria-hidden="true">
            {likeCount.value.toLocaleString()}
          </span>
        </a>
        {authOpen.value && createPortal(
          <div
            class="modal-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) authOpen.value = false;
            }}
          >
            <LoginWithAtmosphereDialog
              id="favorite-signin-title"
              body={copy.signInBody}
              onClose={() => authOpen.value = false}
              dialogRef={authDialogRef}
              returnTo={returnTo}
              capabilities={["favorite"]}
              action="favorite"
              targetName={targetName}
              rememberedAccounts={rememberedAccounts}
            />
          </div>,
          document.body,
        )}
      </>
    );
  }

  async function submit(intent: FavoriteMutationIntent = "toggle") {
    if (busy.value) return;
    const previousLiked = liked.value;
    const previousCount = likeCount.value;
    const method = favoriteRequestMethod(previousLiked, intent);
    if (!method) return;
    const nextLiked = favoriteTargetLiked(previousLiked, intent);
    busy.value = true;
    error.value = "";
    liked.value = nextLiked;
    likeCount.value = Math.max(0, previousCount + (nextLiked ? 1 : -1));
    try {
      const res = await fetch(appLikeEndpoint(identifier), {
        method,
      });
      const body = await res.json().catch(() => null) as
        | AppLikeErrorBody
        | null;
      if (!res.ok) {
        if (
          res.status === 401 || body?.error === "reauth_required" ||
          body?.error === "oauth_session_expired"
        ) {
          globalThis.location.assign(
            reauthUrlFromApiPayload(body) ??
              (nextLiked ? reauthSaveHref : reauthRemoveHref),
          );
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
  }

  return (
    <div class="app-like-control">
      <button
        type="button"
        class={`profile-form-button-secondary app-like-button${
          liked.value ? " is-liked" : ""
        }`}
        onClick={() => submit()}
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
