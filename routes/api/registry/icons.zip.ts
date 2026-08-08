import { define } from "../../../utils.ts";
import { fetchBlobPublic } from "../../../lib/pds.ts";
import { listApprovedSvgIconProfiles } from "../../../lib/registry.ts";
import {
  type IconVariant,
  uniqueZipFilename,
} from "../../../lib/svg-icon-downloads.ts";
import {
  enforceDurableRateLimit,
  withRateLimit,
} from "../../../lib/rate-limit.ts";
import { createZip, type ZipEntry } from "../../../lib/zip.ts";
import {
  MAX_SVG_ICON_BYTES,
  readSecureSvgBlob,
} from "../../../lib/svg-blob-security.ts";

const MAX_ZIP_ICON_COUNT = 256;
const MAX_ZIP_BYTES = 25_000_000;

export const handler = define.handlers({
  GET: withRateLimit(async (ctx) => {
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "approved-icon-archive",
      capacity: 6,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const profiles = await listApprovedSvgIconProfiles();
    const used = new Set<string>();
    const entries: ZipEntry[] = [];
    const candidateCount = profiles.reduce(
      (total, profile) =>
        total + Number(!!profile.iconCid && profile.iconStatus === "approved") +
        Number(!!profile.iconBwCid && profile.iconBwStatus === "approved"),
      0,
    );
    if (candidateCount > MAX_ZIP_ICON_COUNT) {
      return archiveError("icon archive is temporarily too large", 503);
    }
    let totalBytes = 0;

    for (const profile of profiles) {
      // Both variants are optional and approved-only — listing already
      // filtered for at least one approved variant per project.
      const variants: Array<{ cid: string; variant: IconVariant }> = [];
      if (profile.iconCid && profile.iconStatus === "approved") {
        variants.push({ cid: profile.iconCid, variant: "color" });
      }
      if (profile.iconBwCid && profile.iconBwStatus === "approved") {
        variants.push({ cid: profile.iconBwCid, variant: "bw" });
      }
      for (const { cid, variant } of variants) {
        const upstream = await fetchBlobPublic(
          profile.pdsUrl,
          profile.did,
          cid,
        );
        const secured = await readSecureSvgBlob(
          upstream,
          cid,
          MAX_SVG_ICON_BYTES,
        );
        if (!secured.ok) {
          console.warn(
            `[icons.zip] skipped ${profile.did} ${variant}: ${secured.reason}`,
          );
          continue;
        }
        const bytes = secured.bytes;
        totalBytes += bytes.byteLength;
        if (totalBytes > MAX_ZIP_BYTES) {
          return archiveError("icon archive is temporarily too large", 503);
        }
        entries.push({
          name: uniqueZipFilename(profile, variant, used),
          data: bytes,
          modifiedAt: new Date(profile.indexedAt),
        });
      }
    }

    const zip = createZip(entries);
    const body = new ArrayBuffer(zip.byteLength);
    new Uint8Array(body).set(zip);
    return new Response(body, {
      headers: {
        "content-type": "application/zip",
        "content-disposition":
          'attachment; filename="atmosphere-project-icons.zip"',
        "cache-control": "public, max-age=30, s-maxage=30",
        "x-content-type-options": "nosniff",
      },
    });
  }, {
    scope: "approved-icon-archive-soft",
    capacity: 12,
    refillMs: 60_000,
  }),
});

function archiveError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
