function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") {
    return true;
  }
  const ipv4 = host.split(".").map(Number);
  return ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    ipv4[0] === 127;
}

function isObviouslyPrivateHostname(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  if (
    isLoopbackHostname(host) || host.endsWith(".local") ||
    host.endsWith(".internal") || host.endsWith(".home.arpa") ||
    host.endsWith(".test") || host.endsWith(".invalid") ||
    host.endsWith(".example") || host.endsWith(".onion") ||
    host === "0.0.0.0" || host === "::" || host.startsWith("::")
  ) return true;
  const ipv4 = host.split(".").map(Number);
  if (
    ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const [a, b, c] = ipv4;
    return a === 0 || a === 10 || a === 127 ||
      a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 ||
      a === 192 && b === 0 && (c === 0 || c === 2) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
      a === 203 && b === 0 && c === 113 ||
      a >= 224;
  }
  // A bare DNS label may resolve through a local search domain and is never a
  // suitable cross-origin production handoff target.
  if (!host.includes(":") && !host.includes(".")) return true;
  return host.startsWith("fc") || host.startsWith("fd") ||
    /^fe[89ab]/.test(host) || host.startsWith("ff");
}

/** Validate a server-provided browser destination before assigning it to
 * location. Production handoffs may legitimately leave this origin, but only
 * for public HTTPS. Local HTTP is limited to loopback development. */
export function safeBrowserNavigationUrl(
  value: unknown,
  currentHref: string,
): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let current: URL;
  let target: URL;
  try {
    current = new URL(currentHref);
    target = new URL(value, current);
  } catch {
    return null;
  }
  if (target.username || target.password) return null;
  if (target.origin === current.origin) {
    return target.protocol === "http:" || target.protocol === "https:"
      ? target.toString()
      : null;
  }
  if (
    target.protocol === "https:" &&
    !isObviouslyPrivateHostname(target.hostname)
  ) return target.toString();
  if (
    target.protocol === "http:" && isLoopbackHostname(current.hostname) &&
    isLoopbackHostname(target.hostname)
  ) return target.toString();
  return null;
}
