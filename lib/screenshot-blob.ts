import { findPdsEndpoint, resolveDidDocument } from "./identity.ts";
import { fetchBlobPublic } from "./pds.ts";

export interface ScreenshotBlobResult {
  response: Response | null;
  endpoint: string | null;
  usedResolvedPds: boolean;
  errors: unknown[];
}

export async function fetchScreenshotBlobWithPdsFallback(input: {
  storedPdsUrl: string;
  did: string;
  cid: string;
  fetchBlob?: typeof fetchBlobPublic;
  resolvePds?: (did: string) => Promise<string>;
}): Promise<ScreenshotBlobResult> {
  const fetchBlob = input.fetchBlob ?? fetchBlobPublic;
  const resolvePds = input.resolvePds ??
    (async (did: string) => findPdsEndpoint(await resolveDidDocument(did)));
  const errors: unknown[] = [];
  let storedResponse: Response | null = null;

  try {
    storedResponse = await fetchBlob(
      input.storedPdsUrl,
      input.did,
      input.cid,
    );
    if (storedResponse.ok) {
      return {
        response: storedResponse,
        endpoint: input.storedPdsUrl,
        usedResolvedPds: false,
        errors,
      };
    }
  } catch (err) {
    errors.push(err);
  }

  let resolvedPds: string;
  try {
    resolvedPds = await resolvePds(input.did);
  } catch (err) {
    errors.push(err);
    return {
      response: storedResponse,
      endpoint: input.storedPdsUrl,
      usedResolvedPds: false,
      errors,
    };
  }

  if (
    normalizeEndpoint(resolvedPds) === normalizeEndpoint(input.storedPdsUrl)
  ) {
    return {
      response: storedResponse,
      endpoint: resolvedPds,
      usedResolvedPds: false,
      errors,
    };
  }

  try {
    return {
      response: await fetchBlob(resolvedPds, input.did, input.cid),
      endpoint: resolvedPds,
      usedResolvedPds: true,
      errors,
    };
  } catch (err) {
    errors.push(err);
    return {
      response: null,
      endpoint: resolvedPds,
      usedResolvedPds: true,
      errors,
    };
  }
}

function normalizeEndpoint(value: string): string {
  return value.trim().replace(/\/$/, "").toLowerCase();
}
