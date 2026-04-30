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
      manageReviews: "Manage reviews",
      viewProfile: "View profile",
      signOut: "Sign out",
      avatarAlt: "Account",
      switchHeading: "Switch account",
      switchTo: (handle: string): string => `Switch to @${handle}`,
      addAccount: "Add another account",
      forget: "Forget",
      forgetConfirm: (handle: string): string =>
        `Forget @${handle} on this device? You'll need to sign in again to switch back.`,
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
    body: "Browse apps and services in the Atmosphere.",
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
    icons: {
      heading: "Project SVG icons",
      intro:
        "Current verified project icons for developers building sign-in flows, app showcases, and directory experiences. This list follows profile updates automatically.",
      searchLabel: "Search icons",
      searchPlaceholder: "Search by project or handle",
      downloadZip: "Download all SVGs (ZIP)",
      downloadSvg: "Download SVG",
      downloadSvgBw: "Download B/W SVG",
      loading: "Loading current project icons...",
      count: "{count} SVG icons available",
      empty: "No verified project SVG icons are available yet.",
      emptyBw: "No verified projects have published a B/W icon yet.",
      noResults: "No icons match that search.",
      error: "Could not load icons: {error}",
      iconAlt: "{name} SVG icon",
      variantToggleLabel: "Icon variant",
      variantColor: "Color",
      variantBw: "B/W",
    },
    schemaHeading: "Profile schema",
    schemaBody:
      "The registry profile schema is maintained in the open source repo. View the canonical AT Protocol lexicon on Tangled.",
    viewSchema: "View schema on Tangled",
    api: {
      heading: "Profile API",
      intro:
        "Pull registry profiles into your app — sign-in flows, discovery, info pages. All endpoints are public, JSON, and cached at the edge. Soft-rate-limited at ~60 requests per minute per IP.",
      tabs: {
        profile: "By handle / DID",
        search: "Search",
        featured: "Featured",
      },
      fields: {
        profileId: "Handle or DID",
        searchQuery: "Search query",
        category: "Category",
        anyCategory: "Any category",
        subcategory: "Subcategory",
        anySubcategory: "Any subcategory",
        page: "Page",
        pageSize: "Page size",
        limit: "Limit",
      },
      placeholders: {
        profileId: "alice.bsky.social  or  did:plc:…",
        searchQuery: "e.g. photo",
      },
      fetch: "Send request",
      fetching: "Sending…",
      response: "Response",
      copy: "Copy",
      copied: "Copied",
      errors: {
        missingId: "Enter a handle or DID first.",
      },
      endpointsHeading: "Endpoints",
      paramsLabel: "Parameters",
      paramDefault: "default",
      endpoints: {
        profile: {
          method: "GET",
          path: "/api/registry/profile/:handleOrDid",
          summary:
            "Single profile by handle or DID. Public fields only: identity, listing content, avatarUrl, optional iconUrl, verified boolean, and indexing metadata. Does not include moderation or verification workflow fields.",
          cache: "public, max-age=30, s-maxage=120",
        },
        search: {
          method: "GET",
          path: "/api/registry/search",
          summary:
            "Paginated profile search. Filter by free-text query, category, and subcategory. Returns { profiles, total, page, pageSize } with the same public profile shape as the single-profile endpoint.",
          params: [
            { name: "q", desc: "Free-text search query." },
            {
              name: "category",
              desc:
                "One of app, accountProvider, moderator, infrastructure, developerTool.",
            },
            {
              name: "subcategory",
              desc: "Subcategory string, e.g. photo or microblog.",
            },
            { name: "page", desc: "Page number.", default: "1" },
            {
              name: "pageSize",
              desc: "Results per page (max 48).",
              default: "24",
            },
          ],
          cache: "public, max-age=10, s-maxage=30",
        },
        featured: {
          method: "GET",
          path: "/api/registry/featured",
          summary:
            "Curated featured list, ordered by position. Returns { profiles } using the same public profile shape as the other read endpoints.",
          params: [
            {
              name: "limit",
              desc: "Number of profiles to return (max 48).",
              default: "12",
            },
          ],
          cache: "public, max-age=30, s-maxage=120",
        },
        avatar: {
          method: "GET",
          path: "/api/registry/avatar/:did",
          summary:
            "Avatar bytes for the given DID — proxied + cached from the user's PDS. Long cache headers; safe to use directly in <img src>.",
          cache: "public, max-age=3600, s-maxage=86400",
        },
        icon: {
          method: "GET",
          path: "/api/registry/icon/:did",
          summary:
            "Optional vector icon (SVG) provided by the project for developer use — sign-in badges, app showcases, programmatic listings. Sanitised on upload and served with strict CSP + nosniff so it's safe to embed via <img src>. Returns 404 when the project hasn't supplied an icon.",
          cache: "public, max-age=3600, s-maxage=86400",
        },
      },
      schemaHeading: "Schema",
      schemaBody:
        "Profiles originate as AT Protocol records; the lexicon below is the canonical on-repo schema. Public HTTP responses add derived fields (avatarUrl, iconUrl, verified) and omit AppView-only moderation and verification workflow data — use the live JSON from the playground as the reference for what the API returns.",
      downloadLexicon: "Download lexicon (JSON)",
    },
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
    moderator: "Moderation",
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
    research: "Research",
    science: "Science",
    reviews: "Reviews",
    gaming: "Gaming",
    community: "Community",
    food: "Food",
    location: "Location",
    liveStreaming: "Live-Streaming",
    niche: "Niche",
    content: "Content",
    art: "Art",
  },

  badges: {
    verified: "Verified",
    official: "Official",
    /** Tooltip / aria label for the verified-seal icon shown next to
     *  the project name once admin verification is granted. */
    verifiedTooltip: "Verified project",
  },

  /**
   * Display labels used by `lib/atmosphere-links.ts#resolveLink` when
   * an entry doesn't carry its own label.
   */
  linkKinds: {
    bsky: "Bluesky",
    tangled: "Tangled",
    supper: "Supper",
    website: "Web",
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
      hostedOn: "Account Provider",
      editProfile: "Edit this profile",
      missingProfile: "We couldn't find a profile for that handle.",
      backToExplore: "Back to Explore",
      categoryLabel: "Category",
      whatsNew: {
        heading: "What's New",
        empty: "No updates yet.",
        versionHistory: "Version History",
        viewCommit: "View commit",
        readFullUpdate: "Read full update",
      },
      notFoundTitle: "404",
      notFoundBody: "We couldn't find a profile for that handle.",
    },
    create: {
      eyebrow: "Add to Explore",
      headline: "Sign in with your Atmosphere account",
      body:
        "Use this page to sign in, write reviews, or submit a project. If you're submitting a project, sign in with that project's Atmosphere account so the right account can publish and update it.",
      signInLabel: "Sign in with your Atmosphere handle",
      handlePlaceholder: "yourhandle.com",
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
      viewPublicProfile: "View public profile",
    },
  },

  forms: {
    profile: {
      handleLabel: "Signed in as",
      nameLabel: "Project name",
      namePlaceholder: "e.g. Bluesky",
      descriptionLabel: "Short description",
      descriptionPlaceholder: "What does it do? Who's it for?",
      categoryLabel: "Category",
      categoryHint:
        "Choose App, Account Provider, or both. Selected categories are shown as primary badges.",
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
            Toggle which services to show on your page. Links are generated from
            your handle <strong>@{handle}</strong>.
          </>
        ),
        bskyDescription: "Decentralised social network",
        tangledDescription: "Social coding platform",
        supperDescription: "AT Protocol native support page",
        configureBskyLabel: "Configure Bluesky clients",
        configureUrlLabel: "Configure URL",
        usingDefault: "Using default URL",
        usingOverride: "Using custom URL",
      },
      linkOverride: {
        title: (service: string): string => `${service} URL`,
        body: (service: string, defaultUrl: string): string =>
          `By default, ${service} uses your handle (${defaultUrl}). ` +
          `Override below to point at a specific page or repository instead.`,
        inputLabel: "Custom URL",
        placeholder: "https://…",
        save: "Save",
        cancel: "Cancel",
        reset: "Reset to default",
      },
      bskyPicker: {
        title: "Bluesky clients",
        body:
          "Pick the client(s) that open when visitors click the Bluesky button on your profile. Your handle works on all of them — you can show more than one.",
        empty: "Pick at least one client to keep the Bluesky toggle enabled.",
        done: "Done",
        cancel: "Cancel",
      },
      mainLink: {
        sectionLabel: "Web link",
        placeholder: "https://yourapp.com",
        required: "Add at least one Web, iOS, or Android link.",
        invalid: "Web link must be a valid http(s) URL.",
      },
      appLinks: {
        iosLabel: "iOS link (optional)",
        iosPlaceholder: "https://apps.apple.com/app/…",
        iosHint: "Add this if your project has an iPhone or iPad app.",
        iosInvalid: "iOS link must be a valid http(s) URL.",
        androidLabel: "Android link (optional)",
        androidPlaceholder: "https://play.google.com/store/apps/details?id=…",
        androidHint: "Add this if your project has an Android app.",
        androidInvalid: "Android link must be a valid http(s) URL.",
      },
      screenshots: {
        sectionLabel: "Screenshots",
        hint: "Optional. Add up to 4 PNG, JPEG, or WebP screenshots, 5MB each.",
        upload: "Add screenshots",
        addMore: "Add more screenshots",
        invalidType: "Screenshots must be PNG, JPEG, or WebP images.",
        tooLarge: "Each screenshot must be 5MB or smaller.",
        maxReached: "You can add up to 4 screenshots.",
        added: (n: number) =>
          `${n} screenshot${
            n === 1 ? "" : "s"
          } ready. Click Update profile to save.`,
        partialAdded: (added: number, skipped: number) =>
          `${added} screenshot${added === 1 ? "" : "s"} ready. ${skipped} file${
            skipped === 1 ? " was" : "s were"
          } skipped because screenshots must be PNG, JPEG, or WebP and 5MB or smaller.`,
        noneAdded:
          "No screenshots were added. Use PNG, JPEG, or WebP images that are 5MB or smaller.",
        removeAriaLabel: (n: number) => `Remove screenshot ${n}`,
      },
      customLinks: {
        sectionLabel: "Custom links",
        addButton: "Add custom link",
        labelPlaceholder: "Label",
        urlPlaceholder: "https://…",
        removeAriaLabel: "Remove link",
      },
      icon: {
        sectionLabel: "Developer icon (SVG, optional)",
        hint:
          "Vector marks for developers — sign-in badges, app showcases, programmatic listings. Not shown on your public profile. SVG only, 200KB max per variant. Both variants are optional and can be uploaded independently.",
        upload: "Upload SVG",
        replace: "Replace SVG",
        remove: "Remove SVG",
        colorLabel: "Color",
        colorHint: "Your primary mark, used by default in badges and listings.",
        bwLabel: "Black & white",
        bwHint:
          "Optional monochrome companion for light/dark badges, sign-in chrome, and print.",
        bwUpload: "Upload B/W SVG",
        bwReplace: "Replace B/W SVG",
        bwRemove: "Remove B/W SVG",
        viewOnDeveloperResources: "View on developer resources",
        invalidType: "Icon must be an SVG (image/svg+xml).",
        tooLarge: "Icon must be 200KB or smaller.",
        gate: {
          /** Gate state when the project hasn't requested verification yet. */
          lockedTitle: "Verification required",
          lockedBody:
            "Verified projects get a checkmark on their listing and unlock SVG icon uploads for the developer API. Submit a request and an admin will review your project.",
          requestButton: "Request Verification",
          /** Disabled-button text shown before the user has published their profile. */
          requestDisabledHint:
            "Publish your profile first, then come back here to request verification.",
          /** Gate state while a request is sitting in the admin queue. */
          pendingTitle: "Verification request pending",
          pendingBody: (email: string): string =>
            `An admin will review your request and reply to ${email}.`,
          /** Gate state after admin denial. */
          deniedTitle: "Verification denied",
          deniedBody: (appealEmail: string, reason: string | null): string =>
            reason
              ? `An admin denied your verification request. Reason: ${reason}. To appeal, email ${appealEmail}.`
              : `An admin denied your verification request. To appeal, email ${appealEmail}.`,
          /** Gate state after admin grant — uploader unlocked. */
          grantedHint:
            "Your project is verified — a checkmark appears on your listing and SVG uploads are unlocked. Files are still sanitised on upload.",
        },
        /** Modal that collects a contact email for the verification request. */
        requestModal: {
          title: "Request verification",
          body:
            "An admin will review your project and reply by email. Verified projects get a checkmark on their listing and can upload an SVG icon for the developer API.",
          emailLabel: "Contact email",
          emailPlaceholder: "you@example.com",
          submit: "Submit request",
          cancel: "Cancel",
          submitting: "Submitting…",
          successTitle: "Request submitted",
          successBody: "An admin will review your project and reply by email.",
          invalidEmail: "Enter a valid email address.",
          /** Generic failure surface — server text appended after. */
          errorPrefix: "Couldn't submit request",
        },
      },
      profileUpdates: {
        eyebrow: "What's New",
        title: "Project updates",
        body:
          "Post release notes for your public profile. Each update is saved as its own record on your project account.",
        titleLabel: "Update title",
        titlePlaceholder: "e.g. New beta release",
        versionLabel: "Version (optional)",
        versionPlaceholder: "e.g. 1.2.0",
        notesLabel: "Update notes",
        notesPlaceholder: "What's changed?",
        commitLabel: "Tangled commit link (optional)",
        commitPlaceholder: "https://tangled.org/…",
        publishButton: "Publish update",
        updateButton: "Update note",
        saving: "Saving…",
        saved: "Update saved.",
        saveError: "Could not save update.",
        delete: "Delete",
        deleting: "Deleting…",
        deleted: "Update deleted.",
        deleteError: "Could not delete update.",
        edit: "Edit",
        cancelEdit: "Cancel edit",
        confirmDelete: "Delete this update?",
      },
    },
  },

  /**
   * Lightweight in-app moderation/curation dashboard. Routes are
   * gated by `ADMIN_DIDS` so non-admin users never see this copy.
   */
  admin: {
    backToOverview: "Back to admin overview",
    errorPrefix: "Error",
    overview: {
      headline: "Admin",
      subhead: "Verify projects, triage reports, and curate the featured rail.",
      iconAccessTitle: "Verification requests",
      iconAccessBody:
        "Projects asking to be verified — grants a checkmark on their listing and unlocks SVG icon uploads for the developer API.",
      reportsTitle: "Open reports",
      reportsBody: "User-submitted reports against profiles in Explore.",
      reviewReportsTitle: "Review reports",
      reviewReportsBody: "Reports against user reviews and ratings.",
      featuredTitle: "Featured",
      featuredBody:
        "Curate the projects that appear in the featured rail at the top of Explore.",
      takedownsTitle: "Taken down",
      takedownsBody:
        "Profiles removed from Explore. Restorable at any time — the user's PDS record is untouched.",
    },
    statusBadge: {
      pending: "Pending review",
      approved: "Approved",
      rejected: "Rejected",
    },
    iconAccess: {
      headline: "Verification requests",
      subhead:
        "Projects asking to be verified. Granting puts a checkmark next to the project name on its listing and detail page, and unlocks /api/registry/icon/:did + the developer API's `iconUrl`. Per-icon sanitisation still runs server-side. Denying (or revoking) drops the checkmark and hides any existing icon immediately.",
      pendingHeading: "Pending requests",
      proactiveHeading: "Verify a project",
      proactiveInputLabel: "Project handle or DID",
      proactivePlaceholder: "atmosphereaccount.com or did:plc:...",
      proactiveHelp:
        "Use this to verify a published profile even if the project has not submitted a request. Request emails still appear in the pending queue when projects ask for verification themselves.",
      proactiveSubmit: "Verify project",
      proactiveSuccessSuffix: "is now verified.",
      proactiveNotFound:
        "No active registry profile was found for that handle or DID.",
      unverifiedHeading: "Not yet verified",
      emptyUnverified:
        "Every active profile is either verified or waiting in the request queue.",
      unverifiedNeverRequestedStatus: "No verification request yet.",
      unverifiedDeniedStatus: "Previously denied or revoked.",
      grantedHeading: "Currently verified",
      emptyPending: "No requests in the queue.",
      emptyGranted: "No projects are verified yet.",
      grant: "Verify",
      deny: "Deny",
      revoke: "Revoke",
      denyPrompt:
        "Optional: tell the project owner why you're denying / revoking. Press OK with the field empty to deny without a reason.",
      markedGranted: "Verified",
      markedDenied: "Denied",
      requestedAtLabel: "Requested",
      grantedAtLabel: "Verified",
      emailLabel: "Contact email",
      viewProfile: "View profile",
    },
    reports: {
      headline: "Open reports",
      subhead:
        "Reports submitted against Explore profiles. Mark actioned or dismiss to close the report; take down to remove the profile from Explore (auto-resolves all other reports against it).",
      empty: "No open reports.",
      action: "Mark actioned",
      dismiss: "Dismiss",
      takedown: "Take down profile",
      takedownPrompt:
        "Take this profile down. Why? (saved with the takedown record)",
      takedownDoneLabel: "Taken down",
      actionedLabel: "Actioned",
      dismissedLabel: "Dismissed",
      noteLabel: "Notes (optional)",
      notePlaceholder: "What did you do?",
      reasonLabel: "Reason",
      reporterLabel: "Reporter",
      anonymousReporter: "Anonymous",
      detailsLabel: "Details",
      submittedAt: "Submitted",
      reasons: {
        not_a_project: "Not a project",
        harmful: "Harmful or hateful",
        impersonation: "Impersonation",
        spam: "Spam",
        other: "Other",
      },
    },
    reviewReports: {
      headline: "Review reports",
      subhead:
        "Reports submitted against user reviews. Hide or remove a review to close the report, or dismiss reports that don't need action.",
      empty: "No open review reports.",
      action: "Mark actioned",
      dismiss: "Dismiss",
      hide: "Hide review",
      remove: "Remove review",
      restore: "Restore review",
      actionedLabel: "Actioned",
      dismissedLabel: "Dismissed",
      hiddenLabel: "Hidden",
      removedLabel: "Removed",
      restoredLabel: "Restored",
      notePlaceholder: "What did you do?",
      reasonLabel: "Reason",
      reporterLabel: "Reporter",
      reviewerLabel: "Reviewer",
      detailsLabel: "Details",
      reviewLabel: "Review",
      submittedAt: "Submitted",
      reasons: {
        harmful: "Harmful or hateful",
        spam: "Spam",
        off_topic: "Off-topic",
        other: "Other",
      },
    },
    takedowns: {
      headline: "Taken-down profiles",
      subhead:
        "Profiles currently hidden from Explore and the public registry API. Restore returns them to /explore immediately. The user's PDS record is never touched.",
      empty: "No profiles are currently taken down.",
      reasonLabel: "Reason",
      byLabel: "Taken down by",
      atLabel: "Taken down on",
      restore: "Restore",
      confirmRestore:
        "Restore this profile? It will reappear in Explore immediately.",
      restored: "Restored",
    },
    featured: {
      headline: "Curate featured",
      subhead:
        "Pick the projects that appear in the featured rail. Drag to reorder. Save & publish writes the canonical record on the Atmosphere account's PDS.",
      saveAndPublish: "Save & publish",
      saving: "Publishing…",
      saved: "Published.",
      filterPlaceholder: "Filter by name, handle, or DID…",
      featuredHeading: "Featured (in order)",
      candidatesHeading: "All projects",
      empty: "No projects in the registry yet.",
      moveUp: "Move up",
      moveDown: "Move down",
      remove: "Remove",
      add: "Feature",
      badgesLabel: "Badges",
      badgeVerified: "Verified",
      badgeOfficial: "Official",
    },
  },

  /**
   * Banner shown on /explore/manage when the owner's profile has been
   * taken down by an admin. Explains the state and surfaces the
   * recorded reason; the Publish button below also returns 403 from
   * the API so the user gets a consistent message either way.
   */
  manageTakedown: {
    title: "Your profile has been removed from Explore",
    body:
      "An Atmosphere admin took your profile down. Updates won't be published until it's restored. The record on your PDS is untouched — you can delete it from your PDS at any time.",
    reasonLabel: "Reason given",
  },

  /**
   * User-facing report flow on /explore/<handle>. The button mounts
   * the modal; modal handles submission to /api/registry/profile/:id/report.
   */
  report: {
    button: "Report profile",
    buttonShort: "Report",
    modalTitle: "Report this profile",
    modalBody:
      "Send a report to the Atmosphere admins. Reports are anonymous unless you're signed in.",
    reasonLabel: "What's wrong?",
    detailsLabel: "Add details (optional)",
    detailsPlaceholder: "Anything we should know?",
    submit: "Send report",
    submitting: "Sending…",
    cancel: "Cancel",
    sentTitle: "Report sent",
    sentBody: "Thanks. An admin will review it shortly.",
    duplicate:
      "You've already submitted this report recently. We'll review the existing one.",
    error: "Couldn't send the report. Please try again.",
    reasons: {
      not_a_project: "Not a real project",
      harmful: "Harmful or hateful content",
      impersonation: "Impersonating someone",
      spam: "Spam",
      other: "Other",
    },
  },

  accountType: {
    title: "How will you use Atmosphere?",
    body: (handle: string): string =>
      `You're signed in as @${handle}. Choose whether this account represents you as a person or a project you want listed in Explore.`,
    userTitle: "I'm a user",
    userBody: "Create a user profile to write and manage your reviews.",
    projectTitle: "I'm a project",
    projectBody:
      "Create and manage a public project profile in Explore with app links, screenshots, and developer details.",
  },

  accountReviews: {
    eyebrow: "User account",
    headline: "Your Profile",
    subhead: (handle: string): string =>
      `Signed in as @${handle}. Your user profile comes from Bluesky; reviews are managed here.`,
    reviewsHeading: "Your reviews",
    empty: "You haven't reviewed any projects yet.",
    explore: "Explore projects",
    viewProfile: "View public profile",
    nameLabel: "Display name",
    namePlaceholder: "Your name",
    bioLabel: "Bio",
    bioPlaceholder: "A short note about you",
    clientLabel: "Bluesky button",
    displayBskyButton: "Display Bluesky button",
    configureBskyClient: "Choose Bluesky client",
    saveClient: "Save",
    saving: "Saving…",
    saved: "Profile saved.",
    saveError: "Couldn't save your profile.",
    cancel: "Cancel",
    done: "Done",
    viewProject: "View project",
    delete: "Delete review",
    deleting: "Deleting…",
    deleted: "Review deleted.",
    error: "Couldn't update the review",
    upgrade: {
      button: "Submit your project",
      modalTitle: "Is this account a project?",
      modalBody:
        "Choosing yes converts this account into a project profile and unlocks the project dashboard. If this isn't your project's account,",
      signInWithProjectLink: "sign in with your project's account here",
      signInWithProjectSuffix: ".",
      yes: "Yes, convert this account",
      cancel: "Cancel",
      submitting: "Converting…",
      error: "Couldn't convert this account.",
    },
  },

  userProfile: {
    backToExplore: "Back to Explore",
    notFoundTitle: "User not found",
    notFoundBody: "That user profile is not available.",
    openIn: (clientName: string): string => `Open in ${clientName}`,
  },

  reviews: {
    summary: {
      heading: "Ratings & Reviews",
      threshold: (count: number, needed: number): string =>
        count === 0
          ? "Ratings appear after 5 reviews."
          : `${count} review${
            count === 1 ? "" : "s"
          } so far. ${needed} more until the average rating appears.`,
      average: (rating: string, count: number): string =>
        `${rating} average from ${count} review${count === 1 ? "" : "s"}`,
      distributionLabel: (stars: number, count: number): string =>
        `${count} ${stars}-star review${count === 1 ? "" : "s"}`,
    },
    composer: {
      heading: "Write a review",
      modalBody: "Rate this project and add a short note for other people.",
      signedOut: "Sign in to rate and review this project.",
      ownerNote: "You can't review your own project.",
      ratingLabel: "Rating",
      bodyLabel: "Review (optional)",
      bodyPlaceholder: "What should other people know?",
      charsRemaining: (n: number): string => `${n} characters remaining`,
      charsRemainingSuffix: "characters remaining",
      submit: "Post review",
      update: "Update review",
      submitting: "Saving…",
      delete: "Delete review",
      signIn: "Sign in",
      cancel: "Cancel",
      saved: "Review saved.",
      deleted: "Review deleted.",
      error: "Couldn't save the review. Please try again.",
    },
    list: {
      heading: "Reviews",
      empty: "No reviews yet.",
      reviewerFallback: "Atmosphere user",
      edited: "edited",
      ownerResponse: "Developer response",
    },
    report: {
      button: "Report review",
      modalTitle: "Report this review",
      modalBody: "Send a report to the Atmosphere admins.",
      reasonLabel: "What's wrong?",
      detailsLabel: "Add details (optional)",
      detailsPlaceholder: "Anything we should know?",
      submit: "Send report",
      submitting: "Sending…",
      cancel: "Cancel",
      sentTitle: "Report sent",
      sentBody: "Thanks. An admin will review it shortly.",
      signInRequired: "Sign in to report reviews.",
      error: "Couldn't send the report. Please try again.",
      reasons: {
        harmful: "Harmful or hateful content",
        spam: "Spam",
        off_topic: "Off-topic or not useful",
        other: "Other",
      },
    },
    response: {
      button: "Respond as developer",
      updateButton: "Edit developer response",
      deleteButton: "Delete response",
      placeholder: "Add a short developer response…",
      submit: "Save response",
      submitting: "Saving…",
      cancel: "Cancel",
      error: "Couldn't save the response",
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
