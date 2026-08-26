/**
 * Authenticated app-owner writes for Standard.site What's New documents.
 *
 *   POST   /api/registry/profile/updates          create/update
 *   DELETE /api/registry/profile/updates?rkey=... delete
 */
import { define } from "../../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../../lib/appview-client.ts";
import { getSessionForCapabilities } from "../../../../lib/oauth.ts";
import {
  APP_UPDATE_MANAGEMENT_CAPABILITIES,
  oauthReauthorizationUrl,
} from "../../../../lib/oauth-action.ts";
import {
  getProfileUpdateByUri,
  markProfileUpdateRemovedByUri,
  upsertProfileUpdate,
} from "../../../../lib/profile-updates.ts";
import {
  createRecord,
  deleteRecord,
  getRecordPublic,
  isPdsScopeMissingError,
  putRecord,
} from "../../../../lib/pds.ts";
import { getAppListingById } from "../../../../lib/app-directory.ts";
import {
  atmosphereStandardSiteAppIdFromTags,
  atmosphereStandardSiteAppTag,
  atmosphereStandardSiteDocumentSlug,
  atmosphereStandardSitePublicationUrl,
  atmosphereStandardSiteUpdateSource,
  buildStandardSiteDocument,
  buildStandardSitePublication,
  createStandardSiteRkey,
  isStandardSiteRkey,
  parseStandardSiteDocument,
  parseStandardSitePublication,
  STANDARD_SITE_DOCUMENT_NSID,
  STANDARD_SITE_PUBLICATION_NSID,
  type StandardSiteDocumentRecord,
  standardSiteDocumentUri,
  type StandardSitePublicationRecord,
  standardSitePublicationRkeyFromUri,
  standardSiteUpdatePath,
  standardSiteVersionFromTags,
} from "../../../../lib/standard-site-updates.ts";
import {
  ensureStandardSitePublication,
} from "../../../../lib/standard-site-publishing.ts";
import {
  claimStandardSitePublicationBinding,
  getStandardSitePublicationBinding,
  getStandardSitePublicationBindingByUri,
} from "../../../../lib/standard-site-publication-bindings.ts";
import { SITE_URL } from "../../../../lib/env.ts";
import {
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../../lib/security.ts";

interface UpdatePayload {
  appId?: unknown;
  rkey?: unknown;
  title?: unknown;
  body?: unknown;
  version?: unknown;
  tangledCommitUrl?: unknown;
}

const MAX_PROFILE_UPDATE_BODY_BYTES = 32_768;

export const handler = define.handlers({
  async POST(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewProxyError(err),
    );
    if (proxied) return proxied;

    const large = rejectLargeRequest(ctx.req, MAX_PROFILE_UPDATE_BODY_BYTES);
    if (large) return large;

    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    let payload: UpdatePayload | null;
    try {
      payload = await readJsonRequestWithLimit(
        ctx.req,
        MAX_PROFILE_UPDATE_BODY_BYTES,
      ) as UpdatePayload | null;
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return new Response("request body too large", { status: 413 });
      }
      payload = null;
    }
    if (!payload) return jsonError(400, "invalid_body");
    const appId = normalizedAppId(payload.appId);
    if (!appId) return jsonError(400, "missing_app_id");
    const app = await getProductUpdateApp(appId, user.did);
    if (!app) return jsonError(403, "app_product_account_required");
    const session = await getSessionForCapabilities(
      user.did,
      APP_UPDATE_MANAGEMENT_CAPABILITIES,
    );
    if (!session) return appReauthRequired(app.id, app.name);

    const requestedRkey = typeof payload.rkey === "string" &&
        payload.rkey.trim()
      ? payload.rkey.trim()
      : null;
    if (requestedRkey && !isStandardSiteRkey(requestedRkey)) {
      return jsonError(400, "invalid_standard_site_rkey");
    }
    const rkey = requestedRkey ?? createStandardSiteRkey();
    const uri = standardSiteDocumentUri(user.did, rkey);
    const existing = await getProfileUpdateByUri(uri, {
      includeRemoved: true,
    }).catch(() => null);
    let remote = null;
    try {
      remote = requestedRkey
        ? await getRecordPublic(
          session.pdsUrl,
          user.did,
          STANDARD_SITE_DOCUMENT_NSID,
          rkey,
        )
        : null;
    } catch (error) {
      return upstreamReadError("document_record_read_failed", error);
    }
    const existingRecord = parseStandardSiteDocument(remote?.value);
    if (remote && !existingRecord) {
      return jsonError(409, "update_not_managed_by_atmosphere");
    }
    const now = new Date();
    const publicationUrl = atmosphereStandardSitePublicationUrl(
      SITE_URL,
      app.slug,
    );
    let site: string;
    let path: string;
    try {
      if (existingRecord) {
        const publication = await loadBoundDocumentPublication({
          appId: app.id,
          did: user.did,
          pdsUrl: session.pdsUrl,
          rkey,
          document: existingRecord,
        });
        if (!publication) {
          return jsonError(409, "update_not_managed_by_atmosphere");
        }
        site = publication.uri;
        path = existingRecord.path;
      } else {
        const publication = await ensureBoundAppPublication({
          app: {
            id: app.id,
            name: app.name,
            description: app.description,
          },
          did: user.did,
          pdsUrl: session.pdsUrl,
          publicationUrl,
        });
        site = publication.uri;
        path = standardSiteUpdatePath(app.slug, rkey);
      }
    } catch (error) {
      if (isPdsScopeMissingError(error)) {
        return appReauthRequired(app.id, app.name);
      }
      return jsonResponse(502, {
        error: "publication_record_failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    let managedRecord: StandardSiteDocumentRecord;
    let record: Record<string, unknown>;
    try {
      managedRecord = buildStandardSiteDocument({
        site,
        path,
        title: typeof payload.title === "string" ? payload.title : "",
        body: typeof payload.body === "string" ? payload.body : "",
        version: typeof payload.version === "string"
          ? payload.version
          : undefined,
        createdAt: existingRecord?.publishedAt ??
          (existing?.source === atmosphereStandardSiteUpdateSource(app.id)
            ? existing.createdAt
            : now),
        updatedAt: now,
        tags: existingRecord?.tags ?? [atmosphereStandardSiteAppTag(app.id)],
      });
      // Preserve Standard.site fields and extensions managed by other clients
      // while replacing only the fields owned by this editor.
      record = remote?.value && typeof remote.value === "object" &&
          !Array.isArray(remote.value)
        ? {
          ...(remote.value as Record<string, unknown>),
          ...managedRecord,
        }
        : managedRecord as unknown as Record<string, unknown>;
    } catch (error) {
      return jsonResponse(400, {
        error: "invalid_standard_site_document",
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    const result = await (remote
      ? putRecord(
        user.did,
        session.pdsUrl,
        STANDARD_SITE_DOCUMENT_NSID,
        rkey,
        record,
        { swapRecord: remote.cid },
      )
      : createRecord(
        user.did,
        session.pdsUrl,
        STANDARD_SITE_DOCUMENT_NSID,
        record,
        rkey,
      )).catch((err) => err instanceof Error ? err : new Error(String(err)));
    if (result instanceof Error) {
      if (isPdsScopeMissingError(result)) {
        return appReauthRequired(app.id, app.name);
      }
      return jsonResponse(502, {
        error: "put_record_failed",
        detail: result.message,
      });
    }

    const update = await upsertProfileUpdate({
      uri: result.uri || uri,
      cid: result.cid,
      rkey,
      projectDid: user.did,
      title: managedRecord.title,
      body: managedRecord.textContent ?? managedRecord.description ?? "",
      version: standardSiteVersionFromTags(managedRecord.tags),
      tangledCommitUrl: null,
      tangledRepoUrl: null,
      source: atmosphereStandardSiteUpdateSource(app.id),
      createdAt: Date.parse(managedRecord.publishedAt) || Date.now(),
      updatedAt: Date.parse(
        managedRecord.updatedAt ?? managedRecord.publishedAt,
      ) ||
        Date.now(),
    });
    return jsonResponse(200, { ok: true, update });
  },

  async DELETE(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewProxyError(err),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    const url = new URL(ctx.req.url);
    const appId = normalizedAppId(url.searchParams.get("app"));
    if (!appId) return jsonError(400, "missing_app_id");
    const app = await getProductUpdateApp(appId, user.did);
    if (!app) return jsonError(403, "app_product_account_required");
    const rkey = url.searchParams.get("rkey")?.trim();
    if (!rkey) return jsonError(400, "missing_rkey");
    if (!isStandardSiteRkey(rkey)) {
      return jsonError(400, "invalid_standard_site_rkey");
    }
    const session = await getSessionForCapabilities(
      user.did,
      APP_UPDATE_MANAGEMENT_CAPABILITIES,
    );
    if (!session) return appReauthRequired(app.id, app.name);

    const uri = standardSiteDocumentUri(user.did, rkey);
    const existing = await getProfileUpdateByUri(uri, {
      includeRemoved: true,
    }).catch(() => null);
    let remote;
    try {
      remote = await getRecordPublic(
        session.pdsUrl,
        user.did,
        STANDARD_SITE_DOCUMENT_NSID,
        rkey,
      );
    } catch (error) {
      return upstreamReadError("document_record_read_failed", error);
    }
    if (!remote) {
      if (
        existing?.source !== atmosphereStandardSiteUpdateSource(app.id)
      ) {
        return jsonError(409, "update_not_managed_by_atmosphere");
      }
      const removed = await markProfileUpdateRemovedByUri(uri);
      return jsonResponse(200, { ok: true, removed });
    }
    const record = parseStandardSiteDocument(remote.value);
    if (!record) return jsonError(409, "update_not_managed_by_atmosphere");
    let publication;
    try {
      publication = await loadBoundDocumentPublication({
        appId: app.id,
        did: user.did,
        pdsUrl: session.pdsUrl,
        rkey,
        document: record,
      });
    } catch (error) {
      return upstreamReadError("publication_record_read_failed", error);
    }
    if (!publication) {
      return jsonError(409, "update_not_managed_by_atmosphere");
    }

    const deleted = await deleteRecord(
      user.did,
      session.pdsUrl,
      STANDARD_SITE_DOCUMENT_NSID,
      rkey,
      { swapRecord: remote.cid },
    )
      .then(() => null)
      .catch((err) => err instanceof Error ? err : new Error(String(err)));
    if (deleted) {
      if (isPdsScopeMissingError(deleted)) {
        return appReauthRequired(app.id, app.name);
      }
      return jsonResponse(502, {
        error: "delete_record_failed",
        detail: deleted.message,
      });
    }
    const removed = await markProfileUpdateRemovedByUri(
      uri,
    );
    return jsonResponse(200, { ok: true, removed });
  },
});

interface BoundPublicationRef {
  uri: string;
  cid: string;
  rkey: string;
  value: StandardSitePublicationRecord;
}

async function ensureBoundAppPublication(input: {
  app: { id: string; name: string; description: string };
  did: string;
  pdsUrl: string;
  publicationUrl: string;
}): Promise<BoundPublicationRef> {
  const existingBinding = await getStandardSitePublicationBinding(
    input.app.id,
    input.publicationUrl,
  );
  if (existingBinding) {
    const existing = await loadPublicationAtBinding({
      did: input.did,
      pdsUrl: input.pdsUrl,
      binding: existingBinding,
    });
    if (existing) return existing;

    const rkey = standardSitePublicationRkeyFromUri(
      existingBinding.publicationUri,
      input.did,
    );
    if (!rkey) throw new Error("invalid bound publication URI");
    const value = buildStandardSitePublication({
      url: existingBinding.publicationUrl,
      name: `${input.app.name} updates`,
      description: input.app.description || null,
      showInDiscover: false,
    });
    try {
      const created = await createRecord(
        input.did,
        input.pdsUrl,
        STANDARD_SITE_PUBLICATION_NSID,
        value as unknown as Record<string, unknown>,
        rkey,
      );
      return {
        uri: created.uri || existingBinding.publicationUri,
        cid: created.cid,
        rkey,
        value,
      };
    } catch (error) {
      const raced = await loadPublicationAtBinding({
        did: input.did,
        pdsUrl: input.pdsUrl,
        binding: existingBinding,
      });
      if (raced) return raced;
      throw error;
    }
  }

  const candidate = await ensureStandardSitePublication({
    did: input.did,
    pdsUrl: input.pdsUrl,
    url: input.publicationUrl,
    name: `${input.app.name} updates`,
    description: input.app.description || null,
  });
  const binding = await claimStandardSitePublicationBinding({
    appListingId: input.app.id,
    publicationUrl: input.publicationUrl,
    publicationUri: candidate.uri,
  });
  if (binding.publicationUri === candidate.uri) return candidate;
  const winner = await loadPublicationAtBinding({
    did: input.did,
    pdsUrl: input.pdsUrl,
    binding,
  });
  if (!winner) throw new Error("bound publication is unavailable");
  return winner;
}

async function loadBoundDocumentPublication(input: {
  appId: string;
  did: string;
  pdsUrl: string;
  rkey: string;
  document: StandardSiteDocumentRecord;
}): Promise<BoundPublicationRef | null> {
  if (
    atmosphereStandardSiteAppIdFromTags(input.document.tags) !== input.appId
  ) {
    return null;
  }
  const binding = await getStandardSitePublicationBindingByUri(
    input.appId,
    input.document.site,
  );
  if (!binding) return null;
  const publication = await loadPublicationAtBinding({
    did: input.did,
    pdsUrl: input.pdsUrl,
    binding,
  });
  if (
    !publication || !atmosphereStandardSiteDocumentSlug(input.document, {
      publicationUrl: publication.value.url,
      siteUrl: SITE_URL,
      rkey: input.rkey,
    })
  ) {
    return null;
  }
  return publication;
}

async function loadPublicationAtBinding(input: {
  did: string;
  pdsUrl: string;
  binding: {
    publicationUri: string;
    publicationUrl: string;
  };
}): Promise<BoundPublicationRef | null> {
  const rkey = standardSitePublicationRkeyFromUri(
    input.binding.publicationUri,
    input.did,
  );
  if (!rkey) return null;
  const envelope = await getRecordPublic(
    input.pdsUrl,
    input.did,
    STANDARD_SITE_PUBLICATION_NSID,
    rkey,
  );
  const value = parseStandardSitePublication(envelope?.value);
  if (
    !envelope || envelope.uri !== input.binding.publicationUri || !value ||
    value.url !== input.binding.publicationUrl
  ) {
    return null;
  }
  return {
    uri: envelope.uri,
    cid: envelope.cid,
    rkey,
    value,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

function appviewProxyError(err: unknown): Response {
  console.warn("[api/registry/profile/updates] appview proxy failed:", err);
  return jsonResponse(503, { error: "appview_unavailable" });
}

function normalizedAppId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const appId = value.trim();
  return appId && appId.length <= 256 ? appId : null;
}

async function getProductUpdateApp(appId: string, userDid: string) {
  const app = await getAppListingById(appId).catch(() => null);
  return app?.productDid === userDid ? app : null;
}

function upstreamReadError(code: string, error: unknown): Response {
  return jsonResponse(502, {
    error: code,
    detail: error instanceof Error ? error.message : String(error),
  });
}

function appReauthRequired(appId: string, name = "your app"): Response {
  return jsonResponse(403, {
    error: "reauth_required",
    reauthUrl: oauthReauthorizationUrl({
      next: `/apps/manage?app=${encodeURIComponent(appId)}`,
      action: "app_updates",
      capabilities: APP_UPDATE_MANAGEMENT_CAPABILITIES,
      name,
    }),
  });
}
