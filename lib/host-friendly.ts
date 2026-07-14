import type { AccountHost, HostSignupStatus } from "./account-hosts.ts";

export interface HostFriendlyProfile {
  summary: string;
  bestFor: string;
  location: string;
  locationDetail: string;
  handleLabel: string;
  handleDetail: string;
  signupLabel: string;
  signupDetail: string;
}

export function hostFriendlyProfile(host: AccountHost): HostFriendlyProfile {
  const key = host.host.toLowerCase();
  const fallback = fallbackProfile(host);
  const known: Record<string, Partial<HostFriendlyProfile>> = {
    "bsky.network": {
      summary:
        "A familiar, general-purpose home for people using Bluesky and other Atmosphere apps.",
      bestFor: "A familiar default for Bluesky users.",
      handleLabel: "bsky.social",
      handleDetail:
        "Many people start with a Bluesky handle, but you can use your own domain.",
    },
    "eurosky.social": {
      summary:
        "A Europe-based host for people who want their Atmosphere account closer to European communities.",
      bestFor: "People who want a Europe-based account host.",
      handleLabel: "eurosky.social",
      handleDetail:
        "You can start with a Eurosky handle, but you can use your own domain.",
    },
    "selfhosted.social": {
      summary:
        "An independent community-run host for people who prefer a smaller account home.",
      bestFor: "People who prefer independent or community-run hosting.",
    },
    "blacksky.community": {
      summary:
        "A community host connected to Blacksky, listed while more host details are confirmed.",
      bestFor: "People participating in the Blacksky community.",
    },
    "sprk.so": {
      summary:
        "A Spark account host listed while more host details are confirmed.",
      bestFor: "People using Spark and related Atmosphere tools.",
    },
    "tangled.org": {
      summary:
        "A host connected to Tangled, with a public signup page for new accounts.",
      bestFor: "People using Tangled and developer-focused communities.",
    },
    "pckt.cafe": {
      summary:
        "A host connected to Pckt, listed while more host details are confirmed.",
      bestFor: "People using Pckt and writing-friendly Atmosphere apps.",
    },
    "margin.cafe": {
      summary:
        "A host connected to Margin, with login available through the Margin account site.",
      bestFor: "People using Margin and related Atmosphere communities.",
    },
    "npmx.social": {
      summary:
        "A developer-friendly host connected to NPMX, with a public PDS signup page.",
      bestFor: "People using NPMX and developer-focused Atmosphere apps.",
    },
  };
  const profile = { ...fallback, ...(known[key] ?? {}) };
  const dataLocation = host.dataLocation?.trim();
  const inferredLocation = host.inferredLocation?.trim();
  return {
    ...profile,
    location: dataLocation || inferredLocation
      ? dataLocation || `Network: ${inferredLocation}`
      : "Location not listed",
    locationDetail: dataLocation
      ? `This host says account data is primarily hosted in ${dataLocation}.`
      : inferredLocation
      ? `Atmosphere inferred this from the host's PDS network endpoint. It is not proof of where account data is stored.`
      : "This host has not shared where account data is physically hosted yet.",
    signupLabel: signupFriendlyLabel(host.signupStatus),
    signupDetail: signupFriendlyDetail(host.signupStatus),
  };
}

/** The user-facing PDS domain shown on host cards and detail pages. */
export function hostPdsDomain(
  host: Pick<AccountHost, "host" | "serviceEndpoint">,
): string {
  if (host.serviceEndpoint) {
    try {
      return new URL(host.serviceEndpoint).hostname.toLowerCase();
    } catch {
      // Fall through to the canonical inventory host.
    }
  }
  return host.host;
}

function fallbackProfile(host: AccountHost): HostFriendlyProfile {
  const handleDomain = friendlyHandleDomain(host);
  return {
    summary: host.description ||
      "An account host for your Atmosphere account.",
    bestFor: "People who recognize and trust this host.",
    location: "Location not listed",
    locationDetail:
      "This host has not shared where account data is physically hosted yet.",
    handleLabel: handleDomain,
    handleDetail:
      `You can use a handle ending in ${handleDomain}, or use your own domain.`,
    signupLabel: signupFriendlyLabel(host.signupStatus),
    signupDetail: signupFriendlyDetail(host.signupStatus),
  };
}

function friendlyHandleDomain(host: AccountHost): string {
  if (host.host === "bsky.network") return "bsky.social";
  return host.host;
}

export function signupFriendlyLabel(status: HostSignupStatus): string {
  switch (status) {
    case "open":
      return "Open signup";
    case "invite_required":
      return "Invite required";
    case "closed":
      return "Closed for now";
    default:
      return "Signup unclear";
  }
}

export function signupFriendlyDetail(status: HostSignupStatus): string {
  switch (status) {
    case "open":
      return "You can usually create an account directly with this host.";
    case "invite_required":
      return "You may need an invite or approval before joining.";
    case "closed":
      return "This host is not currently accepting new accounts.";
    default:
      return "Atmosphere has not confirmed the signup process yet.";
  }
}
