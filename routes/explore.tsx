import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import GlassClouds from "../components/GlassClouds.tsx";
import Footer from "../components/Footer.tsx";
import StoreHero from "../components/explore/StoreHero.tsx";
import CategoryTabs from "../components/explore/CategoryTabs.tsx";
import SubcategoryChips from "../components/explore/SubcategoryChips.tsx";
import FeaturedRail from "../components/explore/FeaturedRail.tsx";
import ProfileGrid from "../components/explore/ProfileGrid.tsx";
import {
  getProfileByDid,
  listFeaturedProfiles,
  type ProfileRow,
  searchProfiles,
} from "../lib/registry.ts";
import { CATEGORIES } from "../lib/lexicons.ts";

interface ExploreData {
  query: string;
  category: string | null;
  subcategory: string | null;
  page: number;
  pageSize: number;
  total: number;
  profiles: ProfileRow[];
  featured: ProfileRow[];
  signedIn: boolean;
  account: {
    user: { did: string; handle: string } | null;
    avatarUrl: string | null;
    publicProfileHandle: string | null;
  };
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = ctx.url;
    const rawCategory = url.searchParams.get("category");
    const category =
      rawCategory && (CATEGORIES as readonly string[]).includes(rawCategory)
        ? rawCategory
        : null;
    const subcategory = url.searchParams.get("subcategory");
    const query = url.searchParams.get("q")?.trim() ?? "";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

    /** When signed in, look up the registry profile alongside the
     *  search/featured queries so the AccountMenu can show the user's
     *  registered handle (and link to their public profile) in one
     *  round-trip instead of an extra request after page load. */
    const user = ctx.state.user;
    const ownerProfilePromise = user
      ? getProfileByDid(user.did).catch(() => null)
      : Promise.resolve(null);

    const [search, featured, ownerProfile] = await Promise.all([
      searchProfiles({
        query: query || undefined,
        category: category ?? undefined,
        subcategory: subcategory && category === "app"
          ? subcategory
          : undefined,
        page,
      }).catch(() => ({ profiles: [], total: 0, page, pageSize: 24 })),
      // Hide the featured rail when filters are active so the homepage
      // looks like a store but filtered pages stay focused.
      !category && !query
        ? listFeaturedProfiles(8).catch(() => [])
        : Promise.resolve([] as ProfileRow[]),
      ownerProfilePromise,
    ]);

    const data: ExploreData = {
      query,
      category,
      subcategory: category === "app" ? subcategory : null,
      page,
      pageSize: search.pageSize,
      total: search.total,
      profiles: search.profiles,
      featured,
      signedIn: !!user,
      account: {
        user: user ? { did: user.did, handle: user.handle } : null,
        avatarUrl: user ? "/api/me/avatar" : null,
        publicProfileHandle: ownerProfile?.handle ?? null,
      },
    };
    return ctx.render(<ExplorePage data={data} locale={ctx.state.locale} />);
  },
});

interface ExplorePageProps {
  data: ExploreData;
  locale: string;
}

function ExplorePage({ data, locale: _locale }: ExplorePageProps) {
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav account={data.account} />
        <StoreHero
          initialQuery={data.query}
          signedIn={data.signedIn}
        />
        <section class="explore-controls">
          <div class="container">
            <CategoryTabs active={data.category} query={data.query} />
            {data.category === "app" && (
              <SubcategoryChips
                active={data.subcategory}
                query={data.query}
              />
            )}
          </div>
        </section>

        {data.featured.length > 0 && <FeaturedRail profiles={data.featured} />}

        <section class="section">
          <div class="container">
            <ProfileGrid profiles={data.profiles} />
          </div>
        </section>

        <Footer variant="compact" />
      </div>
    </div>
  );
}
