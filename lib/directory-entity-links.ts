import { type DbClient, withDb } from "./db.ts";
import type { AppListing } from "./app-directory.ts";

export type DirectoryEntityRelationship =
  | "same_product"
  | "same_operator"
  | "host_only";

export type DirectoryEntityLinkStatus = "pending" | "verified";
export type DirectoryEntityLinkSource = "claimed" | "seeded";

export interface DirectoryEntityLink {
  host: string;
  appListingId: string;
  relationship: DirectoryEntityRelationship;
  status: DirectoryEntityLinkStatus;
  source: DirectoryEntityLinkSource;
  hostOwnerDid: string;
  appOwnerDid: string;
  hostApprovedAt: number | null;
  appApprovedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface DirectoryEntityAppLink extends DirectoryEntityLink {
  appSlug: string;
  appName: string;
  hostDisplayName: string;
}

export interface DirectoryEntityLinkMutation {
  ok: boolean;
  link?: DirectoryEntityLink;
  error?: string;
}

const RELATIONSHIPS = new Set<DirectoryEntityRelationship>([
  "same_product",
  "same_operator",
  "host_only",
]);

export function isDirectoryEntityRelationship(
  value: unknown,
): value is DirectoryEntityRelationship {
  return typeof value === "string" &&
    RELATIONSHIPS.has(value as DirectoryEntityRelationship);
}

export function appIdentityDids(
  app: Pick<AppListing, "productDid" | "profileDid" | "legacyProfileDid">,
): string[] {
  return [
    ...new Set(
      [
        app.productDid,
        app.profileDid,
        app.legacyProfileDid,
      ].filter((did): did is string => Boolean(did?.trim())).map((did) =>
        did.trim()
      ),
    ),
  ];
}

export function userControlsAppListing(
  app: Pick<AppListing, "productDid" | "profileDid" | "legacyProfileDid">,
  did: string,
): boolean {
  return appIdentityDids(app).includes(did.trim());
}

export function directoryEntityStatusForApprovals(
  relationship: DirectoryEntityRelationship,
  hostApprovedAt: number | null,
  appApprovedAt: number | null,
): DirectoryEntityLinkStatus {
  if (!hostApprovedAt) return "pending";
  if (relationship === "host_only") return "verified";
  return appApprovedAt ? "verified" : "pending";
}

export function currentDirectoryOwnerApproval(
  approvedAt: number | null,
  approvedOwnerDid: string,
  currentOwnerDids: string[],
): number | null {
  return approvedAt && currentOwnerDids.includes(approvedOwnerDid)
    ? approvedAt
    : null;
}

export async function listDirectoryEntityLinksForHost(
  host: string,
): Promise<DirectoryEntityAppLink[]> {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return [];
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT d.*, l.slug AS app_slug, l.name AS app_name,
          h.display_name AS host_display_name,
          l.product_did, l.profile_did, l.legacy_profile_did,
          hc.claimant_did
        FROM directory_entity_link d
        INNER JOIN app_listing l ON l.id = d.app_listing_id
        INNER JOIN account_host h ON h.host = d.host
        LEFT JOIN account_host_claim hc ON hc.host = d.host
        WHERE d.host = ? AND l.deleted_at IS NULL
        ORDER BY
          CASE d.relationship
            WHEN 'same_product' THEN 0
            WHEN 'same_operator' THEN 1
            ELSE 2
          END,
          l.name ASC
      `,
      args: [normalizedHost],
    });
    return result.rows.map(rowToAppLink).filter((
      link,
    ): link is DirectoryEntityAppLink => Boolean(link));
  });
}

export async function listDirectoryEntityLinksForApp(
  appListingId: string,
): Promise<DirectoryEntityAppLink[]> {
  if (!appListingId.trim()) return [];
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT d.*, l.slug AS app_slug, l.name AS app_name,
          h.display_name AS host_display_name,
          l.product_did, l.profile_did, l.legacy_profile_did,
          hc.claimant_did
        FROM directory_entity_link d
        INNER JOIN app_listing l ON l.id = d.app_listing_id
        INNER JOIN account_host h ON h.host = d.host
        LEFT JOIN account_host_claim hc ON hc.host = d.host
        WHERE d.app_listing_id = ? AND l.deleted_at IS NULL
        ORDER BY d.updated_at DESC, d.host ASC
      `,
      args: [appListingId.trim()],
    });
    return result.rows.map(rowToAppLink).filter((
      link,
    ): link is DirectoryEntityAppLink => Boolean(link));
  });
}

export async function listVerifiedDirectoryEntityLinksForApp(
  appListingId: string,
): Promise<DirectoryEntityAppLink[]> {
  if (!appListingId.trim()) return [];
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT d.*, l.slug AS app_slug, l.name AS app_name,
          h.display_name AS host_display_name,
          l.product_did, l.profile_did, l.legacy_profile_did,
          hc.claimant_did
        FROM directory_entity_link d
        INNER JOIN app_listing l ON l.id = d.app_listing_id
        INNER JOIN account_host h ON h.host = d.host
        LEFT JOIN account_host_claim hc ON hc.host = d.host
        LEFT JOIN app_moderation m ON m.listing_id = l.id
        WHERE d.app_listing_id = ?
          AND d.status = 'verified'
          AND l.deleted_at IS NULL
          AND COALESCE(m.status, 'visible') = 'visible'
        ORDER BY
          CASE d.relationship
            WHEN 'same_product' THEN 0
            WHEN 'same_operator' THEN 1
            ELSE 2
          END,
          d.updated_at DESC
      `,
      args: [appListingId.trim()],
    });
    return result.rows.flatMap((row) => {
      const link = rowToAppLink(row);
      return link && linkIsCurrentlyAuthorized(row, link) ? [link] : [];
    });
  });
}

export async function listVerifiedDirectoryEntityLinksForHosts(
  hosts: string[],
): Promise<Record<string, DirectoryEntityAppLink[]>> {
  const normalized = [...new Set(hosts.map(normalizeHost).filter(Boolean))];
  if (normalized.length === 0) return {};
  const placeholders = normalized.map(() => "?").join(", ");
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `
        SELECT d.*, l.slug AS app_slug, l.name AS app_name,
          h.display_name AS host_display_name,
          l.product_did, l.profile_did, l.legacy_profile_did,
          hc.claimant_did
        FROM directory_entity_link d
        INNER JOIN app_listing l ON l.id = d.app_listing_id
        INNER JOIN account_host h ON h.host = d.host
        LEFT JOIN account_host_claim hc ON hc.host = d.host
        LEFT JOIN app_moderation m ON m.listing_id = l.id
        WHERE d.host IN (${placeholders})
          AND d.status = 'verified'
          AND l.deleted_at IS NULL
          AND COALESCE(m.status, 'visible') = 'visible'
        ORDER BY
          CASE d.relationship
            WHEN 'same_product' THEN 0
            WHEN 'same_operator' THEN 1
            ELSE 2
          END,
          l.name ASC
      `,
      args: normalized,
    });
    const links: Record<string, DirectoryEntityAppLink[]> = {};
    for (const row of result.rows) {
      const link = rowToAppLink(row);
      if (!link || !linkIsCurrentlyAuthorized(row, link)) continue;
      (links[link.host] ??= []).push(link);
    }
    return links;
  });
}

export async function getDirectoryEntityLink(
  host: string,
  appListingId: string,
): Promise<DirectoryEntityLink | null> {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost || !appListingId.trim()) return null;
  return await withDb(async (c) => {
    const result = await c.execute({
      sql: `SELECT * FROM directory_entity_link
        WHERE host = ? AND app_listing_id = ? LIMIT 1`,
      args: [normalizedHost, appListingId.trim()],
    });
    return result.rows.length > 0 ? rowToLink(result.rows[0]) : null;
  });
}

export async function defineDirectoryEntityLink(input: {
  host: string;
  app: AppListing;
  relationship: DirectoryEntityRelationship;
  approvedBy: "host" | "app";
  currentDid: string;
}): Promise<DirectoryEntityLinkMutation> {
  const host = normalizeHost(input.host);
  if (!host || !isDirectoryEntityRelationship(input.relationship)) {
    return { ok: false, error: "Choose a valid host and relationship." };
  }
  const currentDid = input.currentDid.trim();
  const appDids = appIdentityDids(input.app);
  if (appDids.length === 0) {
    return {
      ok: false,
      error: "This app does not have a verifiable owner DID.",
    };
  }

  return await withDb(async (c) => {
    const claimResult = await c.execute({
      sql: `
        SELECT hc.claimant_did, h.profile_did
        FROM account_host_claim hc
        INNER JOIN account_host h ON h.host = hc.host
        WHERE hc.host = ?
        LIMIT 1
      `,
      args: [host],
    });
    const hostOwnerDid = value(claimResult.rows[0], "claimant_did");
    const hostProfileDid = value(claimResult.rows[0], "profile_did");
    if (!hostOwnerDid) {
      return {
        ok: false,
        error: "The host must be claimed before defining relationships.",
      };
    }
    if (input.approvedBy === "host" && hostOwnerDid !== currentDid) {
      return {
        ok: false,
        error: "This account does not control the claimed host.",
      };
    }
    if (input.approvedBy === "app" && !appDids.includes(currentDid)) {
      return {
        ok: false,
        error: "This account does not control the app listing.",
      };
    }
    if (input.relationship === "host_only" && input.approvedBy !== "host") {
      return {
        ok: false,
        error: "Only the claimed host owner can mark a listing as host-only.",
      };
    }
    if (
      input.relationship === "host_only" &&
      (!hostProfileDid || !appDids.includes(hostProfileDid))
    ) {
      return {
        ok: false,
        error:
          "Host-only can only override the app inferred from this host's current profile DID.",
      };
    }

    const now = Date.now();
    const appOwnerDid = input.approvedBy === "app" ? currentDid : appDids[0];
    const hostApprovedAt = input.approvedBy === "host"
      ? now
      : hostOwnerDid === currentDid
      ? now
      : null;
    const appApprovedAt = input.relationship === "host_only"
      ? null
      : input.approvedBy === "app" || appOwnerDid === currentDid
      ? now
      : null;

    const existing = await c.execute({
      sql: `SELECT * FROM directory_entity_link
        WHERE host = ? AND app_listing_id = ? LIMIT 1`,
      args: [host, input.app.id],
    });
    const previous = existing.rows.length > 0
      ? rowToLink(existing.rows[0])
      : null;
    const sameRelationship = previous?.relationship === input.relationship;
    const preservedHostApproval = sameRelationship &&
        previous?.hostOwnerDid === hostOwnerDid
      ? previous.hostApprovedAt
      : null;
    const preservedAppApproval = sameRelationship &&
        appDids.includes(previous?.appOwnerDid ?? "")
      ? previous?.appApprovedAt ?? null
      : null;
    const finalHostApproval = hostApprovedAt ?? preservedHostApproval;
    const finalAppApproval = appApprovedAt ?? preservedAppApproval;
    const finalAppOwnerDid = preservedAppApproval && previous
      ? previous.appOwnerDid
      : appOwnerDid;
    const finalStatus = directoryEntityStatusForApprovals(
      input.relationship,
      finalHostApproval,
      finalAppApproval,
    );

    await c.execute({
      sql: `
        INSERT INTO directory_entity_link (
          host, app_listing_id, relationship, status, source,
          host_owner_did, app_owner_did, host_approved_at, app_approved_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'claimed', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(host, app_listing_id) DO UPDATE SET
          relationship = excluded.relationship,
          status = excluded.status,
          source = 'claimed',
          host_owner_did = excluded.host_owner_did,
          app_owner_did = excluded.app_owner_did,
          host_approved_at = excluded.host_approved_at,
          app_approved_at = excluded.app_approved_at,
          updated_at = excluded.updated_at
      `,
      args: [
        host,
        input.app.id,
        input.relationship,
        finalStatus,
        hostOwnerDid,
        finalAppOwnerDid,
        finalHostApproval,
        finalAppApproval,
        previous?.createdAt ?? now,
        now,
      ],
    });
    const link = await getLinkWithClient(c, host, input.app.id);
    return link
      ? { ok: true, link }
      : { ok: false, error: "Relationship could not be saved." };
  });
}

export async function approveDirectoryEntityLink(
  host: string,
  app: AppListing,
  currentDid: string,
): Promise<DirectoryEntityLinkMutation> {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return { ok: false, error: "Invalid host." };
  return await withDb(async (c) => {
    const existing = await getLinkWithClient(c, normalizedHost, app.id);
    if (!existing) return { ok: false, error: "Relationship not found." };
    const claimResult = await c.execute({
      sql: `SELECT claimant_did FROM account_host_claim WHERE host = ? LIMIT 1`,
      args: [normalizedHost],
    });
    const hostOwnerDid = value(claimResult.rows[0], "claimant_did");
    const appDids = appIdentityDids(app);
    const did = currentDid.trim();
    const approvesHost = hostOwnerDid === did;
    const approvesApp = appDids.includes(did);
    if (!approvesHost && !approvesApp) {
      return {
        ok: false,
        error: "This account cannot approve either side of the relationship.",
      };
    }
    if (existing.relationship === "host_only" && !approvesHost) {
      return {
        ok: false,
        error: "Only the claimed host owner can approve host-only status.",
      };
    }
    const now = Date.now();
    const currentHostApproval = currentDirectoryOwnerApproval(
      existing.hostApprovedAt,
      existing.hostOwnerDid,
      hostOwnerDid ? [hostOwnerDid] : [],
    );
    const currentAppApproval = currentDirectoryOwnerApproval(
      existing.appApprovedAt,
      existing.appOwnerDid,
      appDids,
    );
    const hostApprovedAt = approvesHost ? now : currentHostApproval;
    const appApprovedAt = existing.relationship === "host_only"
      ? null
      : approvesApp
      ? now
      : currentAppApproval;
    const status = directoryEntityStatusForApprovals(
      existing.relationship,
      hostApprovedAt,
      appApprovedAt,
    );
    await c.execute({
      sql: `UPDATE directory_entity_link SET
        status = ?, host_owner_did = ?, app_owner_did = ?,
        host_approved_at = ?, app_approved_at = ?, updated_at = ?
        WHERE host = ? AND app_listing_id = ?`,
      args: [
        status,
        hostOwnerDid ?? existing.hostOwnerDid,
        approvesApp ? did : existing.appOwnerDid,
        hostApprovedAt,
        appApprovedAt,
        now,
        normalizedHost,
        app.id,
      ],
    });
    const link = await getLinkWithClient(c, normalizedHost, app.id);
    return link
      ? { ok: true, link }
      : { ok: false, error: "Relationship could not be approved." };
  });
}

export async function removeDirectoryEntityLink(input: {
  host: string;
  app: AppListing;
  currentDid: string;
}): Promise<DirectoryEntityLinkMutation> {
  const host = normalizeHost(input.host);
  if (!host) return { ok: false, error: "Invalid host." };
  return await withDb(async (c) => {
    const claimResult = await c.execute({
      sql: `SELECT claimant_did FROM account_host_claim WHERE host = ? LIMIT 1`,
      args: [host],
    });
    const controlsHost = value(claimResult.rows[0], "claimant_did") ===
      input.currentDid.trim();
    const controlsApp = userControlsAppListing(input.app, input.currentDid);
    if (!controlsHost && !controlsApp) {
      return {
        ok: false,
        error: "This account cannot remove the relationship.",
      };
    }
    await c.execute({
      sql: `DELETE FROM directory_entity_link
        WHERE host = ? AND app_listing_id = ?`,
      args: [host, input.app.id],
    });
    return { ok: true };
  });
}

function rowToAppLink(input: unknown): DirectoryEntityAppLink | null {
  const link = rowToLink(input);
  const appSlug = value(input, "app_slug");
  const appName = value(input, "app_name");
  const hostDisplayName = value(input, "host_display_name");
  return link && appSlug && appName && hostDisplayName
    ? { ...link, appSlug, appName, hostDisplayName }
    : null;
}

function rowToLink(input: unknown): DirectoryEntityLink | null {
  const host = value(input, "host");
  const appListingId = value(input, "app_listing_id");
  const relationship = value(input, "relationship");
  const status = value(input, "status");
  const source = value(input, "source");
  const hostOwnerDid = value(input, "host_owner_did");
  const appOwnerDid = value(input, "app_owner_did");
  if (
    !host || !appListingId || !isDirectoryEntityRelationship(relationship) ||
    (status !== "pending" && status !== "verified") ||
    (source !== "claimed" && source !== "seeded") ||
    !hostOwnerDid || !appOwnerDid
  ) return null;
  return {
    host,
    appListingId,
    relationship,
    status,
    source,
    hostOwnerDid,
    appOwnerDid,
    hostApprovedAt: numberValue(input, "host_approved_at"),
    appApprovedAt: numberValue(input, "app_approved_at"),
    createdAt: numberValue(input, "created_at") ?? 0,
    updatedAt: numberValue(input, "updated_at") ?? 0,
  };
}

function linkIsCurrentlyAuthorized(
  row: unknown,
  link: DirectoryEntityLink,
): boolean {
  const appDids = [
    value(row, "product_did"),
    value(row, "profile_did"),
    value(row, "legacy_profile_did"),
  ].filter((did): did is string => Boolean(did));
  if (!appDids.includes(link.appOwnerDid)) return false;
  if (link.source === "seeded") return true;
  return value(row, "claimant_did") === link.hostOwnerDid;
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(
    /\/$/,
    "",
  );
}

function value(input: unknown, key: string): string | null {
  if (!input || typeof input !== "object") return null;
  const raw = (input as Record<string, unknown>)[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function numberValue(input: unknown, key: string): number | null {
  if (!input || typeof input !== "object") return null;
  const raw = (input as Record<string, unknown>)[key];
  const number = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(number) ? number : null;
}

async function getLinkWithClient(
  c: DbClient,
  host: string,
  appListingId: string,
): Promise<DirectoryEntityLink | null> {
  const result = await c.execute({
    sql: `SELECT * FROM directory_entity_link
      WHERE host = ? AND app_listing_id = ? LIMIT 1`,
    args: [host, appListingId],
  });
  return result.rows.length > 0 ? rowToLink(result.rows[0]) : null;
}
