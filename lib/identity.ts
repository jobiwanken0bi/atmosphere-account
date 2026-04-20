/**
 * atproto identity helpers: resolve handles to DIDs, fetch DID documents,
 * and locate the PDS service endpoint for an account.
 *
 * Spec: https://atproto.com/specs/handle, https://atproto.com/specs/did
 */

const PUBLIC_RESOLVER = "https://public.api.bsky.app";
const PLC_DIRECTORY = "https://plc.directory";

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

const handleRe =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const didRe = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;

export function isHandle(s: string): boolean {
  return handleRe.test(s);
}

export function isDid(s: string): boolean {
  return didRe.test(s);
}

/**
 * Resolve a handle to a DID. Tries DNS-over-HTTPS first (TXT _atproto.<handle>),
 * then falls back to the well-known HTTPS endpoint, then the public Bluesky
 * resolver as a last resort.
 */
export async function resolveHandle(handle: string): Promise<string> {
  const lower = handle.toLowerCase();
  if (!isHandle(lower)) throw new Error(`invalid handle: ${handle}`);

  // 1. Well-known HTTPS endpoint on the handle's domain
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

  // 2. DNS-over-HTTPS TXT record at _atproto.<handle>
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
        const data = ans.data.replace(/^"|"$/g, "");
        const m = data.match(/did=([^"]+)/);
        if (m && isDid(m[1])) return m[1];
      }
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
  return svc.serviceEndpoint;
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
    const aka = (doc.alsoKnownAs ?? []).find((u) => u.startsWith("at://"));
    handle = aka ? aka.slice("at://".length) : did;
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

/**
 * Discover the authorization server for a PDS. Per the OAuth spec, the
 * PDS publishes a protected-resource metadata file pointing at one or
 * more authorization-server origins; we fetch the AS metadata from there.
 */
export async function discoverAuthServer(
  pdsUrl: string,
): Promise<AuthServerMetadata> {
  const pdsOrigin = new URL(pdsUrl).origin;
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
      const pr = await prRes.json() as { authorization_servers?: string[] };
      if (pr.authorization_servers && pr.authorization_servers.length > 0) {
        asOrigin = new URL(pr.authorization_servers[0]).origin;
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
  return await asRes.json() as AuthServerMetadata;
}
