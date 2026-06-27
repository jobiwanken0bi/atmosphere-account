import {
  backfillAtstoreListings,
  backfillAtstoreReviewsAndFavorites,
  rescoreAtstoreDirectory,
} from "../lib/atstore-backfill.ts";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return Deno.args.find((item) => item.startsWith(prefix))?.slice(
    prefix.length,
  );
}

function args(name: string): string[] {
  const prefix = `--${name}=`;
  return Deno.args
    .filter((item) => item.startsWith(prefix))
    .map((item) => item.slice(prefix.length));
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const repos = [...args("repo"), ...splitList(arg("repos"))];
const socialRepos = [
  ...args("social-repo"),
  ...splitList(arg("social-repos")),
];

const listings = await backfillAtstoreListings({ repos });
const social = await backfillAtstoreReviewsAndFavorites({
  listingRepos: repos,
  socialRepos,
});
const trending = await rescoreAtstoreDirectory();

console.log(
  `[backfill-atstore] imported ${listings.listingsImported} listing, ${social.reviewsImported} review, ${social.favoritesImported} favorite record(s); failed ${
    listings.recordsFailed + social.recordsFailed
  }`,
);
console.log(`[backfill-atstore] rescored ${trending.rescored} app listing(s)`);
