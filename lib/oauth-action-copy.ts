import type { OAuthAction } from "./oauth-action.ts";

export interface OAuthActionCopy {
  eyebrow: string;
  title: string;
  signInBody: string;
  upgradeBody: (handle: string) => string;
}

const ACCOUNT_CREATION_BY_ACTION = {
  account: true,
  review: true,
  review_manage: false,
  legacy_review: true,
  legacy_review_manage: false,
  review_response: false,
  report_review: true,
  favorite: true,
  app: true,
  host_claim: true,
  host_manage: false,
  host_transfer: true,
  app_host: false,
  developer: false,
  relationship_confirm: false,
  admin: false,
} as const satisfies Record<OAuthAction, boolean>;

export function oauthActionAllowsAccountCreation(action: OAuthAction): boolean {
  return ACCOUNT_CREATION_BY_ACTION[action];
}

/**
 * User-facing context shared by the in-page account chooser and its `/signin`
 * fallback. Ordinary actions stay task-focused; app and host management name
 * the access being approved because that detail matters in those workflows.
 */
export function authActionCopy(
  action: OAuthAction,
  targetName: string | null,
): OAuthActionCopy {
  switch (action) {
    case "review": {
      const name = targetName || "this app";
      return {
        eyebrow: "Write a review",
        title: `Sign in to review ${name}`,
        signInBody: "Choose the account that will publish your review.",
        upgradeBody: (handle) =>
          `Continue as @${handle} to publish your review of ${name}.`,
      };
    }
    case "review_manage": {
      const name = targetName || "this app";
      return {
        eyebrow: "Your review",
        title: "Sign in to manage your review",
        signInBody: `Choose the account that owns your review of ${name}.`,
        upgradeBody: (handle) =>
          `Continue as @${handle} to manage your review of ${name}.`,
      };
    }
    case "legacy_review": {
      const name = targetName || "this app";
      return {
        eyebrow: "Write a review",
        title: `Sign in to review ${name}`,
        signInBody: "Choose the account that will publish your review.",
        upgradeBody: (handle) =>
          `Continue as @${handle} to publish your review of ${name}.`,
      };
    }
    case "legacy_review_manage": {
      const name = targetName || "this app";
      return {
        eyebrow: "Your review",
        title: "Sign in to manage your review",
        signInBody: `Choose the account that owns your review of ${name}.`,
        upgradeBody: (handle) =>
          `Continue as @${handle} to manage your review of ${name}.`,
      };
    }
    case "review_response": {
      const name = targetName || "this app";
      return {
        eyebrow: "Review response",
        title: "Sign in to respond",
        signInBody: `Continue with the account that manages ${name}.`,
        upgradeBody: (handle) =>
          `Continue as @${handle} to respond for ${name}.`,
      };
    }
    case "report_review": {
      const name = targetName || "this app";
      return {
        eyebrow: "Report a review",
        title: "Sign in to report this review",
        signInBody:
          `Choose the account you want to use to report a review of ${name}.`,
        upgradeBody: (handle) => `Confirm @${handle} to report this review.`,
      };
    }
    case "favorite": {
      const name = targetName || "this app";
      return {
        eyebrow: "Like an app",
        title: `Sign in to like ${name}`,
        signInBody: "Choose the account you want to use.",
        upgradeBody: (handle) => `Continue as @${handle} to like ${name}.`,
      };
    }
    case "app": {
      const name = targetName || "your app";
      return {
        eyebrow: "App management",
        title: "Choose your app’s account",
        signInBody:
          `Use the account that represents ${name}. You’ll approve access to manage its app records and images.`,
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Approve access to manage its app records, including images, to continue.`,
      };
    }
    case "host_claim": {
      const name = targetName || "this account host";
      return {
        eyebrow: "Claim an account host",
        title: `Sign in to claim ${name}`,
        signInBody:
          `Choose the account that will claim and manage ${name}, including its public profile and images. Granting this access does not claim the host; DNS verification separately proves control of its domain.`,
        upgradeBody: (handle) =>
          `Approve access for @${handle} to manage the host’s public profile and images. This does not claim the host; DNS verification separately proves control of its domain.`,
      };
    }
    case "host_manage": {
      const name = targetName || "this account host";
      return {
        eyebrow: "Host management",
        title: "Choose the host’s account",
        signInBody:
          `Use the account that represents ${name}. You’ll approve access to manage its public host profile and images.`,
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Approve access to manage its public host profile and images.`,
      };
    }
    case "host_transfer": {
      const name = targetName || "this account host";
      return {
        eyebrow: "Choose a new managing account",
        title: "Choose the new managing account",
        signInBody:
          `Choose the new managing account for ${name}. It will manage the host’s public profile and images after DNS verification separately proves control of the domain. The current manager stays in control until then.`,
        upgradeBody: (handle) =>
          `Approve access for @${handle} to manage the host’s public profile and images. Nothing changes until DNS verification separately proves control of the domain.`,
      };
    }
    case "app_host": {
      const name = targetName || "this app and account host";
      return {
        eyebrow: "App and host management",
        title: "Choose the account for both profiles",
        signInBody:
          `Use the account that represents ${name}. You’ll approve access to manage its app records and images and its public host profile and images.`,
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Approve access to manage the app records and images and the public host profile and images.`,
      };
    }
    case "developer":
      return {
        eyebrow: "Manage app developer settings",
        title: "Manage a login registration",
        signInBody:
          "Choose the account that represents the app. No repository access is required to manage its Login with Atmosphere registrations.",
        upgradeBody: (handle) => `Confirm @${handle} to continue.`,
      };
    case "relationship_confirm": {
      const name = targetName || "this app and account host";
      return {
        eyebrow: "App and host connection",
        title: `Connect ${name}`,
        signInBody: "Choose an account that controls the app or account host.",
        upgradeBody: (handle) => `Confirm @${handle} to connect ${name}.`,
      };
    }
    case "admin":
      return {
        eyebrow: "Admin",
        title: "Admin sign-in",
        signInBody: "Choose an authorized account.",
        upgradeBody: (handle) =>
          `Confirm @${handle} to continue to admin tools.`,
      };
    case "account":
      return {
        eyebrow: "Atmosphere Account",
        title: "Manage your account",
        signInBody:
          "Choose the account whose settings you want to manage. Identity authentication confirms which account you are using.",
        upgradeBody: (handle) => `Confirm @${handle} to continue.`,
      };
  }
}
