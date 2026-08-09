import type { PendingFormEntry } from "./pending-browser-action.ts";

export const HOST_PROFILE_RESUME_PARAM = "resume_host_profile";

export interface PendingHostProfileAction {
  did: string;
  host: string;
  entries: PendingFormEntry[];
}

export function hostProfilePendingKey(did: string, host: string): string {
  return `host-profile:save:${encodeURIComponent(did)}:${
    encodeURIComponent(normalizeHost(host))
  }`;
}

export function pendingHostProfileAction(
  did: string,
  host: string,
  entries: PendingFormEntry[],
): PendingHostProfileAction {
  return { did, host: normalizeHost(host), entries };
}

export function pendingHostProfileEntriesForContext(
  value: unknown,
  did: string,
  host: string,
): PendingFormEntry[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pending = value as Partial<PendingHostProfileAction>;
  return pending.did === did && pending.host === normalizeHost(host) &&
      Array.isArray(pending.entries)
    ? pending.entries
    : null;
}

export function hostProfileResumePath(url: URL): string {
  const resume = new URL(url);
  resume.searchParams.set(HOST_PROFILE_RESUME_PARAM, "1");
  return `${resume.pathname}${resume.search}${resume.hash}`;
}

export function hasHostProfileResumeMarker(url: URL): boolean {
  return url.searchParams.get(HOST_PROFILE_RESUME_PARAM) === "1";
}

export function withoutHostProfileResumeMarker(url: URL): string {
  const clean = new URL(url);
  clean.searchParams.delete(HOST_PROFILE_RESUME_PARAM);
  return `${clean.pathname}${clean.search}${clean.hash}`;
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}
