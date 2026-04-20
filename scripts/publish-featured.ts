/**
 * scripts/publish-featured.ts
 *
 * Publishes (or overwrites) the curated featured directory record on the
 * Atmosphere account's PDS, at:
 *   com.atmosphereaccount.registry.featured/self
 *
 * Input: a JSON file describing the directory. Entries may use either
 * `did` or `handle` (handles are resolved to DIDs before publish):
 *
 *   {
 *     "entries": [
 *       { "did": "did:plc:...", "badges": ["official"], "position": 0 },
 *       { "handle": "tangled.org", "badges": ["verified"] }
 *     ]
 *   }
 *
 * Usage:
 *   deno task publish:featured                  # uses ./featured.json
 *   deno task publish:featured ./mylist.json    # custom path
 *
 * Required env vars:
 *   ATMOSPHERE_DID           — DID of the curator account
 *   TURSO_DATABASE_URL       — must contain a valid OAuth session for
 *                              ATMOSPHERE_DID (sign in once via
 *                              `/oauth/login` to seed it)
 *   OAUTH_PRIVATE_JWK,
 *   OAUTH_PUBLIC_JWK,
 *   OAUTH_KID,
 *   SESSION_SECRET           — same OAuth env used by the web app
 *
 * The indexer ignores featured writes from any account other than the
 * one configured via ATMOSPHERE_DID, so this script must be run for that
 * account.
 */
import { FEATURED_NSID, validateFeatured } from "../lib/lexicons.ts";
import { resolveIdentity } from "../lib/identity.ts";
import { putRecord } from "../lib/pds.ts";
import { getValidSession } from "../lib/oauth.ts";

interface RawEntry {
  did?: string;
  handle?: string;
  badges?: string[];
  position?: number;
}

interface RawFile {
  entries: RawEntry[];
}

async function loadFile(path: string): Promise<RawFile> {
  const text = await Deno.readTextFile(path);
  const json = JSON.parse(text) as Record<string, unknown>;
  if (!Array.isArray(json.entries)) {
    throw new Error(`${path}: missing "entries" array`);
  }
  return { entries: json.entries as RawEntry[] };
}

async function resolveEntries(raw: RawFile): Promise<{
  did: string;
  badges?: string[];
  position?: number;
}[]> {
  const out: { did: string; badges?: string[]; position?: number }[] = [];
  for (const [i, e] of raw.entries.entries()) {
    let did = e.did;
    if (!did) {
      if (!e.handle) throw new Error(`entry ${i}: must have "did" or "handle"`);
      const id = await resolveIdentity(e.handle);
      did = id.did;
      console.log(`[publish-featured] resolved ${e.handle} -> ${did}`);
    }
    out.push({ did, badges: e.badges, position: e.position ?? i });
  }
  return out;
}

async function main() {
  const path = Deno.args[0] ?? "./featured.json";
  const did = Deno.env.get("ATMOSPHERE_DID");
  if (!did) {
    console.error("ATMOSPHERE_DID env var is required.");
    Deno.exit(1);
  }

  const raw = await loadFile(path);
  const entries = await resolveEntries(raw);
  const record = { entries };

  const validation = validateFeatured(record);
  if (!validation.ok || !validation.value) {
    console.error(`Invalid featured record: ${validation.error}`);
    Deno.exit(1);
  }

  const session = await getValidSession(did);
  if (!session) {
    console.error(
      `No active OAuth session for ${did}. Sign in once via /oauth/login as ` +
        `the Atmosphere account, then re-run this script.`,
    );
    Deno.exit(1);
  }

  const result = await putRecord(
    did,
    session.pdsUrl,
    FEATURED_NSID,
    "self",
    record as unknown as Record<string, unknown>,
  );
  console.log(`[publish-featured] put ${result.uri} cid=${result.cid}`);
  console.log(
    `[publish-featured] indexer will pick up the change via Jetstream within seconds.`,
  );
}

if (import.meta.main) {
  await main();
}
