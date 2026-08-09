/**
 * Small IndexedDB-backed handoff for form state that must survive a full-page
 * OAuth upgrade. IndexedDB is used instead of sessionStorage so File/Blob
 * values and normal image-sized payloads can be retained without base64 quota
 * failures. Callers own the key and clear it after success; stale records are
 * discarded automatically after the bounded OAuth handoff window.
 */

const DB_NAME = "atmosphere-pending-actions";
const STORE_NAME = "actions";
const DB_VERSION = 1;
export const PENDING_BROWSER_ACTION_TTL_MS = 30 * 60 * 1_000;

interface PendingRecord<T> {
  key: string;
  value: T;
  savedAt: number;
  ownerDid?: string;
}

interface SavePendingBrowserActionOptions {
  /** Account that initiated the pending write. A later account switch clears
   * actions owned by a different DID before they can be replayed. */
  ownerDid?: string;
}

interface PendingOwnerRecord {
  key?: unknown;
  ownerDid?: unknown;
}

const RESUME_MARKER_PREFIX = "atmosphere:resume-";
const OWNER_BOUND_SESSION_DRAFT_PREFIXES = [
  "atmosphere:review-draft:",
  "atmosphere:review-response-draft:",
  "atmosphere:review-report-draft:",
  "atmosphere:microblog-viewer:",
] as const;

export function isPendingBrowserActionFresh(
  savedAt: unknown,
  now = Date.now(),
  ttlMs = PENDING_BROWSER_ACTION_TTL_MS,
): boolean {
  if (
    typeof savedAt !== "number" || !Number.isFinite(savedAt) ||
    !Number.isFinite(now) || !Number.isFinite(ttlMs) || ttlMs < 0
  ) {
    return false;
  }
  const age = now - savedAt;
  return age >= 0 && age <= ttlMs;
}

function openPendingDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("browser storage is unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("open failed"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("request failed"));
  });
}

export async function savePendingBrowserAction<T>(
  key: string,
  value: T,
  options: SavePendingBrowserActionOptions = {},
): Promise<void> {
  const db = await openPendingDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const ownerDid = options.ownerDid?.trim();
    await requestResult(
      transaction.objectStore(STORE_NAME).put(
        {
          key,
          value,
          savedAt: Date.now(),
          ...(ownerDid ? { ownerDid } : {}),
        } satisfies PendingRecord<T>,
      ),
    );
  } finally {
    db.close();
  }
}

export async function loadPendingBrowserAction<T>(
  key: string,
): Promise<T | null> {
  const db = await openPendingDb();
  let expired = false;
  let value: T | null = null;
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const record = await requestResult(
      transaction.objectStore(STORE_NAME).get(key),
    ) as PendingRecord<T> | undefined;
    if (record && isPendingBrowserActionFresh(record.savedAt)) {
      value = record.value ?? null;
    } else {
      expired = !!record;
    }
  } finally {
    db.close();
  }
  if (expired) {
    await clearPendingBrowserAction(key).catch(() => {});
  }
  return value;
}

export async function clearPendingBrowserAction(key: string): Promise<void> {
  const db = await openPendingDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).delete(key));
  } finally {
    db.close();
  }
}

/** Return only valid action keys whose recorded owner differs from the active
 * account. Legacy unowned records are left to their action-specific one-shot
 * marker and normal TTL rather than being guessed at. */
export function pendingBrowserActionKeysForOtherOwner(
  records: readonly PendingOwnerRecord[],
  currentDid: string,
): string[] {
  return records.flatMap((record) =>
    typeof record.key === "string" && record.key &&
      typeof record.ownerDid === "string" && record.ownerDid &&
      record.ownerDid !== currentDid
      ? [record.key]
      : []
  );
}

/** DID-valued session markers are consumed synchronously on an account switch
 * so returning to their old account cannot reopen an editor while IndexedDB
 * cleanup is still in flight. */
export function pendingBrowserResumeMarkerKeysForOtherOwner(
  entries: readonly (readonly [string, string | null])[],
  currentDid: string,
): string[] {
  return entries.flatMap(([key, ownerDid]) =>
    key.startsWith(RESUME_MARKER_PREFIX) && ownerDid && ownerDid !== currentDid
      ? [key]
      : []
  );
}

export function clearPendingBrowserResumeMarkersForOtherOwner(
  currentDid: string,
  storage: Pick<Storage, "length" | "key" | "getItem" | "removeItem"> =
    globalThis.sessionStorage,
): void {
  const entries: Array<readonly [string, string | null]> = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key) entries.push([key, storage.getItem(key)]);
  }
  for (
    const key of pendingBrowserResumeMarkerKeysForOtherOwner(
      entries,
      currentDid,
    )
  ) {
    storage.removeItem(key);
  }
}

export function pendingBrowserSessionDraftKeysForOtherOwner(
  entries: readonly (readonly [string, string | null])[],
  currentDid: string,
): string[] {
  return entries.flatMap(([key, rawValue]) => {
    if (
      !OWNER_BOUND_SESSION_DRAFT_PREFIXES.some((prefix) =>
        key.startsWith(prefix)
      )
    ) return [];
    if (!rawValue) return [key];
    try {
      const value = JSON.parse(rawValue) as Record<string, unknown>;
      return value.ownerDid === currentDid ? [] : [key];
    } catch {
      // Legacy plaintext/unowned drafts are not safe to retain across an
      // account change.
      return [key];
    }
  });
}

export function clearPendingBrowserSessionDraftsForOtherOwner(
  currentDid: string,
  storage: Pick<Storage, "length" | "key" | "getItem" | "removeItem"> =
    globalThis.sessionStorage,
): void {
  const entries: Array<readonly [string, string | null]> = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key) entries.push([key, storage.getItem(key)]);
  }
  for (
    const key of pendingBrowserSessionDraftKeysForOtherOwner(
      entries,
      currentDid,
    )
  ) storage.removeItem(key);
}

/**
 * Cancel browser-stored writes when the active account changes. This runs from
 * the signed-in account shell, so it still executes when a protected route
 * redirects away before the editor that created the draft can mount.
 */
export async function clearPendingBrowserActionsForOtherOwners(
  currentDid: string,
): Promise<void> {
  try {
    clearPendingBrowserResumeMarkersForOtherOwner(currentDid);
    clearPendingBrowserSessionDraftsForOtherOwner(currentDid);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts. The
    // IndexedDB ownership check below remains the write-safety boundary.
  }

  const db = await openPendingDb();
  try {
    const readTransaction = db.transaction(STORE_NAME, "readonly");
    const records = await requestResult(
      readTransaction.objectStore(STORE_NAME).getAll(),
    ) as PendingRecord<unknown>[];
    const staleKeys = pendingBrowserActionKeysForOtherOwner(
      records,
      currentDid,
    );
    if (staleKeys.length === 0) return;

    const writeTransaction = db.transaction(STORE_NAME, "readwrite");
    const store = writeTransaction.objectStore(STORE_NAME);
    await Promise.all(staleKeys.map((key) => requestResult(store.delete(key))));
  } finally {
    db.close();
  }
}

export type PendingFormEntry = readonly [string, string | File];

export function formDataEntries(form: FormData): PendingFormEntry[] {
  return [...form.entries()];
}

export function formDataFromEntries(
  entries: readonly PendingFormEntry[],
): FormData {
  const form = new FormData();
  for (const [name, value] of entries) form.append(name, value);
  return form;
}
