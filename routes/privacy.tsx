import LegalPage from "../components/LegalPage.tsx";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import { define } from "../utils.ts";

export const handler = define.handlers({
  GET(ctx) {
    ctx.state.pageMeta = {
      title: "Privacy Policy — Atmosphere Account",
      description:
        "How Atmosphere Account handles account identifiers, public activity, OAuth sessions, cookies, and service data.",
      canonicalUrl: new URL("/privacy", ctx.url.origin).href,
    };
    return ctx.render(
      <PrivacyPage account={buildAccountMenuProps(ctx.state)} />,
    );
  },
});

export function PrivacyPage(
  { account }: {
    account: ReturnType<typeof buildAccountMenuProps>;
  },
) {
  return (
    <LegalPage
      account={account}
      title="Privacy Policy"
      summary="This policy explains what Atmosphere Account processes, why it is needed, where the AT Protocol fits, and the choices available to you."
    >
      <section>
        <h2>1. Scope</h2>
        <p>
          This policy covers atmosphereaccount.com, login.atmosphereaccount.com,
          and related Atmosphere Account services, including the app and host
          directories, account management pages, and Login with Atmosphere. It
          does not cover independent apps, account hosts, personal data servers,
          or other sites you visit. Those services have their own privacy
          practices.
        </p>
      </section>

      <section>
        <h2>2. Information we process</h2>
        <h3>Account and profile information</h3>
        <p>
          We process AT Protocol identifiers such as your DID, handle, account
          host, and public profile information. When available, that can include
          a display name, description, and avatar from your Bluesky profile.
        </p>

        <h3>Authentication and account-selection information</h3>
        <p>
          We process session identifiers, OAuth grants issued to this service,
          the permissions attached to those grants, and signed account-selection
          state. A remembered-account cookie can store your DID, handle, and
          host hint so this browser can offer that account again. We do not
          receive your account password; you enter it with your account host.
        </p>

        <h3>Content and activity</h3>
        <p>
          We process the app and host profiles you manage, app-host
          relationships, reviews, favorites, reports, directory visibility
          choices, and Login with Atmosphere developer environments. Some of
          this information is intentionally public or is read from public AT
          Protocol records.
        </p>

        <h3>Operational and security information</h3>
        <p>
          We process request and response details needed to run and secure the
          service, such as timestamps, route information, error details, and
          rate-limit signals. An IP address may be processed transiently for
          abuse prevention; where a durable rate-limit or report-deduplication
          key is needed, the service stores a salted hash rather than the raw IP
          address.
        </p>
        <p>
          When you choose contact-email verification for an account host, we
          read the contact address and server DID published by that host’s PDS.
          The address is used to deliver the short-lived verification message;
          the service stores a keyed fingerprint and verification evidence,
          rather than the address or verification token, with the resulting host
          claim. A DNS recovery attempt can trigger a security notice only when
          the PDS still publishes the contact address recorded, as a keyed
          fingerprint, for the original email claim.
        </p>
      </section>

      <section>
        <h2>3. How we use information</h2>
        <p>We use this information to:</p>
        <ul>
          <li>authenticate you and keep your session working;</li>
          <li>
            display directories, profiles, relationships, reviews, and
            favorites;
          </li>
          <li>
            let you select an account and return that selection securely to a
            requesting app;
          </li>
          <li>
            verify app, host, domain, and developer-environment ownership;
          </li>
          <li>
            prevent abuse, investigate reports, and protect the service; and
          </li>
          <li>diagnose faults and improve reliability and usability.</li>
        </ul>
        <p>Account cookies are used for service features, not advertising.</p>
      </section>

      <section>
        <h2>4. When information is shared</h2>
        <p>Information can be shared in these circumstances:</p>
        <ul>
          <li>
            <strong>Public records and directory pages.</strong>{" "}
            Information you publish publicly can be displayed here and
            distributed through AT Protocol or ATStore infrastructure.
          </li>
          <li>
            <strong>Account hosts and requesting apps.</strong>{" "}
            We communicate with your host to authenticate you and perform
            actions you approve. Login with Atmosphere returns the requesting
            app a short-lived, signed account-selection result; it does not send
            that app your password or this service’s OAuth refresh token.
          </li>
          <li>
            <strong>Infrastructure providers.</strong>{" "}
            Hosting, database, content-delivery, transactional-email, and
            security providers process information on our behalf to operate the
            service.
          </li>
          <li>
            <strong>Safety and legal requests.</strong>{" "}
            We may disclose information when reasonably necessary to protect
            people or the service, investigate abuse, comply with law, or
            respond to valid legal process.
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Cookies and browser storage</h2>
        <p>
          Essential cookies keep you signed in, remember your locale, protect
          OAuth flows, and—if you have used an account on this device—offer that
          account again. The signed remembered-account cookie contains account
          identifiers and can last for up to one year. It is not an account
          password or an OAuth token.
        </p>
        <p>
          Short-lived browser storage can preserve an unfinished form across an
          authorization redirect. You can remove a saved account from the
          account menu, clear site data in your browser, or use the account page
          to manage site-specific connections.
        </p>
      </section>

      <section>
        <h2>6. Retention and the open network</h2>
        <p>
          We retain information for as long as needed to operate the feature,
          keep the service secure, resolve disputes, and meet legal obligations.
          Session and authorization records expire or are removed when they are
          no longer needed. You can disconnect site-specific connections and
          revoke OAuth grants through the controls provided by this site or your
          account host.
        </p>
        <p>
          Public AT Protocol and ATStore records can be independently indexed,
          replicated, or archived. Deleting a record or listing from this site
          does not guarantee that every independent copy elsewhere on the
          network is deleted.
        </p>
      </section>

      <section>
        <h2>7. Your choices</h2>
        <p>You can:</p>
        <ul>
          <li>
            manage or remove app profiles, host profiles, reviews, favorites,
            and developer environments through their relevant controls;
          </li>
          <li>
            remove remembered accounts and clear cookies or browser storage;
          </li>
          <li>
            revoke this service’s OAuth grant through your account host; and
          </li>
          <li>
            ask a privacy question or request help with information controlled
            by this service using the contact address below.
          </li>
        </ul>
      </section>

      <section>
        <h2>8. Security</h2>
        <p>
          We use technical and organizational safeguards designed to protect the
          service, including signed and time-limited state, scoped OAuth
          permissions, access controls, request limits, and security logging. No
          system is perfectly secure, so keep your account host secure and
          report suspected vulnerabilities privately.
        </p>
      </section>

      <section>
        <h2>9. Changes and contact</h2>
        <p>
          We may update this policy as the service changes. The current version
          will remain available here with its effective date.
        </p>
        <p>
          Privacy questions can be sent to{` `}
          <a href="mailto:contact@atmosphereaccount.com">
            contact@atmosphereaccount.com
          </a>. Report security vulnerabilities through the{` `}
          <a href="https://github.com/jobiwanken0bi/atmosphere-account/security/advisories/new">
            private security advisory form
          </a>.
        </p>
        <p>
          See the <a href="/terms">Terms of Service</a>{" "}
          for the rules that apply when you use Atmosphere Account.
        </p>
      </section>
    </LegalPage>
  );
}
