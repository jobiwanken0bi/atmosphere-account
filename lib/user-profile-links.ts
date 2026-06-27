export type ProfileWebsiteUrlResult =
  | { ok: true; url: string | null }
  | { ok: false; message: string };

export function normalizeProfileWebsiteUrl(
  value: string,
): ProfileWebsiteUrlResult {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, url: null };
  const candidate = trimmed.startsWith("//")
    ? `https:${trimmed}`
    : /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, message: "website must be a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "website must use http or https" };
  }
  if (!url.hostname) {
    return { ok: false, message: "website must include a domain" };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      message: "website must not include a username or password",
    };
  }
  const normalized = url.toString();
  if (normalized.length > 512) {
    return {
      ok: false,
      message: "website URL must be 512 characters or fewer",
    };
  }
  return { ok: true, url: normalized };
}

export function safePublicProfileWebsiteUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const normalized = normalizeProfileWebsiteUrl(value);
  return normalized.ok ? normalized.url : null;
}
