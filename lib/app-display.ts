import type { AppListing } from "./app-directory.ts";
import {
  appCollectionAliases,
  appCollectionForTag,
  appCollectionLabel,
  normalizeAppCollectionSlug,
  normalizeAppTag,
} from "./app-collections.ts";

export interface AppDisplayTaxonomy {
  collections: string[];
  tags: string[];
}

export function appDisplayTaxonomy(app: AppListing): AppDisplayTaxonomy {
  const collectionKeys = new Set<string>();
  const collections: string[] = [];

  for (const slug of app.categorySlugs) {
    const categoryCollection = categoryCollectionFromSlug(slug);
    if (!categoryCollection) continue;
    const { key, label } = categoryCollection;
    if (collectionKeys.has(key)) continue;
    rememberCollectionKeys(collectionKeys, key);
    collections.push(label);
  }

  if (collections.length === 0) {
    for (const tag of app.tags) {
      const normalized = normalizeAppTag(tag);
      if (!normalized || collectionKeys.has(normalized)) continue;
      const collection = appCollectionForTag(normalized);
      if (!collection) continue;
      rememberCollectionKeys(collectionKeys, collection.tag);
      collections.push(collection.label);
      if (collections.length >= 2) break;
    }
  }

  const tags = app.tags.filter((tag) => {
    const normalized = normalizeAppTag(tag);
    return normalized && !collectionKeys.has(normalized);
  });

  return {
    collections,
    tags: uniqueStrings(tags),
  };
}

export function appPrimaryCollection(app: AppListing): string | null {
  return appDisplayTaxonomy(app).collections[0] ?? null;
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = value.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function rememberCollectionKeys(seen: Set<string>, value: string): void {
  for (const alias of appCollectionAliases(value)) {
    seen.add(alias);
  }
  const normalized = normalizeAppTag(value);
  if (normalized) seen.add(normalized);
}

function categoryCollectionFromSlug(
  slug: string,
): { key: string; label: string } | null {
  const raw = slug.trim().toLowerCase();
  if (!raw || raw === "app" || raw === "apps") return null;
  const parts = raw.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts[0] === "apps") {
    if (parts.length === 2) {
      const collection = appCollectionForTag(parts[1]);
      return collection
        ? { key: collection.tag, label: collection.label }
        : null;
    }
    const leaf = parts.at(-1);
    if (!leaf) return null;
    const collection = appCollectionForTag(leaf);
    return collection
      ? { key: collection.tag, label: collection.label }
      : { key: leaf, label: appCollectionLabel(leaf) };
  }
  const normalized = normalizeAppCollectionSlug(slug);
  if (!normalized || normalized === "app" || normalized === "apps") {
    return null;
  }
  return { key: normalized, label: appCollectionLabel(normalized) };
}
