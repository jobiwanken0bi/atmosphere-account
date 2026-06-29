const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const IP_GEO_ENDPOINT = "https://ipwho.is";
const REQUEST_TIMEOUT_MS = 4_000;

export interface HostLocationInferenceSuccess {
  ok: true;
  label: string;
  source: "ip_geolocation";
  checkedAt: number;
  detail: string;
  evidence: {
    hostname: string;
    ip: string;
    dnsProvider: "cloudflare-dns";
    geoProvider: "ipwho.is";
    country: string | null;
    region: string | null;
    city: string | null;
    asn: number | null;
    org: string | null;
  };
}

export interface HostLocationInferenceFailure {
  ok: false;
  reason:
    | "invalid_endpoint"
    | "private_endpoint"
    | "dns_failed"
    | "geo_failed"
    | "unavailable";
  message: string;
}

export type HostLocationInferenceResult =
  | HostLocationInferenceSuccess
  | HostLocationInferenceFailure;

interface DnsJsonAnswer {
  type?: number;
  data?: string;
}

interface DnsJsonResponse {
  Status?: number;
  Answer?: DnsJsonAnswer[];
}

interface IpWhoIsResponse {
  success?: boolean;
  message?: string;
  country?: string;
  region?: string;
  city?: string;
  connection?: {
    asn?: number;
    org?: string;
    isp?: string;
  };
}

export async function inferHostNetworkLocation(input: {
  serviceEndpoint?: string | null;
  host?: string | null;
}): Promise<HostLocationInferenceResult> {
  const hostname = hostnameFromInput(input);
  if (!hostname) {
    return {
      ok: false,
      reason: "invalid_endpoint",
      message: "Enter a public PDS service endpoint first.",
    };
  }
  if (isBlockedHostname(hostname)) {
    return {
      ok: false,
      reason: "private_endpoint",
      message:
        "Network location can only be inferred for public hostnames, not local or private endpoints.",
    };
  }

  const ip = await resolvePublicIp(hostname);
  if (!ip) {
    return {
      ok: false,
      reason: "dns_failed",
      message: "Could not resolve a public IP address for that PDS endpoint.",
    };
  }
  if (isBlockedIp(ip)) {
    return {
      ok: false,
      reason: "private_endpoint",
      message:
        "That PDS endpoint resolves to a local or private IP address, so Atmosphere will not infer a location.",
    };
  }

  const geo = await fetchIpGeo(ip);
  if (!geo?.success) {
    return {
      ok: false,
      reason: "geo_failed",
      message:
        "The endpoint resolved, but the network location provider did not return a usable location.",
    };
  }

  const country = stringOrNull(geo.country);
  const region = stringOrNull(geo.region);
  const city = stringOrNull(geo.city);
  const label = locationLabel({ country, region });
  if (!label) {
    return {
      ok: false,
      reason: "geo_failed",
      message:
        "The endpoint resolved, but the network location provider did not return a location label.",
    };
  }

  const checkedAt = Date.now();
  return {
    ok: true,
    label,
    source: "ip_geolocation",
    checkedAt,
    detail:
      `Network lookup suggests this PDS endpoint resolves to ${label}. This is not proof of where account data is stored.`,
    evidence: {
      hostname,
      ip,
      dnsProvider: "cloudflare-dns",
      geoProvider: "ipwho.is",
      country,
      region,
      city,
      asn: typeof geo.connection?.asn === "number" ? geo.connection.asn : null,
      org: stringOrNull(geo.connection?.org) ??
        stringOrNull(geo.connection?.isp),
    },
  };
}

function hostnameFromInput(input: {
  serviceEndpoint?: string | null;
  host?: string | null;
}): string | null {
  const endpoint = input.serviceEndpoint?.trim();
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      if (url.username || url.password) return null;
      return normalizeHostname(url.hostname);
    } catch {
      return normalizeHostname(endpoint);
    }
  }
  return normalizeHostname(input.host);
}

function normalizeHostname(value: string | null | undefined): string | null {
  const host = value?.trim().replace(/^@+/, "").toLowerCase();
  if (!host) return null;
  if (host.includes("/") || host.includes("?") || host.includes("#")) {
    try {
      return new URL(host).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (!host.includes(".")) return null;
  return host.replace(/\.+$/, "");
}

function isBlockedHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname.endsWith(".local") || hostname.endsWith(".test")) return true;
  return false;
}

async function resolvePublicIp(hostname: string): Promise<string | null> {
  const answers = [
    ...(await fetchDnsAnswers(hostname, "A")),
    ...(await fetchDnsAnswers(hostname, "AAAA")),
  ];
  return answers.find((ip) => !isBlockedIp(ip)) ?? null;
}

async function fetchDnsAnswers(
  hostname: string,
  type: "A" | "AAAA",
): Promise<string[]> {
  const url = new URL(DNS_JSON_ENDPOINT);
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", type);
  try {
    const response = await fetchWithTimeout(url, {
      headers: { accept: "application/dns-json" },
    });
    if (!response.ok) return [];
    const json = await response.json() as DnsJsonResponse;
    if (json.Status !== 0) return [];
    const expectedType = type === "A" ? 1 : 28;
    return (json.Answer ?? [])
      .filter((answer) => answer.type === expectedType)
      .map((answer) => answer.data)
      .filter((data): data is string => Boolean(data));
  } catch {
    return [];
  }
}

async function fetchIpGeo(ip: string): Promise<IpWhoIsResponse | null> {
  try {
    const response = await fetchWithTimeout(`${IP_GEO_ENDPOINT}/${ip}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return await response.json() as IpWhoIsResponse;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isBlockedIp(ip: string): boolean {
  if (isBlockedIpv4(ip)) return true;
  const normalized = ip.toLowerCase();
  return normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:");
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224;
}

function locationLabel(
  { country, region }: { country: string | null; region: string | null },
): string | null {
  if (country && region && region.toLowerCase() !== country.toLowerCase()) {
    return `${region}, ${country}`.slice(0, 120);
  }
  return country?.slice(0, 120) ?? null;
}

function stringOrNull(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}
