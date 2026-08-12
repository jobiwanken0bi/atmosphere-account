import Footer from "../../components/Footer.tsx";
import Nav from "../../components/Nav.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getManagedAppListingByAccountDid } from "../../lib/app-directory.ts";
import { createBoundAppHostLinkIntent } from "../../lib/app-host-link-intent.ts";
import {
  activateDevHostClaimAccount,
  DEV_HOST_CLAIM_ACCOUNTS,
  DEV_HOST_CLAIM_HOSTS,
  type DevHostClaimAccountKey,
  prepareDevHostClaimFixtures,
  resetDevHostClaimFixtures,
} from "../../lib/dev-host-claim-fixtures.ts";
import { IS_DEV } from "../../lib/env.ts";
import { clearRememberedAccountsCookies } from "../../lib/remembered-accounts.ts";
import {
  readFormDataRequestWithLimit,
  RequestBodyTooLargeError,
} from "../../lib/security.ts";
import { clearSessionCookie, destroySession } from "../../lib/session.ts";
import { define } from "../../utils.ts";

const MAX_SCENARIO_FORM_BYTES = 8_192;

export const DEV_HOST_CLAIM_SCENARIOS = [
  {
    id: "new-account",
    account: "regular",
    eyebrow: "No existing profile",
    title: "New personal account",
    description:
      "Start after account creation with no app or host profile, then claim a local PDS.",
    outcome: "Completes locally",
  },
  {
    id: "existing-app",
    account: "app",
    eyebrow: "Existing app profile",
    title: "App account claims a host",
    description:
      "Use Field Notes to claim a separate host profile without merging the two profiles.",
    outcome: "Completes locally",
  },
  {
    id: "app-link",
    account: "app",
    eyebrow: "Existing app profile",
    title: "Claim and connect a host",
    description:
      "Use a real signed app-to-host intent, claim the PDS, and connect it as the Field Notes account service.",
    outcome: "Completes locally",
  },
  {
    id: "already-owner",
    account: "host",
    eyebrow: "Existing host profile",
    title: "Already managed by this account",
    description:
      "Open Harbor Host as its current manager and see the claimed-by-you state.",
    outcome: "View existing state",
  },
  {
    id: "claimed-other",
    account: "regular",
    eyebrow: "Ownership conflict",
    title: "Host managed by another account",
    description:
      "Open Harbor Host as the personal test account and see the claimed-by-other state.",
    outcome: "View conflict state",
  },
  {
    id: "dns-preview",
    account: "regular",
    eyebrow: "Production-shaped host",
    title: "DNS TXT verification",
    description:
      "Start a real account-bound DNS challenge and inspect the TXT record. Verification intentionally stops unless that public DNS record exists.",
    outcome: "Preview through DNS check",
  },
  {
    id: "email-available",
    account: "regular",
    eyebrow: "Published PDS contact",
    title: "Contact email verification",
    description:
      "Choose the contact email published by the exact PDS, open the local verification link, and confirm the first claim.",
    outcome: "Completes locally",
  },
  {
    id: "email-unavailable",
    account: "regular",
    eyebrow: "No published contact",
    title: "Email unavailable",
    description:
      "See the contact-email method disabled when the exact PDS does not publish a contact address. DNS remains available.",
    outcome: "View unavailable state",
  },
  {
    id: "email-recovery",
    account: "regular",
    eyebrow: "Existing email claim",
    title: "Recover with DNS",
    description:
      "Start a DNS recovery for a host managed through an earlier contact-email claim. The current owner remains active during review.",
    outcome: "Preview through DNS check",
  },
  {
    id: "transfer-preview",
    account: "host",
    eyebrow: "Existing host manager",
    title: "Change the managing account",
    description:
      "Start from a DNS-owned host, choose another seeded account, and inspect the transfer verification flow.",
    outcome: "Preview through DNS check",
  },
  {
    id: "signed-out-create",
    account: null,
    eyebrow: "Signed out",
    title: "Login or create an account",
    description:
      "Clear the local account memory and open an unclaimed host to inspect the real Login and account-creation entry.",
    outcome: "External creation preview",
  },
] as const;

export type DevHostClaimScenarioId =
  (typeof DEV_HOST_CLAIM_SCENARIOS)[number]["id"];

export const handler = define.handlers({
  async GET(ctx) {
    if (!devHostClaimLabEnabled()) return notFound();
    try {
      await prepareDevHostClaimFixtures();
    } catch {
      return new Response(
        "The local host-claim fixtures could not be prepared.",
        {
          status: 500,
          headers: { "cache-control": "no-store" },
        },
      );
    }
    return ctx.render(
      <DevHostClaimLab
        account={buildAccountMenuProps(ctx.state)}
        reset={ctx.url.searchParams.get("reset") === "1"}
      />,
      { headers: { "cache-control": "private, no-store" } },
    );
  },

  async POST(ctx) {
    if (!devHostClaimLabEnabled()) return notFound();
    let form: FormData | null;
    try {
      form = await readFormDataRequestWithLimit(
        ctx.req,
        MAX_SCENARIO_FORM_BYTES,
      );
    } catch (error) {
      return new Response(
        error instanceof RequestBodyTooLargeError
          ? "Request too large."
          : "Invalid request.",
        {
          status: error instanceof RequestBodyTooLargeError ? 413 : 400,
          headers: { "cache-control": "no-store" },
        },
      );
    }
    if (!form) {
      return new Response("Invalid request.", {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }

    const action = text(form.get("action"));
    if (action === "reset") {
      await resetDevHostClaimFixtures();
      return redirect("/dev/host-claim?reset=1");
    }
    if (!isDevHostClaimScenarioId(action)) {
      return new Response("Unknown host-claim scenario.", {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }

    // Every card starts from the same clean baseline. This keeps the lab
    // repeatable regardless of which claim, connection, or transfer the
    // tester completed previously.
    await resetDevHostClaimFixtures();

    if (action === "signed-out-create") {
      await destroySession(ctx.req);
      const headers = redirectHeaders(
        `/hosts/${DEV_HOST_CLAIM_HOSTS.localUnclaimed.host}`,
      );
      headers.append("set-cookie", clearSessionCookie());
      for (const cookie of clearRememberedAccountsCookies()) {
        headers.append("set-cookie", cookie);
      }
      return new Response(null, { status: 303, headers });
    }

    const accountKey = scenarioAccount(action);
    const activated = await activateDevHostClaimAccount(ctx.req, accountKey);
    let destination: string;
    try {
      destination = await scenarioDestination(action);
    } catch {
      return new Response(
        "This scenario is unavailable. Run deno task dev:host-claim to refresh the local seed.",
        {
          status: 503,
          headers: { "cache-control": "no-store" },
        },
      );
    }
    const headers = redirectHeaders(destination);
    headers.append("set-cookie", activated.sessionCookie);
    for (const cookie of activated.rememberedCookies) {
      headers.append("set-cookie", cookie);
    }
    return new Response(null, { status: 303, headers });
  },
});

function DevHostClaimLab(
  { account, reset }: {
    account: ReturnType<typeof buildAccountMenuProps>;
    reset: boolean;
  },
) {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="hosts" />
        <main
          id="main-content"
          class="signin-page-section host-claim-section"
        >
          <div class="container signin-page-container host-claim-lab-container">
            <a href="/hosts" class="text-link-button">← Back to hosts</a>
            <div class="glass signin-page-card host-claim-card host-claim-lab-card">
              <p class="text-eyebrow">Local UX lab</p>
              <h1 class="host-claim-title">Host claim scenarios</h1>
              <p class="text-body host-claim-copy">
                Each card activates a deterministic local account and opens a
                real claim route. Production ownership rules stay unchanged.
              </p>
              {reset && (
                <p class="profile-form-status" role="status">
                  Claim, connection, challenge, and transfer fixtures reset.
                </p>
              )}
              <div class="account-products-grid host-claim-lab-grid">
                {DEV_HOST_CLAIM_SCENARIOS.map((scenario) => (
                  <article class="account-product-card host-claim-lab-scenario">
                    <div class="account-product-card-content">
                      <p class="text-eyebrow">{scenario.eyebrow}</p>
                      <h2>{scenario.title}</h2>
                      <p class="text-body">{scenario.description}</p>
                      <span class="host-claim-lab-outcome">
                        {scenario.outcome}
                      </span>
                    </div>
                    <form method="POST" data-submit-once="true">
                      <input type="hidden" name="action" value={scenario.id} />
                      <button
                        type="submit"
                        class="directory-register-button"
                        data-pending-label="Opening scenario…"
                      >
                        <span data-submit-once-label>Open scenario</span>
                      </button>
                    </form>
                  </article>
                ))}
              </div>
              <div class="account-dashboard-callout host-claim-lab-reset">
                <div>
                  <strong>Start over</strong>
                  <p>
                    Restore the named QA hosts without touching other local
                    accounts or directory data.
                  </p>
                </div>
                <form method="POST" data-submit-once="true">
                  <input type="hidden" name="action" value="reset" />
                  <button
                    type="submit"
                    class="profile-form-button-secondary"
                    data-pending-label="Resetting…"
                  >
                    <span data-submit-once-label>Reset scenarios</span>
                  </button>
                </form>
              </div>
              <p class="text-body host-claim-privacy-note">
                Actual DNS completion and creation of an external DID still
                require real infrastructure. Everything else uses local.db.
              </p>
            </div>
          </div>
        </main>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

export function devHostClaimLabEnabled(
  options: { isDev?: boolean; enabled?: string | undefined } = {},
): boolean {
  return (options.isDev ?? IS_DEV) &&
    (options.enabled ?? Deno.env.get("ATMOSPHERE_ENABLE_DEV_LOGIN")) === "1";
}

export function isDevHostClaimScenarioId(
  value: string,
): value is DevHostClaimScenarioId {
  return DEV_HOST_CLAIM_SCENARIOS.some((scenario) => scenario.id === value);
}

export function scenarioAccount(
  scenario: Exclude<DevHostClaimScenarioId, "signed-out-create">,
): DevHostClaimAccountKey {
  const found = DEV_HOST_CLAIM_SCENARIOS.find((item) => item.id === scenario);
  if (!found?.account) throw new TypeError("Scenario has no active account.");
  return found.account;
}

export async function scenarioDestination(
  scenario: Exclude<DevHostClaimScenarioId, "signed-out-create">,
): Promise<string> {
  const claimPath = (host: string) =>
    `/hosts/${encodeURIComponent(host)}/claim?publish=1`;
  switch (scenario) {
    case "new-account":
      return claimPath(DEV_HOST_CLAIM_HOSTS.localUnclaimed.host);
    case "existing-app":
      return claimPath(DEV_HOST_CLAIM_HOSTS.appUnclaimed.host);
    case "app-link": {
      const app = await getManagedAppListingByAccountDid(
        DEV_HOST_CLAIM_ACCOUNTS.app.did,
      );
      if (!app) throw new Error("The seeded Field Notes app is unavailable.");
      const intent = await createBoundAppHostLinkIntent({
        appListingId: app.id,
        relationship: "same_product",
        appOwnerDid: DEV_HOST_CLAIM_ACCOUNTS.app.did,
        host: DEV_HOST_CLAIM_HOSTS.appLinked.host,
      });
      return `${
        claimPath(DEV_HOST_CLAIM_HOSTS.appLinked.host)
      }&${new URLSearchParams({ link_intent: intent })}`;
    }
    case "already-owner":
    case "claimed-other":
      return claimPath(DEV_HOST_CLAIM_HOSTS.localClaimed.host);
    case "dns-preview":
      return `/hosts/claim?${new URLSearchParams({
        domain: DEV_HOST_CLAIM_HOSTS.detectedDns.host,
      })}`;
    case "email-available":
      return claimPath(DEV_HOST_CLAIM_HOSTS.emailAvailable.host);
    case "email-unavailable":
      return claimPath(DEV_HOST_CLAIM_HOSTS.emailUnavailable.host);
    case "email-recovery":
      return claimPath(DEV_HOST_CLAIM_HOSTS.emailRecovery.host);
    case "transfer-preview":
      return `/hosts/${
        encodeURIComponent(DEV_HOST_CLAIM_HOSTS.transferClaimed.host)
      }/manage`;
  }
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: redirectHeaders(location),
  });
}

function redirectHeaders(location: string): Headers {
  return new Headers({
    "cache-control": "no-store",
    location,
  });
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}
