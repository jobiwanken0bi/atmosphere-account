import { resolveIdentity } from "../lib/identity.ts";
import { HOST_PROFILE_NSID, HOST_SERVICE_NSID } from "../lib/lexicons.ts";
import { getRecordPublic, listRecordsPublic } from "../lib/pds.ts";
import { withDb } from "../lib/db.ts";
import { upsertHostProtocolRecord } from "../lib/host-record-indexing.ts";

const DEFAULT_LIMIT = 100;

function usage(): string {
  return [
    "Usage: deno task backfill:hosts [handle ...]",
    "",
    "If no handles are provided, the task reads known host profile/claim handles",
    "from the local account_host table.",
  ].join("\n");
}

function rkeyFromUri(uri: string): string {
  return decodeURIComponent(uri.split("/").pop() ?? "");
}

async function handlesFromDb(): Promise<string[]> {
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `SELECT profile_handle, claim_handle
        FROM account_host
        WHERE profile_handle IS NOT NULL OR claim_handle IS NOT NULL`,
      args: [],
    });
    const handles = new Set<string>();
    for (const row of result.rows) {
      for (const key of ["profile_handle", "claim_handle"]) {
        const value = row[key];
        if (typeof value === "string" && value.includes(".")) {
          handles.add(value.toLowerCase());
        }
      }
    }
    return [...handles];
  });
}

async function backfillHandle(handle: string): Promise<{
  handle: string;
  serviceRecords: number;
  profileRecord: boolean;
}> {
  const identity = await resolveIdentity(handle);
  let serviceRecords = 0;
  let profileRecord = false;

  const profile = await getRecordPublic(
    identity.pdsUrl,
    identity.did,
    HOST_PROFILE_NSID,
    "self",
  ).catch((err) => {
    if (!isExpectedMissingCollectionError(err)) {
      console.warn(`[backfill:hosts] profile read failed for ${handle}:`, err);
    }
    return null;
  });
  if (profile) {
    const parsed = await upsertHostProtocolRecord({
      uri: profile.uri,
      cid: profile.cid,
      collection: HOST_PROFILE_NSID,
      repoDid: identity.did,
      rkey: "self",
      authorHandle: identity.handle,
      value: profile.value,
    });
    profileRecord = !!parsed;
  }

  let cursor: string | undefined;
  do {
    const page = await listRecordsPublic(
      identity.pdsUrl,
      identity.did,
      HOST_SERVICE_NSID,
      { limit: DEFAULT_LIMIT, cursor },
    ).catch((err) => {
      if (!isExpectedMissingCollectionError(err)) {
        console.warn(
          `[backfill:hosts] service list failed for ${handle}:`,
          err,
        );
      }
      return { records: [], cursor: undefined };
    });
    for (const record of page.records) {
      const parsed = await upsertHostProtocolRecord({
        uri: record.uri,
        cid: record.cid,
        collection: HOST_SERVICE_NSID,
        repoDid: identity.did,
        rkey: rkeyFromUri(record.uri),
        authorHandle: identity.handle,
        value: record.value,
      });
      if (parsed) serviceRecords++;
    }
    cursor = page.cursor;
  } while (cursor);

  return { handle: identity.handle, serviceRecords, profileRecord };
}

function isExpectedMissingCollectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /HTTP (400|404)\b/.test(message);
}

if (import.meta.main) {
  const args = Deno.args.filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    Deno.exit(0);
  }
  const handles = args.length > 0 ? args : await handlesFromDb();
  if (handles.length === 0) {
    console.log("[backfill:hosts] no host handles found");
    Deno.exit(0);
  }
  let services = 0;
  let profiles = 0;
  for (const handle of handles) {
    try {
      const result = await backfillHandle(handle);
      services += result.serviceRecords;
      if (result.profileRecord) profiles++;
      console.log(
        `[backfill:hosts] ${result.handle}: ${result.serviceRecords} service records, profile=${result.profileRecord}`,
      );
    } catch (err) {
      console.warn(`[backfill:hosts] failed ${handle}:`, err);
    }
  }
  console.log(
    `[backfill:hosts] done: ${services} service record(s), ${profiles} profile record(s)`,
  );
}
