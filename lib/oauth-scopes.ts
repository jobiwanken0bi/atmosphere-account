/**
 * Scope requested during OAuth.
 *
 * Keep this in sync anywhere the OAuth client metadata is advertised. The
 * named permission set comes first so PDS consent screens can display the
 * branded "Atmosphere Account" label when supported; the direct `repo:*`
 * scopes remain as a fallback.
 */
export const DEFAULT_OAUTH_SCOPE =
  "atproto include:com.atmosphereaccount.registry.fullPermissions repo:com.atmosphereaccount.registry.profile repo:com.atmosphereaccount.registry.review repo:com.atmosphereaccount.registry.update repo:fyi.atstore.profile repo:fyi.atstore.listing.detail repo:fyi.atstore.listing.review repo:fyi.atstore.listing.favorite repo:community.lexicon.app.profile repo:account.atmosphere.host.profile repo:account.atmosphere.host.service blob:image/*";
