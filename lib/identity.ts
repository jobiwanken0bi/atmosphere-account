import { ATMOSPHERE_DID, IS_DEV } from "./env.ts";

/**
 * atproto identity helpers: resolve handles to DIDs, fetch DID documents,
 * and locate the PDS service endpoint for an account.
 *
 * Spec: https://atproto.com/specs/handle, https://atproto.com/specs/did
 */

const PUBLIC_RESOLVER = "https://public.api.bsky.app";
const PLC_DIRECTORY = "https://plc.directory";
const ATMOSPHERE_ACCOUNT_HANDLE = "atmosphereaccount.com";
const ATMOSPHERE_ACCOUNT_DID = "did:plc:ab7uvkn4kyf7l7prl26pz4r2";

export interface DidDocument {
  id: string;
  alsoKnownAs?: string[];
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
}

export interface ResolvedIdentity {
  did: string;
  handle: string;
  pdsUrl: string;
  doc: DidDocument;
}

const didRe = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function isHandle(s: string): boolean {
  if (s.length < 3 || s.length > 253) return false;
  if (s !== s.toLowerCase()) return false;
  if (s.startsWith(".") || s.endsWith(".")) return false;
  const labels = s.split(".");
  if (labels.length < 2) return false;
  const labelRe = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return false;
    if (!labelRe.test(label)) return false;
  }
  const tld = labels[labels.length - 1];
  if (!tld || /^[0-9]/.test(tld)) return false;
  return true;
}

export function isDid(s: string): boolean {
  return didRe.test(s);
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" || host === "0.0.0.0" || host === "::1" ||
    host.endsWith(".localhost")
  ) return true;
  const v6 = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host.includes(":")
    ? host
    : null;
  if (v6) {
    return v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") ||
      v6.startsWith("fe80:");
  }
  if (!IPV4_RE.test(host)) return false;
  const parts = host.split(".").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}

export function normalizeServiceEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !(IS_DEV && url.protocol === "http:")) {
    throw new Error(`unsafe service endpoint protocol: ${endpoint}`);
  }
  if (!IS_DEV && isPrivateOrLocalHostname(url.hostname)) {
    throw new Error(`unsafe service endpoint host: ${endpoint}`);
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeDnsTxtValue(data: string): string {
  const matches = [...data.matchAll(/"((?:\\.|[^"])*)"/g)];
  if (matches.length === 0) return data.trim();
  return matches
    .map((match) =>
      match[1].replace(/\\(["\\])/g, "$1").replace(
        /\\(\d{3})/g,
        (_, code) => String.fromCharCode(Number(code)),
      )
    )
    .join("")
    .trim();
}

/**
 * Resolve a handle to a DID. Tries DNS-over-HTTPS first (TXT _atproto.<handle>),
 * then falls back to the well-known HTTPS endpoint, then the public Bluesky
 * resolver as a last resort.
 */
export async function resolveHandle(handle: string): Promise<string> {
  const lower = handle.toLowerCase();
  if (!isHandle(lower)) throw new Error(`invalid handle: ${handle}`);
  if (lower === ATMOSPHERE_ACCOUNT_HANDLE) {
    return ATMOSPHERE_DID || ATMOSPHERE_ACCOUNT_DID;
  }
  if (!IS_DEV && isPrivateOrLocalHostname(lower)) {
    throw new Error(`unsafe handle host: ${handle}`);
  }

  // 1. DNS-over-HTTPS TXT record at _atproto.<handle>
  try {
    const r = await fetch(
      `https://cloudflare-dns.com/dns-query?name=_atproto.${
        encodeURIComponent(lower)
      }&type=TXT`,
      {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (r.ok) {
      const json = await r.json() as {
        Answer?: Array<{ data: string }>;
      };
      for (const ans of json.Answer ?? []) {
        const data = normalizeDnsTxtValue(ans.data);
        const m = data.match(/^did=(.+)$/);
        if (m && isDid(m[1])) return m[1];
      }
    }
  } catch {
    // fall through
  }

  // 2. Well-known HTTPS endpoint on the handle's domain
  try {
    const r = await fetch(`https://${lower}/.well-known/atproto-did`, {
      headers: { accept: "text/plain" },
      signal: AbortSignal.timeout(4000),
    });
    if (r.ok) {
      const text = (await r.text()).trim();
      if (isDid(text)) return text;
    }
  } catch {
    // fall through
  }

  // 3. Public Bluesky resolver (com.atproto.identity.resolveHandle)
  const r = await fetch(
    `${PUBLIC_RESOLVER}/xrpc/com.atproto.identity.resolveHandle?handle=${
      encodeURIComponent(lower)
    }`,
  );
  if (!r.ok) throw new Error(`could not resolve handle: ${handle}`);
  const json = await r.json() as { did: string };
  if (!isDid(json.did)) {
    throw new Error(`resolver returned invalid DID for ${handle}`);
  }
  return json.did;
}

export async function resolveDidDocument(did: string): Promise<DidDocument> {
  if (!isDid(did)) throw new Error(`invalid DID: ${did}`);

  if (did.startsWith("did:plc:")) {
    const r = await fetch(`${PLC_DIRECTORY}/${did}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error(`PLC directory returned ${r.status} for ${did}`);
    return await r.json() as DidDocument;
  }

  if (did.startsWith("did:web:")) {
    const target = did.slice("did:web:".length).split(":").join("/");
    const url = target.includes("/")
      ? `https://${target}/did.json`
      : `https://${target}/.well-known/did.json`;
    const parsed = new URL(url);
    if (!IS_DEV && isPrivateOrLocalHostname(parsed.hostname)) {
      throw new Error(`unsafe did:web host: ${parsed.hostname}`);
    }
    const r = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error(`did:web returned ${r.status} for ${did}`);
    return await r.json() as DidDocument;
  }

  throw new Error(`unsupported DID method: ${did}`);
}

export function findPdsEndpoint(doc: DidDocument): string {
  const svc = (doc.service ?? []).find((s) =>
    s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer"
  );
  if (!svc) throw new Error(`no atproto PDS in DID doc for ${doc.id}`);
  return normalizeServiceEndpoint(svc.serviceEndpoint);
}

function handleCandidatesFromDidDocument(doc: DidDocument): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const aka of doc.alsoKnownAs ?? []) {
    if (!aka.startsWith("at://")) continue;
    const handle = aka.slice("at://".length).toLowerCase();
    if (!isHandle(handle) || seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
  }
  return out;
}

async function verifiedHandleForDid(
  did: string,
  doc: DidDocument,
): Promise<string | null> {
  for (const handle of handleCandidatesFromDidDocument(doc)) {
    try {
      if (await resolveHandle(handle) === did) return handle;
    } catch {
      // Try the next alsoKnownAs handle before falling back to the DID.
    }
  }
  return null;
}

/**
 * Resolve an identifier (handle or DID) end-to-end. Bidirectionally
 * verifies that, when starting from a handle, the resolved DID document
 * lists that handle in alsoKnownAs.
 */
export async function resolveIdentity(
  identifier: string,
): Promise<ResolvedIdentity> {
  const id = identifier.startsWith("@") ? identifier.slice(1) : identifier;
  let did: string;
  let handle: string;
  if (isDid(id)) {
    did = id;
    const doc = await resolveDidDocument(did);
    handle = await verifiedHandleForDid(did, doc) ?? did;
    return { did, handle, pdsUrl: findPdsEndpoint(doc), doc };
  }
  did = await resolveHandle(id);
  const doc = await resolveDidDocument(did);
  const aka = (doc.alsoKnownAs ?? []).map((u) =>
    u.startsWith("at://") ? u.slice(5) : u
  );
  if (!aka.includes(id.toLowerCase())) {
    throw new Error(`handle ${id} does not match DID document for ${did}`);
  }
  handle = id.toLowerCase();
  return { did, handle, pdsUrl: findPdsEndpoint(doc), doc };
}

export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  pushed_authorization_request_endpoint: string;
  scopes_supported?: string[];
  dpop_signing_alg_values_supported?: string[];
}

function jsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} was not a JSON object`);
  }
  return value as Record<string, unknown>;
}

function stringField(
  record: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} missing ${field}`);
  }
  return value;
}

function normalizeAuthServerUrl(raw: string, field: string): string {
  try {
    return normalizeServiceEndpoint(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid authorization server ${field}: ${message}`);
  }
}

function parseAuthServerMetadata(
  value: unknown,
  expectedOrigin: string,
): AuthServerMetadata {
  const record = jsonRecord(value, "authorization server metadata");
  const issuer = normalizeAuthServerUrl(
    stringField(record, "issuer", "authorization server metadata"),
    "issuer",
  );
  const issuerOrigin = new URL(issuer).origin;
  if (issuerOrigin !== expectedOrigin) {
    throw new Error(
      `authorization server issuer origin mismatch: ${issuerOrigin} vs ${expectedOrigin}`,
    );
  }
  const authorizationEndpoint = normalizeAuthServerUrl(
    stringField(
      record,
      "authorization_endpoint",
      "authorization server metadata",
    ),
    "authorization_endpoint",
  );
  const tokenEndpoint = normalizeAuthServerUrl(
    stringField(record, "token_endpoint", "authorization server metadata"),
    "token_endpoint",
  );
  const parEndpoint = normalizeAuthServerUrl(
    stringField(
      record,
      "pushed_authorization_request_endpoint",
      "authorization server metadata",
    ),
    "pushed_authorization_request_endpoint",
  );
  for (
    const [field, endpoint] of [
      ["authorization_endpoint", authorizationEndpoint],
      ["token_endpoint", tokenEndpoint],
      ["pushed_authorization_request_endpoint", parEndpoint],
    ] as const
  ) {
    if (new URL(endpoint).origin !== issuerOrigin) {
      throw new Error(
        `authorization server ${field} origin does not match issuer`,
      );
    }
  }
  return {
    issuer,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    pushed_authorization_request_endpoint: parEndpoint,
    scopes_supported: Array.isArray(record.scopes_supported)
      ? record.scopes_supported.filter((v): v is string =>
        typeof v === "string"
      )
      : undefined,
    dpop_signing_alg_values_supported: Array.isArray(
        record.dpop_signing_alg_values_supported,
      )
      ? record.dpop_signing_alg_values_supported.filter((v): v is string =>
        typeof v === "string"
      )
      : undefined,
  };
}

/**
 * Discover the authorization server for a PDS. Per the OAuth spec, the
 * PDS publishes a protected-resource metadata file pointing at one or
 * more authorization-server origins; we fetch the AS metadata from there.
 */
export async function discoverAuthServer(
  pdsUrl: string,
): Promise<AuthServerMetadata> {
  const pdsOrigin = new URL(normalizeServiceEndpoint(pdsUrl)).origin;
  let asOrigin = pdsOrigin;
  try {
    const prRes = await fetch(
      `${pdsOrigin}/.well-known/oauth-protected-resource`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (prRes.ok) {
      const pr = jsonRecord(
        await prRes.json(),
        "protected-resource metadata",
      );
      const authorizationServers = Array.isArray(pr.authorization_servers)
        ? pr.authorization_servers.filter((v): v is string =>
          typeof v === "string" && v.length > 0
        )
        : [];
      if (authorizationServers.length > 0) {
        asOrigin = new URL(
          normalizeServiceEndpoint(authorizationServers[0]),
        ).origin;
      }
    }
  } catch {
    // Fall back to PDS origin as the authorization server.
  }
  const asRes = await fetch(
    `${asOrigin}/.well-known/oauth-authorization-server`,
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    },
  );
  if (!asRes.ok) {
    throw new Error(
      `could not fetch authorization server metadata at ${asOrigin}`,
    );
  }
  return parseAuthServerMetadata(await asRes.json(), asOrigin);
}
