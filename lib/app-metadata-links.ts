import type { AppDirectoryLink } from "./app-lexicons.ts";

export type AppMetadataLinkKind =
  | "privacy"
  | "terms"
  | "scopes"
  | "oauth_metadata";

/**
 * Classify metadata links without depending on one producer's exact role
 * vocabulary. ATStore and community app records both use human-readable
 * labels alongside namespaced role fragments.
 */
export function appMetadataLinkKind(
  link: Pick<AppDirectoryLink, "uri" | "label" | "role">,
): AppMetadataLinkKind | null {
  const text = `${link.role ?? ""} ${link.label ?? ""}`.toLowerCase();
  const path = safePathname(link.uri);

  if (
    text.includes("oauth client metadata") ||
    text.includes("oauth-client-metadata") ||
    text.includes("client_metadata") ||
    text.includes("client metadata") ||
    path.includes("oauth-client-metadata") ||
    path.includes("oauth/client-metadata")
  ) return "oauth_metadata";

  if (
    text.includes("privacy") || text.includes("policy") ||
    /\/(privacy|privacy-policy)(?:\/|$)/.test(path)
  ) return "privacy";

  if (
    text.includes("terms") || /(?:^|[#/_-])tos(?:$|[#/_-])/.test(text) ||
    /\/(terms|terms-of-service|tos)(?:\/|$)/.test(path)
  ) return "terms";

  if (text.includes("scope") || text.includes("permission")) return "scopes";
  return null;
}

function safePathname(value: string): string {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return "";
  }
}
