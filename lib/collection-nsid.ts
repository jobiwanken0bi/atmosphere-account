/**
 * The profile lexicon currently stores collection IDs in 256-character
 * strings, even though the protocol-level NSID ceiling is higher.
 */
export const STORED_COLLECTION_NSID_MAX_LENGTH = 256;

// Reference syntax from https://atproto.com/specs/nsid. The final segment is
// deliberately camelCase-aware; it is case-sensitive and cannot contain '-'.
const COLLECTION_NSID_PATTERN =
  /^[a-zA-Z](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?:\.[a-zA-Z](?:[a-zA-Z0-9]{0,62})?)$/;

export function isCollectionNsid(value: string): boolean {
  if (!value || value.length > STORED_COLLECTION_NSID_MAX_LENGTH) {
    return false;
  }
  if (!COLLECTION_NSID_PATTERN.test(value)) return false;
  const segments = value.split(".");
  const authority = segments.slice(0, -1).join(".");
  return authority.length <= 253;
}

export function collectionFallbackLabel(id: string): string {
  const leaf = id.split(".").at(-1) ?? id;
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
