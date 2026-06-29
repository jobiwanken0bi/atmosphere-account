import type { AppListingDraft } from "../lib/app-lexicons.ts";

Deno.env.set("ATMOSPHERE_DB_BACKEND", "turso");
Deno.env.set("TURSO_DATABASE_URL", "file:./local.db");
Deno.env.delete("TURSO_AUTH_TOKEN");
Deno.env.delete("NEON_DATABASE_URL");
Deno.env.delete("NEON_DIRECT_DATABASE_URL");

const { ATSTORE_LISTING_NSID } = await import("../lib/app-lexicons.ts");
const {
  rescoreAppDirectoryTrending,
  upsertAppRecordFromDraft,
} = await import("../lib/app-directory.ts");
const { listAccountHosts } = await import("../lib/account-hosts.ts");
const { withDb } = await import("../lib/db.ts");

const now = Date.now();

const apps = [
  {
    slug: "bluesky",
    name: "Bluesky",
    tagline: "A social app for the Atmosphere.",
    description:
      "A familiar microblogging app where many people first use their Atmosphere account.",
    url: "https://bsky.app",
    profile: "https://bsky.app/profile/bsky.app",
    collections: ["social"],
    tags: ["microblogging", "social"],
  },
  {
    slug: "grain",
    name: "Grain",
    tagline: "Long-form writing for AT Protocol.",
    description:
      "A writing and publishing app for articles, essays, and posts that travel with your account.",
    url: "https://grain.social",
    profile: "https://bsky.app/profile/grain.social",
    collections: ["articles", "creative"],
    tags: ["writing", "publishing"],
  },
  {
    slug: "skylights",
    name: "Skylights",
    tagline: "A softer way to discover what is happening.",
    description:
      "An Atmosphere app focused on discovery, reading, and following signals across the network.",
    url: "https://skylights.social",
    profile: "https://bsky.app/profile/skylights.social",
    collections: ["social", "articles"],
    tags: ["discovery", "reader"],
  },
  {
    slug: "rpg.actor",
    name: "RPG Actor",
    tagline: "Roleplay characters for the Atmosphere.",
    description:
      "Create and explore character accounts, worlds, and roleplay profiles that live on the open network.",
    url: "https://rpg.actor",
    profile: "https://bsky.app/profile/rpg.actor",
    collections: ["games", "creative"],
    tags: ["roleplaying", "characters"],
  },
  {
    slug: "syntax.club",
    name: "Syntax Club",
    tagline: "Developer tools and experiments.",
    description:
      "A small developer-focused Atmosphere app for experimenting with AT Protocol data and lexicons.",
    url: "https://syntax.club",
    profile: "https://bsky.app/profile/syntax.club",
    collections: ["developer"],
    tags: ["developer", "tools"],
  },
  {
    slug: "dragonfly",
    name: "Dragonfly",
    tagline: "A fast client for exploring the network.",
    description:
      "A compact app experience for reading, posting, and moving around the Atmosphere.",
    url: "https://dragonfly.blue",
    profile: "https://bsky.app/profile/dragonfly.blue",
    collections: ["social"],
    tags: ["client", "social"],
  },
  {
    slug: "tangled",
    name: "Tangled",
    tagline: "Code collaboration on AT Protocol.",
    description:
      "A developer collaboration app that brings code, issues, and social context into the Atmosphere.",
    url: "https://tangled.sh",
    profile: "https://bsky.app/profile/tangled.org",
    collections: ["developer", "work"],
    tags: ["code", "collaboration"],
  },
  {
    slug: "atpkgs",
    name: "ATPKGS",
    tagline: "Packages and tools for AT Protocol developers.",
    description:
      "A developer directory for packages, libraries, and resources used to build Atmosphere apps.",
    url: "https://atpkgs.com",
    profile: "https://bsky.app/profile/atpkgs.com",
    collections: ["developer"],
    tags: ["packages", "libraries"],
  },
  {
    slug: "aerune",
    name: "Aerune",
    tagline: "Creative tools for open social accounts.",
    description:
      "A creative Atmosphere app for expressive profiles, lightweight publishing, and community experiments.",
    url: "https://aerune.social",
    profile: "https://bsky.app/profile/aerune.social",
    collections: ["creative", "social"],
    tags: ["creative", "community"],
  },
  {
    slug: "spark",
    name: "Spark",
    tagline: "Tools for account-hosted communities.",
    description:
      "A local development fixture representing Spark-style account and community tooling in the Atmosphere.",
    url: "https://sprk.so",
    profile: "https://bsky.app/profile/sprk.so",
    collections: ["account tool", "community"],
    tags: ["spark", "accounts"],
  },
] as const;

const listingIds: string[] = [];

await listAccountHosts();

for (const app of apps) {
  const repoDid = `did:plc:localdev${app.slug.replace(/[^a-z0-9]/g, "")}`;
  const sourceUri = `at://${repoDid}/${ATSTORE_LISTING_NSID}/${app.slug}`;
  const iconUrl = `https://www.google.com/s2/favicons?sz=128&domain=${
    encodeURIComponent(new URL(app.url).hostname)
  }`;
  const draft: AppListingDraft = {
    sourceType: "atstore_listing",
    sourceUri,
    collection: ATSTORE_LISTING_NSID,
    repoDid,
    rkey: app.slug,
    cid: `local-${app.slug}`,
    name: app.name,
    description: app.description,
    tagline: app.tagline,
    slug: app.slug,
    primaryUrl: app.url,
    iconUrl,
    screenshotUrls: [],
    links: [
      { uri: app.url, label: "Explore", role: "web" },
      { uri: app.profile, label: "Bluesky", role: "bsky" },
    ],
    tags: [...app.tags],
    platforms: ["web"],
    categorySlugs: [...app.collections],
    lexiconsProduces: [],
    lexiconsConsumes: [],
    accountIndicators: [],
    productDid: repoDid,
    profileDid: repoDid,
    atstoreListingUri: sourceUri,
    createdAt: now - apps.indexOf(app) * 86_400_000,
    updatedAt: now - apps.indexOf(app) * 43_200_000,
  };
  const listingId = await upsertAppRecordFromDraft({
    draft,
    rawRecord: {
      $type: ATSTORE_LISTING_NSID,
      name: app.name,
      description: app.description,
      url: app.url,
      categorySlugs: app.collections,
      tags: app.tags,
    },
  });
  listingIds.push(listingId);
}

await withDb(async (c) => {
  const featured = listingIds.slice(0, 4);
  for (let index = 0; index < featured.length; index++) {
    await c.execute({
      sql: `
        INSERT INTO app_featured (listing_id, position, label, added_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(listing_id) DO UPDATE SET
          position = excluded.position,
          label = excluded.label
      `,
      args: [featured[index], index + 1, "Local dev", now],
    });
  }
});

await rescoreAppDirectoryTrending();

console.log(
  `[dev:seed] seeded ${apps.length} local app listing(s) and refreshed seeded hosts in local.db`,
);
