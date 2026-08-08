import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import ContentVisualIcon from "../components/icons/ContentVisualIcon.tsx";
import {
  type ContextualReauthorization,
  contextualReauthorization,
  contextualReauthorizationFromApiPayload,
} from "../lib/reauth-required.ts";
import ContextualSignInDialog from "./ContextualSignInDialog.tsx";
import ContextualReauthorizationDialog from "./ContextualReauthorizationDialog.tsx";
import { oauthLoginUrl } from "../lib/oauth-action.ts";
import {
  type FavoriteMutationIntent,
  favoriteRequestMethod,
  favoriteResumeIntent,
  favoriteResumeProofKey,
  favoriteResumeProofValue,
  favoriteTargetLiked,
  isValidFavoriteResumeProof,
} from "../lib/favorite-resume.ts";
import { oauthCancellationLocation } from "../lib/oauth-cancellation.ts";
import { isPlainLinkActivation } from "../lib/link-activation.ts";

interface AppLikeCopy {
  like: string;
  unlike: string;
  signIn: string;
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
  removeReturnTo: string;
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  currentDid?: string;
  currentHandle?: string;
  targetName: string;
  initiallyLiked: boolean;
  count: number;
  copy: AppLikeCopy;
}

interface AppLikeErrorBody {
  ok?: unknown;
  error?: string;
  reauthUrl?: string;
}

export function appLikeEndpoint(identifier: string): string {
  return `/api/apps/${encodeURIComponent(identifier)}/favorite`;
}

export function appLikeReauthHref(
  accountDid: string,
  next: string,
  targetName?: string,
): string {
  return oauthLoginUrl({
    handle: accountDid,
    next,
    action: "favorite",
    capabilities: ["favorite"],
    name: targetName,
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
    removeReturnTo,
    rememberedAccounts = [],
    currentDid,
    currentHandle,
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
  const reauthorization = useSignal<ContextualReauthorization | null>(null);
  const authorizationIntent = useSignal<"save" | "remove">("save");
  const resumeProofKey = favoriteResumeProofKey(identifier);

  const armResume = (intent: "save" | "remove", ownerDid: string | null) => {
    try {
      sessionStorage.setItem(
        resumeProofKey,
        favoriteResumeProofValue(intent, ownerDid),
      );
    } catch {
      // The return marker will be consumed without writing when storage is
      // unavailable; the person can retry from the still-correct page state.
    }
  };

  useEffect(() => {
    const cancellation = oauthCancellationLocation(
      globalThis.location.href,
      "favorite",
    );
    if (cancellation.wasCancelled) {
      globalThis.history.replaceState(null, "", cancellation.cleanLocation);
      try {
        sessionStorage.removeItem(resumeProofKey);
      } catch {
        // Storage may be disabled; there is no replay in that case.
      }
      return;
    }
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
    let proof: string | null = null;
    try {
      proof = sessionStorage.getItem(resumeProofKey);
      sessionStorage.removeItem(resumeProofKey);
    } catch {
      // Fail closed: a query parameter without same-tab proof never writes.
    }
    if (
      pending &&
      isValidFavoriteResumeProof(proof, pending, currentDid ?? null)
    ) void submit(pending);
  }, []);

  if (isOwner) return null;

  if (!signedIn) {
    return (
      <>
        <a
          class="profile-form-button-secondary app-like-button"
          href={loginHref}
          aria-haspopup="dialog"
          aria-expanded={authOpen.value ? "true" : "false"}
          aria-label={`${copy.signIn}. ${
            appLikeCountLabel(likeCount.value, copy)
          }`}
          onClick={(event) => {
            if (!isPlainLinkActivation(event)) return;
            event.preventDefault();
            authOpen.value = true;
          }}
        >
          <ContentVisualIcon name="like" class="app-like-icon" />
          <span class="app-like-count" aria-hidden="true">
            {likeCount.value.toLocaleString()}
          </span>
        </a>
        {authOpen.value && (
          <ContextualSignInDialog
            fallbackHref={loginHref}
            returnTo={returnTo}
            capabilities={["favorite"]}
            action="favorite"
            targetName={targetName}
            rememberedAccounts={rememberedAccounts}
            closeLabel={copy.cancel}
            onAuthorizationStart={() => armResume("save", null)}
            onClose={() => authOpen.value = false}
          />
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
          const contextual = contextualReauthorizationFromApiPayload(body);
          if (contextual) {
            liked.value = previousLiked;
            likeCount.value = previousCount;
            reauthorization.value = contextual;
            authorizationIntent.value = nextLiked ? "save" : "remove";
            return;
          }
          if (body?.reauthUrl == null) {
            const localContext = contextualReauthorization({
              returnTo: nextLiked ? returnTo : removeReturnTo,
              action: "favorite",
              capabilities: ["favorite"],
              targetName,
            });
            if (localContext) {
              liked.value = previousLiked;
              likeCount.value = previousCount;
              reauthorization.value = localContext;
              authorizationIntent.value = nextLiked ? "save" : "remove";
              return;
            }
            globalThis.location.assign(
              nextLiked ? reauthSaveHref : reauthRemoveHref,
            );
            return;
          }
        }
        throw new Error(copy.error);
      }
      if (body?.ok !== true) throw new Error(copy.error);
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
      {reauthorization.value && currentDid && currentHandle && (
        <ContextualReauthorizationDialog
          authorization={reauthorization.value}
          currentDid={currentDid}
          currentHandle={currentHandle}
          rememberedAccounts={rememberedAccounts}
          restrictToCurrentAccount
          closeLabel={copy.cancel}
          onAuthorizationStart={() =>
            armResume(authorizationIntent.value, currentDid)}
          onClose={() => reauthorization.value = null}
        />
      )}
    </div>
  );
}
