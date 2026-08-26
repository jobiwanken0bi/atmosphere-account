import { isSafeRelativePath } from "./security.ts";
import { createAtprotoTid } from "./tid.ts";

export const PROFILE_UPDATE_RESUME_PARAM = "profile-update-resume";
export const PROFILE_UPDATE_DELETE_RESUME_PARAM =
  "profile-update-delete-resume";

export type ProfileUpdateResumeKind = "save" | "delete";

const FALLBACK_RETURN_TO = "/apps/manage";
const PARSE_ORIGIN = "https://atmosphere.invalid";

function relativeLocation(url: URL): string {
  return url.pathname + url.search + url.hash;
}

export interface ProfileUpdateDraft {
  rkey: string | null;
  title: string;
  version: string;
  body: string;
  tangledCommitUrl: string;
}

export interface PendingProfileUpdateAction {
  projectDid: string;
  appId: string;
  draft: ProfileUpdateDraft;
}

export interface PendingProfileUpdateDeleteAction {
  projectDid: string;
  appId: string;
  rkey: string;
}

export function profileUpdatePendingKey(
  projectDid: string,
  appId: string,
): string {
  return `profile-update:save:${encodeURIComponent(projectDid)}:${
    encodeURIComponent(appId)
  }`;
}

export function profileUpdateDeletePendingKey(
  projectDid: string,
  appId: string,
): string {
  return `profile-update:delete:${encodeURIComponent(projectDid)}:${
    encodeURIComponent(appId)
  }`;
}

export function profileUpdateResumeProofKey(
  projectDid: string,
  appId: string,
  kind: ProfileUpdateResumeKind,
): string {
  const pendingKey = kind === "save"
    ? profileUpdatePendingKey(projectDid, appId)
    : profileUpdateDeletePendingKey(projectDid, appId);
  return "atmosphere:browser-resume-marker:profile-update:" + kind + ":" +
    encodeURIComponent(pendingKey);
}

export function profileUpdateReturnToWithoutResume(returnTo: string): string {
  const safeReturnTo = isSafeRelativePath(returnTo)
    ? returnTo
    : FALLBACK_RETURN_TO;
  const url = new URL(safeReturnTo, PARSE_ORIGIN);
  url.searchParams.delete(PROFILE_UPDATE_RESUME_PARAM);
  url.searchParams.delete(PROFILE_UPDATE_DELETE_RESUME_PARAM);
  return relativeLocation(url);
}

export function profileUpdateResumeReturnTo(
  returnTo: string,
  projectDid: string,
  appId: string,
  kind: ProfileUpdateResumeKind,
): string {
  const url = new URL(
    profileUpdateReturnToWithoutResume(returnTo),
    PARSE_ORIGIN,
  );
  url.searchParams.set("app", appId);
  url.searchParams.set(
    kind === "save"
      ? PROFILE_UPDATE_RESUME_PARAM
      : PROFILE_UPDATE_DELETE_RESUME_PARAM,
    projectDid,
  );
  return relativeLocation(url);
}

export interface ProfileUpdateResumeLocation {
  hadMarker: boolean;
  shouldResume: boolean;
  kind: ProfileUpdateResumeKind | null;
  cleanLocation: string;
}

/** Consume exactly one action marker. Duplicate, conflicting, or wrong-DID
 * markers are cleaned from the URL but never authorize a repository write. */
export function profileUpdateResumeLocation(
  href: string,
  projectDid: string,
  appId: string,
): ProfileUpdateResumeLocation {
  const url = new URL(href, PARSE_ORIGIN);
  const saveMarkers = url.searchParams.getAll(PROFILE_UPDATE_RESUME_PARAM);
  const deleteMarkers = url.searchParams.getAll(
    PROFILE_UPDATE_DELETE_RESUME_PARAM,
  );
  url.searchParams.delete(PROFILE_UPDATE_RESUME_PARAM);
  url.searchParams.delete(PROFILE_UPDATE_DELETE_RESUME_PARAM);

  const markerCount = saveMarkers.length + deleteMarkers.length;
  const kind: ProfileUpdateResumeKind | null = markerCount === 1
    ? saveMarkers.length === 1 ? "save" : "delete"
    : null;
  const marker = kind === "save" ? saveMarkers[0] : deleteMarkers[0];
  return {
    hadMarker: markerCount > 0,
    shouldResume: kind !== null && marker === projectDid &&
      url.searchParams.getAll("app").length === 1 &&
      url.searchParams.get("app") === appId,
    kind,
    cleanLocation: relativeLocation(url),
  };
}

export function pendingProfileUpdateAction(
  projectDid: string,
  appId: string,
  draft: ProfileUpdateDraft,
): PendingProfileUpdateAction {
  return { projectDid, appId, draft };
}

export function pendingProfileUpdateDeleteAction(
  projectDid: string,
  appId: string,
  rkey: string,
): PendingProfileUpdateDeleteAction {
  return { projectDid, appId, rkey };
}

/** Allocate the repository key before the first write so a PDS success
 * followed by a local-index failure can be retried without creating a second
 * update record. */
export function publishableProfileUpdateDraft(
  draft: ProfileUpdateDraft,
  createRkey: () => string = createAtprotoTid,
): ProfileUpdateDraft {
  return draft.rkey ? draft : { ...draft, rkey: createRkey() };
}

export function pendingProfileUpdateDraftForDid(
  value: unknown,
  projectDid: string,
  appId: string,
): ProfileUpdateDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pending = value as Partial<PendingProfileUpdateAction>;
  if (pending.projectDid !== projectDid || pending.appId !== appId) return null;
  const draft = pending.draft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  if (
    draft.rkey !== null && typeof draft.rkey !== "string" ||
    typeof draft.title !== "string" ||
    typeof draft.version !== "string" ||
    typeof draft.body !== "string" ||
    typeof draft.tangledCommitUrl !== "string"
  ) return null;
  return {
    rkey: draft.rkey,
    title: draft.title,
    version: draft.version,
    body: draft.body,
    tangledCommitUrl: draft.tangledCommitUrl,
  };
}

export function pendingProfileUpdateDeleteForDid(
  value: unknown,
  projectDid: string,
  appId: string,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pending = value as Partial<PendingProfileUpdateDeleteAction>;
  if (
    pending.projectDid !== projectDid || pending.appId !== appId ||
    typeof pending.rkey !== "string"
  ) {
    return null;
  }
  const rkey = pending.rkey.trim();
  return rkey && rkey.length <= 512 ? rkey : null;
}
