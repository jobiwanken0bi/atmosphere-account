/**
 * Bluesky's public CDN is a cached proxy for repo blob avatars. Any profile
 * avatar stored as a did/cid pair can use this directly and avoid our app
 * server's PDS blob proxy on hot UI paths.
 */
export function bskyCdnAvatarUrl(did: string, cid: string): string {
  return `https://cdn.bsky.app/img/avatar/plain/${did}/${cid}`;
}
