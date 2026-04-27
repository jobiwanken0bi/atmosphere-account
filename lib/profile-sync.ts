import { resolveIdentity } from "./identity.ts";
import { PROFILE_NSID, validateProfile } from "./lexicons.ts";
import { getRecordPublic, listRecordsPublic } from "./pds.ts";
import { getProfileByDid, upsertProfile } from "./registry.ts";

interface ProfileRecordEnvelope {
  uri: string;
  cid: string;
  value: unknown;
  rkey: string;
}

function rkeyFromAtUri(uri: string): string | null {
  const parts = uri.split("/");
  return parts.length > 0 ? parts[parts.length - 1] || null : null;
}

export async function upsertProfileFromRecord(input: {
  did: string;
  handle: string;
  pdsUrl: string;
  record: ProfileRecordEnvelope;
  recordRev: string;
}): Promise<boolean> {
  const validation = validateProfile(input.record.value);
  if (!validation.ok || !validation.value) {
    console.warn(
      `[profile-sync] invalid profile from ${input.did}/${input.record.rkey}: ${validation.error}`,
    );
    return false;
  }

  const r = validation.value;
  await upsertProfile({
    did: input.did,
    handle: input.handle,
    profileType: r.profileType,
    name: r.name,
    description: r.description,
    mainLink: r.mainLink ?? null,
    iosLink: r.iosLink ?? null,
    androidLink: r.androidLink ?? null,
    categories: r.categories ?? [],
    subcategories: r.subcategories ?? [],
    links: r.links ?? [],
    screenshots: r.screenshots ?? [],
    avatarCid: r.avatar?.ref.$link ?? null,
    avatarMime: r.avatar?.mimeType ?? null,
    iconCid: r.icon?.ref.$link ?? null,
    iconMime: r.icon?.mimeType ?? null,
    iconBwCid: r.iconBw?.ref.$link ?? null,
    iconBwMime: r.iconBw?.mimeType ?? null,
    pdsUrl: input.pdsUrl,
    recordCid: input.record.cid,
    recordRev: input.recordRev,
    createdAt: Date.parse(r.createdAt) || Date.now(),
  });
  return true;
}

export async function syncProfileByIdentifier(
  identifier: string,
): Promise<boolean> {
  const identity = await resolveIdentity(identifier);
  const canonical = await getRecordPublic(
    identity.pdsUrl,
    identity.did,
    PROFILE_NSID,
    "self",
  );

  if (canonical) {
    return await upsertProfileFromRecord({
      did: identity.did,
      handle: identity.handle,
      pdsUrl: identity.pdsUrl,
      record: { ...canonical, rkey: "self" },
      recordRev: canonical.cid,
    });
  }

  const listed = await listRecordsPublic(
    identity.pdsUrl,
    identity.did,
    PROFILE_NSID,
    {
      limit: 25,
      reverse: true,
    },
  );
  for (const record of listed.records) {
    const rkey = rkeyFromAtUri(record.uri);
    if (!rkey) continue;
    const synced = await upsertProfileFromRecord({
      did: identity.did,
      handle: identity.handle,
      pdsUrl: identity.pdsUrl,
      record: { ...record, rkey },
      recordRev: record.cid,
    });
    if (synced) return true;
  }

  return (await getProfileByDid(identity.did).catch(() => null)) !== null;
}
