import { define } from "../../../utils.ts";
import { fetchBlobPublic } from "../../../lib/pds.ts";
import { listApprovedSvgIconProfiles } from "../../../lib/registry.ts";
import {
  type IconVariant,
  uniqueZipFilename,
} from "../../../lib/svg-icon-downloads.ts";
import { withRateLimit } from "../../../lib/rate-limit.ts";
import { createZip, type ZipEntry } from "../../../lib/zip.ts";

export const handler = define.handlers({
  GET: withRateLimit(async () => {
    const profiles = await listApprovedSvgIconProfiles();
    const used = new Set<string>();
    const entries: ZipEntry[] = [];

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
        if (!upstream.ok) continue;
        const bytes = new Uint8Array(await upstream.arrayBuffer());
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
      },
    });
  }),
});
