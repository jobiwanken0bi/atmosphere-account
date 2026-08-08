export interface ProfileUpdateDraft {
  rkey: string | null;
  title: string;
  version: string;
  body: string;
  tangledCommitUrl: string;
}

export interface PendingProfileUpdateAction {
  projectDid: string;
  draft: ProfileUpdateDraft;
}

export interface PendingProfileUpdateDeleteAction {
  projectDid: string;
  rkey: string;
}

export function profileUpdatePendingKey(projectDid: string): string {
  return `profile-update:save:${encodeURIComponent(projectDid)}`;
}

export function profileUpdateResumeMarker(projectDid: string): string {
  return `atmosphere:resume-profile-update:${projectDid}`;
}

export function profileUpdateDeletePendingKey(projectDid: string): string {
  return `profile-update:delete:${encodeURIComponent(projectDid)}`;
}

export function profileUpdateDeleteResumeMarker(projectDid: string): string {
  return `atmosphere:resume-profile-update-delete:${projectDid}`;
}

export function pendingProfileUpdateAction(
  projectDid: string,
  draft: ProfileUpdateDraft,
): PendingProfileUpdateAction {
  return { projectDid, draft };
}

export function pendingProfileUpdateDeleteAction(
  projectDid: string,
  rkey: string,
): PendingProfileUpdateDeleteAction {
  return { projectDid, rkey };
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
): ProfileUpdateDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pending = value as Partial<PendingProfileUpdateAction>;
  if (pending.projectDid !== projectDid) return null;
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
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pending = value as Partial<PendingProfileUpdateDeleteAction>;
  if (pending.projectDid !== projectDid || typeof pending.rkey !== "string") {
    return null;
  }
  const rkey = pending.rkey.trim();
  return rkey && rkey.length <= 512 ? rkey : null;
}
import { createAtprotoTid } from "./tid.ts";
