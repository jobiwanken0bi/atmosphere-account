import { ATMOSPHERE_DID, IS_DEV } from "./env.ts";
import {
  isJsonMediaType,
  isPrivateNetworkHostname,
  readResponseTextWithLimit,
} from "./security.ts";
import { fetchPinnedPublicHttps } from "./pinned-public-https.ts";

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
const MAX_DID_LENGTH = 2_048;
const MAX_DNS_JSON_BYTES = 64 * 1024;
const MAX_WELL_KNOWN_DID_BYTES = 4 * 1024;
const MAX_IDENTITY_JSON_BYTES = 256 * 1024;
const DNS_RESOLUTION_TIMEOUT_MS = 3_000;
const RESERVED_HANDLE_SUFFIXES = [
  ".localhost",
  ".local",
  ".test",
  ".invalid",
  ".example",
  ".onion",
  ".home.arpa",
] as const;

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

export interface IdentityResolutionOptions {
  /** Test seam for authoritative HTTPS resources. Production callers omit it
   * and use IP-pinned, certificate-verified requests. */
  publicHttpsFetch?: typeof fetch;
}

const didRe = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;

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
  return s.length <= MAX_DID_LENGTH && didRe.test(s);
}

function isReservedHandle(handle: string): boolean {
  const normalized = `.${handle.toLowerCase().replace(/\.$/, "")}`;
  return RESERVED_HANDLE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function isProductionHandleAllowedForTest(handle: string): boolean {
  return isHandle(handle) && !isReservedHandle(handle);
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  return isPrivateNetworkHostname(hostname);
}

export function normalizeServiceEndpoint(endpoint: string): string {
  const url = parseSafeEndpointUrl(endpoint);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("service endpoint must be an origin");
  }
  return url.origin;
}

function parseSafeEndpointUrl(endpoint: string): URL {
  if (!endpoint || endpoint.length > 2_048) {
    throw new Error("unsafe service endpoint length");
  }
  const url = new URL(endpoint);
  if (url.username || url.password) {
    throw new Error("unsafe service endpoint credentials");
  }
  if (url.protocol !== "https:" && !(IS_DEV && url.protocol === "http:")) {
    throw new Error(`unsafe service endpoint protocol: ${endpoint}`);
  }
  if (!IS_DEV && isPrivateOrLocalHostname(url.hostname)) {
    throw new Error(`unsafe service endpoint host: ${endpoint}`);
  }
  return url;
}

function normalizeDnsTxtValue(data: string): string {
  const trimmed = data.trim();
  if (!trimmed.startsWith('"')) return trimmed;

  // DNS JSON presents split TXT character-strings as adjacent quoted chunks.
  // Parse those chunks in one forward pass: the previous nested regexp could
  // take super-linear time on a long, unterminated escape-heavy answer.
  let result = "";
  let position = 0;
  while (position < trimmed.length) {
    if (trimmed[position] !== '"') return "";
    position++;
    let closed = false;
    while (position < trimmed.length) {
      const character = trimmed[position++];
      if (character === '"') {
        closed = true;
        break;
      }
      if (character !== "\\") {
        result += character;
        continue;
      }
      if (position >= trimmed.length) return "";

      const first = trimmed.charCodeAt(position);
      const second = trimmed.charCodeAt(position + 1);
      const third = trimmed.charCodeAt(position + 2);
      if (
        isAsciiDigitCode(first) && isAsciiDigitCode(second) &&
        isAsciiDigitCode(third)
      ) {
        const code = (first - 0x30) * 100 + (second - 0x30) * 10 +
          (third - 0x30);
        if (code > 255) return "";
        result += String.fromCharCode(code);
        position += 3;
      } else {
        // DNS master-file escaping permits a backslash before a literal.
        result += trimmed[position++];
      }
    }
    if (!closed) return "";
    while (position < trimmed.length && isDnsTxtWhitespace(trimmed[position])) {
      position++;
    }
    if (position < trimmed.length && trimmed[position] !== '"') return "";
  }
  return result.trim();
}

function isAsciiDigitCode(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isDnsTxtWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\r" ||
    character === "\n";
}

export function normalizeDnsTxtValueForTest(data: string): string {
  return normalizeDnsTxtValue(data);
}

/**
 * Resolve a handle to a DID. Tries DNS-over-HTTPS first (TXT _atproto.<handle>),
 * then falls back to the well-known HTTPS endpoint, then the public Bluesky
 * resolver as a last resort.
 */
export async function resolveHandle(
  handle: string,
  options: IdentityResolutionOptions = {},
): Promise<string> {
  const lower = handle.toLowerCase();
  if (!isHandle(lower)) throw new Error(`invalid handle: ${handle}`);
  if (lower === ATMOSPHERE_ACCOUNT_HANDLE) {
    return ATMOSPHERE_DID || ATMOSPHERE_ACCOUNT_DID;
  }
  if (!IS_DEV && isReservedHandle(lower)) {
    throw new Error(`reserved handle host: ${handle}`);
  }
  if (!IS_DEV && isPrivateOrLocalHostname(lower)) {
    throw new Error(`unsafe handle host: ${handle}`);
  }

  const authoritative = await resolveHandleFromAuthority(
    lower,
    IS_DEV ? options.publicHttpsFetch : undefined,
  );
  if (authoritative) return authoritative;

  // 3. Public Bluesky resolver (com.atproto.identity.resolveHandle)
  const r = await fetch(
    `${PUBLIC_RESOLVER}/xrpc/com.atproto.identity.resolveHandle?handle=${
      encodeURIComponent(lower)
    }`,
    {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    },
  );
  if (!r.ok) throw new Error(`could not resolve handle: ${handle}`);
  const json = await readBoundedJson(r, MAX_IDENTITY_JSON_BYTES) as {
    did: string;
  };
  if (!isDid(json.did)) {
    throw new Error(`resolver returned invalid DID for ${handle}`);
  }
  return json.did;
}

/**
 * Resolve only from the handle domain's own AT Protocol authorities. Unlike
 * `resolveHandle`, this never falls back to a third-party public resolver, so
 * it is suitable when the handle itself is being used as current domain proof.
 */
export async function resolveHandleAuthority(
  handle: string,
  options: IdentityResolutionOptions = {},
): Promise<string> {
  const lower = handle.toLowerCase();
  if (!isHandle(lower)) throw new Error(`invalid handle: ${handle}`);
  if (!IS_DEV && isReservedHandle(lower)) {
    throw new Error(`reserved handle host: ${handle}`);
  }
  if (!IS_DEV && isPrivateOrLocalHostname(lower)) {
    throw new Error(`unsafe handle host: ${handle}`);
  }
  const did = await resolveHandleFromAuthority(
    lower,
    IS_DEV ? options.publicHttpsFetch : undefined,
  );
  if (!did) throw new Error(`handle domain did not resolve: ${handle}`);
  return did;
}

async function resolveHandleFromAuthority(
  lower: string,
  publicHttpsFetch?: typeof fetch,
): Promise<string | null> {
  // 1. DNS-over-HTTPS TXT record at _atproto.<handle>
  let conflictingDnsClaims = false;
  try {
    const r = await fetch(
      `https://cloudflare-dns.com/dns-query?name=_atproto.${
        encodeURIComponent(lower)
      }&type=TXT`,
      {
        headers: { accept: "application/dns-json" },
        redirect: "manual",
        signal: AbortSignal.timeout(4000),
      },
    );
    if (r.ok) {
      const json = await readBoundedJson(r, MAX_DNS_JSON_BYTES) as {
        Answer?: Array<{ data: string }>;
      };
      const answers = new Set<string>();
      for (const ans of json.Answer ?? []) {
        if (!ans || typeof ans.data !== "string") continue;
        const data = normalizeDnsTxtValue(ans.data);
        const m = data.match(/^did=(.+)$/);
        if (m && isDid(m[1])) answers.add(m[1]);
      }
      if (answers.size === 1) return [...answers][0];
      conflictingDnsClaims = answers.size > 1;
    }
  } catch {
    // fall through
  }
  if (conflictingDnsClaims) {
    throw new Error(`conflicting DNS handle claims for ${lower}`);
  }

  // 2. Well-known HTTPS endpoint on the handle's domain
  try {
    const url = `https://${lower}/.well-known/atproto-did`;
    const r = await (publicHttpsFetch ?? pinnedIdentityFetch)(url, {
      headers: { accept: "text/plain" },
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    if (r.ok) {
      const body = await readResponseTextWithLimit(
        r,
        MAX_WELL_KNOWN_DID_BYTES,
      );
      const text = body.ok ? body.text.trim() : "";
      if (isDid(text)) return text;
    }
  } catch {
    // fall through
  }

  return null;
}

function didWebDocumentUrl(
  did: string,
  allowDevelopmentPaths: boolean,
): string {
  const methodId = did.slice("did:web:".length);
  if (!methodId) throw new Error("invalid did:web identifier");
  // AT Protocol's did:web profile is origin-only. The sole development
  // exception is an explicitly encoded loopback authority with an optional
  // port (for example did:web:localhost%3A3000); generic DID Web path forms
  // remain rejected even in development.
  if (methodId.includes(":") || methodId.includes("%")) {
    if (!allowDevelopmentPaths || methodId.includes(":")) {
      throw new Error("path-based did:web identifiers are not supported");
    }
    let authority: string;
    try {
      authority = decodeURIComponent(methodId);
    } catch {
      throw new Error("invalid encoded did:web authority");
    }
    let loopback: URL;
    try {
      loopback = new URL(`http://${authority}`);
    } catch {
      throw new Error("invalid development did:web authority");
    }
    if (
      loopback.username || loopback.password || loopback.pathname !== "/" ||
      loopback.search || loopback.hash ||
      !isExplicitLoopbackHostname(loopback.hostname)
    ) {
      throw new Error("development did:web must use a loopback authority");
    }
    return `${loopback.origin}/.well-known/did.json`;
  }

  const host = methodId.toLowerCase();
  if (allowDevelopmentPaths && isExplicitLoopbackHostname(host)) {
    return `http://${host}/.well-known/did.json`;
  }
  if (!isHandle(host) || (!allowDevelopmentPaths && isReservedHandle(host))) {
    throw new Error("did:web must use a public DNS hostname");
  }
  return `https://${host}/.well-known/did.json`;
}

function isExplicitLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  const octets = host.split(".").map(Number);
  return octets.length === 4 && octets[0] === 127 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
}

export function didWebDocumentUrlForTest(
  did: string,
  allowDevelopmentPaths = false,
): string {
  return didWebDocumentUrl(did, allowDevelopmentPaths);
}

type AddressRecordType = "A" | "AAAA";
type AddressResolver = (
  hostname: string,
  type: AddressRecordType,
) => Promise<string[]>;

const systemAddressResolver: AddressResolver = async (hostname, type) =>
  await Deno.resolveDns(hostname, type) as string[];

export async function assertPublicDnsHostname(
  hostname: string,
  resolve: AddressResolver = systemAddressResolver,
): Promise<void> {
  if (isReservedHandle(hostname) || isPrivateOrLocalHostname(hostname)) {
    throw new Error("hostname is private or special-use");
  }
  const lookups = await Promise.allSettled([
    resolveWithTimeout(resolve, hostname, "A"),
    resolveWithTimeout(resolve, hostname, "AAAA"),
  ]);
  const addresses = lookups.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
  if (addresses.length === 0) {
    throw new Error("hostname has no public address records");
  }
  if (addresses.some((address) => isPrivateNetworkHostname(address))) {
    throw new Error("hostname resolves to a private or special-use address");
  }
}

async function resolveWithTimeout(
  resolve: AddressResolver,
  hostname: string,
  type: AddressRecordType,
): Promise<string[]> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      resolve(hostname, type),
      new Promise<string[]>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("DNS resolution timed out")),
          DNS_RESOLUTION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function assertPublicDnsHostnameForTest(
  hostname: string,
  resolve: AddressResolver,
): Promise<void> {
  await assertPublicDnsHostname(hostname, resolve);
}

export async function resolveDidDocument(
  did: string,
  options: IdentityResolutionOptions = {},
): Promise<DidDocument> {
  if (!isDid(did)) throw new Error(`invalid DID: ${did}`);

  if (did.startsWith("did:plc:")) {
    const r = await fetch(`${PLC_DIRECTORY}/${did}`, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error(`PLC directory returned ${r.status} for ${did}`);
    return parseDidDocument(
      await readBoundedJson(r, MAX_IDENTITY_JSON_BYTES),
      did,
    );
  }

  if (did.startsWith("did:web:")) {
    const url = didWebDocumentUrl(did, IS_DEV);
    const parsed = new URL(url);
    if (!IS_DEV && isReservedHandle(parsed.hostname)) {
      throw new Error(`reserved did:web host: ${parsed.hostname}`);
    }
    const publicFetch = parsed.protocol === "https:"
      ? (IS_DEV ? options.publicHttpsFetch : undefined) ?? pinnedIdentityFetch
      : fetch;
    const r = await publicFetch(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error(`did:web returned ${r.status} for ${did}`);
    return parseDidDocument(
      await readBoundedJson(r, MAX_IDENTITY_JSON_BYTES),
      did,
    );
  }

  throw new Error(`unsupported DID method: ${did}`);
}

const pinnedIdentityFetch: typeof fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) =>
  fetchPinnedPublicHttps(
    input instanceof Request ? input.url : input,
    init,
    { maxBodyBytes: MAX_IDENTITY_JSON_BYTES },
  );

export function findPdsEndpoint(doc: DidDocument): string {
  const svc = (doc.service ?? []).find((s) =>
    (s.id === "#atproto_pds" || s.id === `${doc.id}#atproto_pds`) &&
    s.type === "AtprotoPersonalDataServer"
  );
  if (!svc) throw new Error(`no atproto PDS in DID doc for ${doc.id}`);
  const endpoint = normalizeServiceEndpoint(svc.serviceEndpoint);
  if (endpoint !== new URL(endpoint).origin) {
    throw new Error(`atproto PDS endpoint is not an origin for ${doc.id}`);
  }
  return endpoint;
}

/** The AT Protocol DID profile treats the first syntactically valid `at://`
 * handle URI as authoritative. Later handles must never be selected merely
 * because they match a desired value. */
export function authoritativeHandleFromDidDocument(
  doc: DidDocument,
): string | null {
  for (const aka of doc.alsoKnownAs ?? []) {
    if (!aka.startsWith("at://")) continue;
    const handle = aka.slice("at://".length).toLowerCase();
    if (isHandle(handle)) return handle;
  }
  return null;
}

async function verifiedHandleForDid(
  did: string,
  doc: DidDocument,
): Promise<string | null> {
  const handle = authoritativeHandleFromDidDocument(doc);
  if (!handle) return null;
  try {
    return await resolveHandle(handle) === did ? handle : null;
  } catch {
    return null;
  }
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
  const authoritativeHandle = authoritativeHandleFromDidDocument(doc);
  if (authoritativeHandle !== id.toLowerCase()) {
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
  prompt_values_supported?: string[];
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
    const url = parseSafeEndpointUrl(raw);
    if (url.hash) throw new Error("endpoint must not contain a fragment");
    return url.pathname === "/" && !url.search ? url.origin : url.toString();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid authorization server ${field}: ${message}`);
  }
}

function requireMetadataValues(
  record: Record<string, unknown>,
  field: string,
  required: readonly string[],
): string[] {
  const values = record[field];
  if (
    !Array.isArray(values) ||
    !values.every((value): value is string => typeof value === "string") ||
    required.some((value) => !values.includes(value))
  ) {
    throw new Error(
      `authorization server metadata ${field} does not support ${
        required.join(", ")
      }`,
    );
  }
  return values;
}

function requireMetadataTrue(
  record: Record<string, unknown>,
  field: string,
): void {
  if (record[field] !== true) {
    throw new Error(`authorization server metadata requires ${field}`);
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
  if (issuer !== issuerOrigin || issuerOrigin !== expectedOrigin) {
    throw new Error(
      `authorization server issuer must be the expected origin: ${issuer} vs ${expectedOrigin}`,
    );
  }
  requireMetadataValues(record, "response_types_supported", ["code"]);
  requireMetadataValues(record, "grant_types_supported", [
    "authorization_code",
    "refresh_token",
  ]);
  requireMetadataValues(record, "code_challenge_methods_supported", [
    "S256",
  ]);
  requireMetadataValues(record, "token_endpoint_auth_methods_supported", [
    "none",
    "private_key_jwt",
  ]);
  requireMetadataValues(
    record,
    "token_endpoint_auth_signing_alg_values_supported",
    ["ES256"],
  );
  const scopesSupported = requireMetadataValues(record, "scopes_supported", [
    "atproto",
  ]);
  const dpopAlgorithms = requireMetadataValues(
    record,
    "dpop_signing_alg_values_supported",
    ["ES256"],
  );
  requireMetadataTrue(record, "authorization_response_iss_parameter_supported");
  requireMetadataTrue(record, "require_pushed_authorization_requests");
  requireMetadataTrue(record, "client_id_metadata_document_supported");
  if (record.require_request_uri_registration === false) {
    throw new Error(
      "authorization server metadata disables request URI registration",
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
    scopes_supported: scopesSupported,
    dpop_signing_alg_values_supported: dpopAlgorithms,
    prompt_values_supported: Array.isArray(record.prompt_values_supported)
      ? record.prompt_values_supported.filter((v): v is string =>
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
  if (!IS_DEV) await assertPublicDnsHostname(new URL(pdsOrigin).hostname);
  const prRes = await fetch(
    `${pdsOrigin}/.well-known/oauth-protected-resource`,
    {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
    },
  );
  if (prRes.status !== 200) {
    await prRes.body?.cancel().catch(() => {});
    throw new Error("could not fetch protected-resource metadata");
  }
  const pr = jsonRecord(
    await readBoundedJson(prRes, MAX_IDENTITY_JSON_BYTES),
    "protected-resource metadata",
  );
  const resource = normalizeServiceEndpoint(
    stringField(pr, "resource", "protected-resource metadata"),
  );
  if (resource !== pdsOrigin) {
    throw new Error("protected-resource metadata resource did not match PDS");
  }
  if (
    !Array.isArray(pr.authorization_servers) ||
    pr.authorization_servers.length !== 1 ||
    typeof pr.authorization_servers[0] !== "string"
  ) {
    throw new Error(
      "protected-resource metadata must name exactly one authorization server",
    );
  }
  const asEndpoint = normalizeServiceEndpoint(pr.authorization_servers[0]);
  const asOrigin = new URL(asEndpoint).origin;
  if (asEndpoint !== asOrigin) {
    throw new Error("authorization server identifier must be an origin");
  }
  if (!IS_DEV) await assertPublicDnsHostname(new URL(asOrigin).hostname);
  const asRes = await fetch(
    `${asOrigin}/.well-known/oauth-authorization-server`,
    {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
    },
  );
  if (asRes.status !== 200) {
    throw new Error(
      `could not fetch authorization server metadata at ${asOrigin}`,
    );
  }
  return parseAuthServerMetadata(
    await readBoundedJson(asRes, MAX_IDENTITY_JSON_BYTES),
    asOrigin,
  );
}

async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!isJsonMediaType(response.headers.get("content-type"))) {
    await response.body?.cancel().catch(() => {});
    throw new Error("identity endpoint returned a non-JSON response");
  }
  const body = await readResponseTextWithLimit(response, maxBytes);
  if (!body.ok) throw new Error(`identity response ${body.error}`);
  try {
    return JSON.parse(body.text);
  } catch {
    throw new Error("identity endpoint returned invalid JSON");
  }
}

function parseDidDocument(value: unknown, expectedDid: string): DidDocument {
  const record = jsonRecord(value, "DID document");
  if (record.id !== expectedDid) {
    throw new Error("DID document id did not match the requested DID");
  }
  const alsoKnownAs = Array.isArray(record.alsoKnownAs)
    ? record.alsoKnownAs.filter((entry): entry is string =>
      typeof entry === "string" && entry.length <= MAX_DID_LENGTH
    ).slice(0, 64)
    : undefined;
  const service = Array.isArray(record.service)
    ? record.service.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }
      const item = entry as Record<string, unknown>;
      if (
        typeof item.id !== "string" || typeof item.type !== "string" ||
        typeof item.serviceEndpoint !== "string" ||
        item.id.length > 256 || item.type.length > 256 ||
        item.serviceEndpoint.length > 2_048
      ) return [];
      return [{
        id: item.id,
        type: item.type,
        serviceEndpoint: item.serviceEndpoint,
      }];
    }).slice(0, 64)
    : undefined;
  return { id: expectedDid, alsoKnownAs, service };
}
