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
}

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
): Promise<void> {
  const db = await openPendingDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    await requestResult(
      transaction.objectStore(STORE_NAME).put(
        {
          key,
          value,
          savedAt: Date.now(),
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
