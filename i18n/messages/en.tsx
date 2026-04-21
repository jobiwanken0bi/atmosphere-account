import type { ComponentChildren, VNode } from "preact";

/**
 * Canonical English catalog. The shape exported here defines the `Messages`
 * type that every other locale must satisfy, so adding a key to English
 * automatically requires translating it everywhere else (TS enforced).
 *
 * Conventions:
 *   - Plain strings for short labels.
 *   - String arrays for body paragraphs without inline markup.
 *   - Render functions returning JSX for paragraphs that contain inline
 *     elements (<strong>, <a>, embedded icons, etc). Translators reproduce
 *     the function with the same call signature.
 */
const en = {
  meta: {
    title: "Atmosphere Account — The last social account you'll ever need.",
    description:
      "Your Atmosphere account is your passport to a growing ecosystem of apps. One account, all your data, your choice.",
    ogTitle: "Atmosphere Account",
    ogDescription:
      "The last social account you'll ever need. One account for all your apps.",
    ogImageAlt: "Atmosphere Account — sky, glass clouds, and hero headline",
  },

  nav: {
    logoAlt: "Atmosphere",
    brand: "Atmosphere",
    explore: "Explore",
    exploreComingSoon: "Coming soon",
    protocol: "Protocol",
    effects: "Effects",
    effectsOn:
      "Effects on. Turn off to keep colors and clouds fixed like the first screen.",
    effectsOff:
      "Effects off. Sky matches the first-load colors and cloud positions.",
    account: {
      menuLabel: "Account menu",
      signedInAs: "Signed in as",
      signIn: "Sign in",
      signInHint: "Sign in with your Atmosphere account to publish a profile.",
      manageProfile: "Manage profile",
      viewProfile: "View profile",
      signOut: "Sign out",
      avatarAlt: "Account",
    },
  },

  hero: {
    eyebrow: "Atmosphere Account",
    headline: (): VNode => (
      <>
        The last social account<br />you'll ever need.
      </>
    ),
    subhead: "One account for all your apps. Yours to keep, wherever you go.",
  },

  whatIs: {
    heading: "What is the Atmosphere?",
    paragraphs: [
      (): VNode => (
        <>
          The Atmosphere is a new open network of apps and services that all
          work together. Instead of every app being its own walled garden,
          Atmosphere apps share a common foundation — so you only need{" "}
          <strong>one account</strong> to use them all.
        </>
      ),
      (): VNode => (
        <>
          Your <strong>Atmosphere Account</strong>{" "}
          is your passport to this entire ecosystem. One account unlocks every
          app — no more creating new logins, no more losing your stuff when you
          switch. Sign in once, and you're home everywhere.
        </>
      ),
      (): VNode => (
        <>
          The Atmosphere isn't owned or controlled by any single big-tech
          company. This isn't just another "Sign in with Google", it's an{" "}
          <strong>open social web</strong>.
        </>
      ),
    ],
    footnote: (): VNode => (
      <>
        Of course, you can have <strong>multiple accounts</strong>{" "}
        if you want — great for keeping different personas separate. Whatever
        you choose, every account you own works across the entire Atmosphere.
      </>
    ),
  },

  onePlace: {
    heading: "Everything in one place.",
    body:
      "All your stuff — from every Atmosphere app you use — lives in your one Atmosphere account. Sign in anywhere, pick up right where you left off.",
    examplesLabel:
      "A few examples — there's no fixed list. New apps bring new kinds of data, all in one place.",
    items: [
      "Posts",
      "Likes",
      "Follows",
      "Comments",
      "Lists",
      "Videos",
      "Photos",
      "Blogs",
    ],
    moreTag: "…and many more",
  },

  features: {
    heading: "Built different.",
    items: {
      universalIdentity: {
        title: "Universal identity",
        description:
          "One login across Atmosphere apps, and the same @handle everywhere — so when someone mentions you, it's the same you, recognized across the network.",
      },
      ownAccount: {
        title: "You own your account",
        description:
          "Your data isn't trapped in any one app. Unlike traditional social accounts, where your profile and content belong to the platform, an Atmosphere account puts you in charge — you genuinely own your identity and your data.",
      },
      anyoneBuilds: {
        title: "Anyone can build",
        description:
          "Developers can build new apps on the Atmosphere and tap into an existing network from day one.",
      },
      personalSites: {
        title: "Great for personal websites",
        description:
          "Your @handle can be your own domain. Your identity, your brand — no handle squatting.",
      },
    },
  },

  providers: {
    heading: "Choose your provider.",
    intro: (): VNode => (
      <>
        Your Atmosphere account lives with a <strong>provider</strong>{" "}
        — a service that stores your data in your personal data storage and
        keeps it available across every app. That provider might be an app you
        already use, or a host that only holds accounts. You pick who hosts your
        account, and you can switch any time.
      </>
    ),
    apps: {
      badge: "Most popular",
      name: "Apps",
      body: (blueskyLink: ComponentChildren): VNode => (
        <>
          Apps such as Bluesky {blueskyLink}{" "}
          are also account providers. When you sign up, they provide an account
          for you and your data is hosted by them. Some apps are not account
          providers: they are just apps, and you sign in with an account hosted
          somewhere else.
        </>
      ),
      blueskyAriaLabel: "Bluesky website",
    },
    independent: {
      name: "Independent providers",
      body:
        "Independent providers are account hosts — they are not apps themselves, they only hold your account and data. A growing number of them offer Atmosphere accounts: some are community-run, some focus on privacy or geographic location.",
    },
    selfHost: {
      name: "Self-host",
      body:
        "Technical users can run their own provider. Full control over your data, on your own infrastructure. The Atmosphere is open — anyone can be a provider.",
    },
    footnote:
      "No matter which provider you choose, your account works everywhere and you can move to a different provider at any time — no data lost.",
  },

  crossPollination: {
    heading: "Post once, show everywhere.",
    intro: "Your content flows freely across every app in the Atmosphere.",
    youCreate: "You create",
    itAppearsIn: "It appears in",
    contentTypes: [
      "Blog posts",
      "Photos",
      "Music",
      "Videos",
      "Events",
      "Anything new",
    ],
    destinations: [
      "Social feeds",
      "Galleries",
      "Profiles",
      "Players",
      "Calendars",
      "Apps not yet built",
    ],
    hubLabel: "Your Atmosphere Account",
    hubLogoAlt: "Atmosphere",
    footnote:
      "These are just examples. The Atmosphere is open — any app can create and surface any kind of content. The possibilities grow with every new app that joins.",
  },

  yourChoice: {
    heading: "Your account, your choice.",
    intro:
      "No single company decides what you see, who you follow, or where you go. Everything is yours to control.",
    cards: {
      moderation: {
        title: "Moderation",
        body:
          "Subscribe to community-built moderation — labels, filters, and block lists made by the people who understand the problem best. Don't like an app's rules? Layer on your own, or switch apps entirely.",
      },
      algorithms: {
        title: "Algorithms",
        body:
          "Feeds are open — anyone can build one. Switch between them like playlists: friends-only, indie art, slow news, or something deeply niche. No single algorithm quietly decides culture for everyone.",
      },
      portability: {
        title: "Portability",
        body:
          "Move between apps and providers while keeping your connections, posts, and followers — no more starting over. Creators can leave an app without losing their audience; your followers are yours, not rented from a platform.",
      },
    },
    footnote:
      "Account ownership, moderation, and algorithmic choice — the system is locked open by design.",
  },

  homeCta: {
    headline: "See what's been built.",
    body:
      "Browse apps, account providers, moderators, and infrastructure — all built on the same open foundation.",
    button: "Explore Apps",
  },

  footer: {
    logoAlt: "Atmosphere",
    tagline: "Building a better internet, owned by the people.",
    links: {
      atProtocol: "AT Protocol",
      exploreApps: "Explore Apps",
      exploreAppsTitle: "Coming soon",
      developerResources: "Developer resources",
    },
    quote: (): VNode => (
      <>
        "You never change things by fighting the existing reality. To change
        something, build a new model that makes the existing model obsolete."
        <br />
        <span style={{ opacity: 0.75 }}>— Buckminster Fuller</span>
      </>
    ),
    backToTop: "Back to top",
  },

  appShowcase: {
    heading: "Explore the Atmosphere.",
    intro:
      "A growing ecosystem of apps — all accessible with your one Atmosphere account.",
    footnote: "And many more being built every day.",
    categories: {
      microblogs: "Microblogs",
      video: "Video",
      photos: "Photos",
      blogging: "Blogging",
      events: "Events",
      musicReviews: "Music & Reviews",
      collections: "Collections",
      clients: "Clients",
    },
  },

  developerResources: {
    heading: "For developers.",
    intro:
      "Building an Atmosphere app? Let your users know they can sign in with their Atmosphere account.",
    badgeAlt: "Sign in with your Atmosphere Account",
    downloadBadge: "Download badge (SVG)",
    downloadLogo: "Download logo (SVG)",
    badgeFootnote:
      "Add this badge to your sign-in page to help users understand the Atmosphere.",
    lottieHeading: "Homepage hero animation",
    lottieIntro:
      "The Lottie animation and the image assets embedded inside it (logos and artwork used in the sequence).",
    downloadLottie: "Download Lottie (JSON)",
    downloadIcons: "Download icons (ZIP)",
  },

  lottie: {
    logoAlt: "Atmosphere logo",
  },

  localeSwitcher: {
    label: "Language",
    languageNames: {
      en: "English",
    },
  },

  /**
   * Category labels are intentionally singular — they tag *one* project
   * ("App", "Account provider", etc.). The Explore tabs use the same
   * labels for consistency; "All" stays as the catch-all entry.
   */
  categories: {
    app: "App",
    accountProvider: "Account Provider",
    moderator: "Moderator",
    infrastructure: "Infrastructure",
    developerTool: "Developer Tool",
    all: "All",
  },

  subcategories: {
    microblog: "Microblogs",
    photo: "Photos",
    video: "Video",
    blogging: "Blogging",
    music: "Music",
    events: "Events",
    clients: "Clients",
    tools: "Tools",
    social: "Social",
    reading: "Reading",
    productivity: "Productivity",
  },

  badges: {
    verified: "Verified",
    official: "Official",
  },

  /**
   * Display labels used by `lib/atmosphere-links.ts#resolveLink` when
   * an entry doesn't carry its own label.
   */
  linkKinds: {
    bsky: "Bluesky",
    tangled: "Tangled",
    supper: "Supper",
    website: "Website",
    custom: "Link",
  },

  explore: {
    metaTitle: "Explore — Atmosphere Account",
    metaDescription:
      "Discover apps, account providers, moderators, and infrastructure built for the Atmosphere.",
    heroEyebrow: "Explore",
    heroHeadline: "The Atmosphere, all in one place.",
    heroSubhead:
      "Apps and services in the Atmosphere — built by the community, listed by the people who make them.",
    searchPlaceholder: "Search apps, providers, moderators…",
    searchSubmit: "Search",
    submitYourProject: "Submit your project",
    manageYourProfile: "Manage your profile",
    featured: "Featured",
    browseBy: "Browse by",
    nothingHere: "Nothing here yet.",
    nothingHereSubtle: "Be the first to add a project in this category.",
    viewProfile: "View profile",
    by: "by",
    poweredByYou:
      "Powered by you — every entry is created and signed by the project's own Atmosphere account.",
    detail: {
      openOn: "Open on",
      lastUpdated: "Last updated",
      hostedOn: "Hosted on",
      editProfile: "Edit this profile",
      missingProfile: "We couldn't find a profile for that handle.",
      backToExplore: "Back to Explore",
      categoryLabel: "Category",
      notFoundTitle: "404",
      notFoundBody: "We couldn't find a profile for that handle.",
    },
    create: {
      eyebrow: "Add to Explore",
      headline: "Sign in with your project's Atmosphere account",
      body:
        "Anyone can list a project. Sign in with the account that controls the project — anyone with that account can publish or update the entry. Nothing else is written to your PDS.",
      signInLabel: "Sign in with your Atmosphere handle",
      handlePlaceholder: "yourproject.com",
      signIn: "Sign in",
      configError:
        "OAuth isn't configured on this deployment yet. Try again shortly.",
      previewLoading: "Looking up account…",
      previewNotFound: "No account found for that handle.",
    },
    manage: {
      headline: "Your registry profile",
      subhead:
        "Your entry shows up across Explore. The form is pre-filled from your Bluesky profile if you have one — change anything you like.",
      pulledFromBsky: "Pulled in from your Bluesky profile.",
      publishButton: "Publish profile",
      updateButton: "Update profile",
      savingButton: "Publishing…",
      savedToast: "Saved. It'll appear in the registry shortly.",
      deleteButton: "Remove from Explore",
      deletingButton: "Removing…",
      deletedToast: "Removed from the Explore registry.",
      statusLiveTitle: "Live in Explore",
      statusLiveSub: "Your profile is on the registry and visible to everyone.",
      statusInactiveTitle: "Not on the registry",
      statusInactiveSub:
        "Publish to add this profile to Explore. Nothing is shared until you do.",
      signOut: "Sign out",
      signedInAs: "Signed in as",
    },
  },

  forms: {
    profile: {
      handleLabel: "Signed in as",
      nameLabel: "Project name",
      namePlaceholder: "e.g. Bluesky",
      descriptionLabel: "Short description",
      descriptionPlaceholder: "What does it do? Who's it for?",
      categoryLabel: "Categories",
      categoryHint:
        "Pick all that apply. A project can be both an app and an account provider.",
      subcategoriesLabel: "Subcategories (optional)",
      subcategoriesHint: "For apps. Pick up to a few.",
      avatarLabel: "Project icon",
      avatarHint: "PNG, JPEG, or WebP. 1MB max. Square works best.",
      avatarReplace: "Replace icon",
      avatarRemove: "Remove icon",
      requiredHint: "Required",
      avatarTooLarge: "Avatar must be 1MB or smaller.",
      confirmDelete: "Remove your project from Explore?",
      categoryRequired: "Pick at least one category.",
      atmosphereLinks: {
        sectionLabel: "Atmosphere links",
        sectionHint: (handle: string): VNode => (
          <>
            Toggle which services to show on your page. Links are generated
            from your handle <strong>@{handle}</strong>.
          </>
        ),
        bskyDescription: "Decentralised social network",
        tangledDescription: "Social coding platform",
        supperDescription: "AT Protocol native support page",
        configureBskyLabel: "Configure Bluesky clients",
        urlOverrideLabel: "Custom URL (optional)",
        urlOverridePlaceholder: "https://…",
      },
      bskyPicker: {
        title: "Bluesky clients",
        body:
          "Pick the client(s) that open when visitors click the Bluesky button on your profile. Your handle works on all of them — you can show more than one.",
        empty:
          "Pick at least one client to keep the Bluesky toggle enabled.",
        done: "Done",
        cancel: "Cancel",
      },
      website: {
        sectionLabel: "Website",
        placeholder: "https://yoursite.com",
      },
      customLinks: {
        sectionLabel: "Custom links",
        addButton: "Add custom link",
        labelPlaceholder: "Label",
        urlPlaceholder: "https://…",
        removeAriaLabel: "Remove link",
      },
    },
  },

  oauth: {
    errors: {
      generic: "Something went wrong with the sign-in flow. Please try again.",
      handleUnknown:
        "We couldn't resolve that handle. Check the spelling and try again.",
      asUnreachable:
        "Your account's authorization server is unreachable right now.",
      sessionExpired: "Your session has expired. Please sign in again.",
    },
  },
} as const;

export type Messages = typeof en;

export default en;
