/**
 * Additive Login with Atmosphere ownership migration.
 *
 * `login_app` predates the one-DID-per-app model. Keep its identity columns as
 * an internal trust snapshot, but bind every owner-created client environment
 * to the stable URI of one live app profile. The backfill deliberately links a
 * legacy row only when its contact DID controls exactly one non-deleted app.
 * Ambiguous, host-only, and otherwise orphaned rows remain present but fail
 * closed as `relink_required`. They are never guessed into a profile.
 */
export const LOGIN_APP_LINK_BACKFILL_STATEMENTS = [
  `UPDATE login_app
    SET app_did = contact_did,
        app_profile_uri = (
          SELECT MIN(l.canonical_uri)
          FROM app_listing l
          WHERE l.deleted_at IS NULL
            AND (
              l.product_did = login_app.contact_did OR
              l.profile_did = login_app.contact_did OR
              l.legacy_profile_did = login_app.contact_did
            )
        ),
        link_status = 'linked'
    WHERE app_did IS NULL
      AND contact_did IS NOT NULL
      AND (
        SELECT COUNT(*)
        FROM app_listing l
        WHERE l.deleted_at IS NULL
          AND (
            l.product_did = login_app.contact_did OR
            l.profile_did = login_app.contact_did OR
            l.legacy_profile_did = login_app.contact_did
          )
      ) = 1`,
  `UPDATE login_app
    SET link_status = 'relink_required'
    WHERE app_did IS NULL
      AND link_status <> 'relink_required'
      AND link_status <> 'system_fixture'`,
] as const;

/**
 * Give every pre-existing environment an owner-edit revision without changing
 * any identity, trust, or review state. `review_revision` is already an opaque
 * version for most active rows; the deterministic fallback only identifies a
 * legacy row and is not used as an authorization secret.
 */
export const LOGIN_APP_ENVIRONMENT_REVISION_BACKFILL_STATEMENTS = [
  `UPDATE login_app
    SET environment_revision = COALESCE(
      NULLIF(review_revision, ''),
      'legacy:' || client_id
    )
    WHERE COALESCE(environment_revision, '') = ''`,
] as const;
