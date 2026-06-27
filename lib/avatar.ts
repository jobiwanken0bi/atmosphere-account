/**
 * Bluesky's public CDN is the preferred display path for avatar-shaped
 * AT Protocol blobs. The user's PDS remains canonical; this only avoids
 * sending hot avatar/icon image traffic through our app server.
 *
 * Keep this behind a helper so we can swap the CDN/proxy strategy later if
 * the ecosystem standardizes a different blob CDN.
 */
export function bskyCdnAvatarUrl(did: string, cid: string): string {
  return `https://cdn.bsky.app/img/avatar/plain/${did}/${cid}`;
}
