import { withDb } from "./db.ts";
import {
  collectionFallbackLabel,
  isCollectionNsid,
} from "./collection-nsid.ts";

export {
  collectionFallbackLabel,
  isCollectionNsid,
  STORED_COLLECTION_NSID_MAX_LENGTH,
} from "./collection-nsid.ts";

export interface CollectionSuggestion {
  id: string;
  label: string;
  description: string | null;
  common: boolean;
  detected: boolean;
  writesCount: number;
  readsCount: number;
  /** Present when this row came from a published-schema catalog search. */
  published?: boolean;
  /** Optional human-facing catalog page for the published schema. */
  catalogUrl?: string;
}

const COMMON_COLLECTIONS: ReadonlyArray<
  Pick<CollectionSuggestion, "id" | "label" | "description">
> = [
  {
    id: "app.bsky.feed.post",
    label: "Bluesky posts",
    description: "Posts and replies in Bluesky-compatible feeds.",
  },
  {
    id: "app.bsky.feed.like",
    label: "Bluesky likes",
    description: "Likes on posts and other feed records.",
  },
  {
    id: "app.bsky.feed.repost",
    label: "Bluesky reposts",
    description: "Reposts of feed records.",
  },
  {
    id: "app.bsky.graph.follow",
    label: "Follows",
    description: "Account-to-account follow relationships.",
  },
  {
    id: "app.bsky.graph.block",
    label: "Blocks",
    description: "Account block relationships.",
  },
  {
    id: "app.bsky.actor.profile",
    label: "Bluesky profiles",
    description: "Bluesky display names, bios, and avatars.",
  },
  {
    id: "fyi.atstore.profile",
    label: "ATStore profiles",
    description: "Shared profile metadata used by ATStore apps.",
  },
  {
    id: "fyi.atstore.listing.detail",
    label: "ATStore app listings",
    description: "Shared app-directory listing records.",
  },
  {
    id: "fyi.atstore.listing.review",
    label: "ATStore reviews",
    description: "Reviews attached to shared app listings.",
  },
  {
    id: "fyi.atstore.listing.favorite",
    label: "ATStore favorites",
    description: "Favorites attached to shared app listings.",
  },
  {
    id: "community.lexicon.app.profile",
    label: "Community app profiles",
    description: "Interoperable declarations about an app and its records.",
  },
  {
    id: "account.atmosphere.host.profile",
    label: "Account-host profiles",
    description: "Public metadata for Atmosphere account hosts.",
  },
  {
    id: "account.atmosphere.host.service",
    label: "Account-host services",
    description: "Account-host service and capability declarations.",
  },
];

interface CollectionRoles {
  produces: string[];
  consumes: string[];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseCollectionRoles(value: unknown): CollectionRoles {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { produces: [], consumes: [] };
    }
    const record = parsed as Record<string, unknown>;
    return {
      produces: stringList(record.produces),
      consumes: stringList(record.consumes),
    };
  } catch {
    return { produces: [], consumes: [] };
  }
}

/**
 * Build a searchable collection catalog from three honest sources:
 * common ecosystem records, declarations already indexed in Apps, and
 * collections detected in the signed-in product account's repository.
 * Detection is a suggestion only; it cannot prove what an app reads or
 * what it writes into other people's repositories.
 */
export async function listCollectionSuggestions(
  detectedCollections: string[] = [],
): Promise<CollectionSuggestion[]> {
  const suggestions = new Map<string, CollectionSuggestion>();
  for (const item of COMMON_COLLECTIONS) {
    suggestions.set(item.id, {
      ...item,
      common: true,
      detected: false,
      writesCount: 0,
      readsCount: 0,
    });
  }

  const rows = await withDb(async (db) => {
    const result = await db.execute(`
      SELECT lexicons_json
      FROM app_listing
      WHERE deleted_at IS NULL
      UNION ALL
      SELECT lexicons_json
      FROM profile
      WHERE takedown_status IS NULL
    `);
    return result.rows;
  }).catch(() => []);

  for (const row of rows) {
    const roles = parseCollectionRoles(
      (row as unknown as { lexicons_json?: unknown }).lexicons_json,
    );
    for (const id of new Set(roles.produces.filter(isCollectionNsid))) {
      const current = suggestions.get(id) ?? {
        id,
        label: collectionFallbackLabel(id),
        description: null,
        common: false,
        detected: false,
        writesCount: 0,
        readsCount: 0,
      };
      current.writesCount++;
      suggestions.set(id, current);
    }
    for (const id of new Set(roles.consumes.filter(isCollectionNsid))) {
      const current = suggestions.get(id) ?? {
        id,
        label: collectionFallbackLabel(id),
        description: null,
        common: false,
        detected: false,
        writesCount: 0,
        readsCount: 0,
      };
      current.readsCount++;
      suggestions.set(id, current);
    }
  }

  for (
    const id of new Set(
      detectedCollections.map((item) => item.trim()).filter(isCollectionNsid),
    )
  ) {
    const current = suggestions.get(id) ?? {
      id,
      label: collectionFallbackLabel(id),
      description: null,
      common: false,
      detected: false,
      writesCount: 0,
      readsCount: 0,
    };
    current.detected = true;
    suggestions.set(id, current);
  }

  const sorted = [...suggestions.values()].sort((a, b) =>
    Number(b.detected) - Number(a.detected) ||
    (b.writesCount + b.readsCount) - (a.writesCount + a.readsCount) ||
    Number(b.common) - Number(a.common) ||
    a.id.localeCompare(b.id)
  );
  const pinned = [
    ...sorted.filter((item) => item.common),
    ...sorted.filter((item) => item.detected && !item.common),
  ].slice(0, 300);
  const keep = new Set(pinned.map((item) => item.id));
  for (const item of sorted) {
    if (keep.size >= 300) break;
    keep.add(item.id);
  }
  return sorted.filter((item) => keep.has(item.id));
}
