import LegalPage from "../components/LegalPage.tsx";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import { define } from "../utils.ts";

export const handler = define.handlers({
  GET(ctx) {
    ctx.state.pageMeta = {
      title: "Terms of Service — Atmosphere Account",
      description:
        "The terms that apply when you use Atmosphere Account, its directories, profiles, and Login with Atmosphere.",
      canonicalUrl: new URL("/terms", ctx.url.origin).href,
    };
    return ctx.render(
      <TermsPage account={buildAccountMenuProps(ctx.state)} />,
    );
  },
});

export function TermsPage(
  { account }: {
    account: ReturnType<typeof buildAccountMenuProps>;
  },
) {
  return (
    <LegalPage
      account={account}
      title="Terms of Service"
      summary="These terms explain the rules for using Atmosphere Account and the responsibilities that remain with you, your account host, and the apps you choose."
    >
      <section>
        <h2>1. About the service</h2>
        <p>
          These terms govern your use of atmosphereaccount.com,
          login.atmosphereaccount.com, and related Atmosphere Account services.
          By using the service, you agree to these terms.
        </p>
        <p>
          Atmosphere Account is an open-source directory, profile-management,
          and account-selection service for the AT Protocol ecosystem. It helps
          people discover apps and account hosts, manage app and host profiles,
          publish reviews and favorites, and choose an account through Login
          with Atmosphere.
        </p>
        <p>
          Atmosphere Account is not your account host or personal data server
          (PDS). Your host manages your account credentials, recovery, data, and
          the OAuth grants you approve. A destination app must still obtain its
          own authorization from your host.
        </p>
      </section>

      <section>
        <h2>2. Using Atmosphere Account</h2>
        <p>You agree to:</p>
        <ul>
          <li>provide accurate information and keep it reasonably current;</li>
          <li>
            manage only accounts, app profiles, host domains, and developer
            settings that you are authorized to control;
          </li>
          <li>
            review the permissions shown by your account host before approving
            an OAuth request; and
          </li>
          <li>
            use the service lawfully and without interfering with other people
            or the service itself.
          </li>
        </ul>
        <p>
          You are responsible for the security of your account host and for
          activity performed with your account.
        </p>
      </section>

      <section>
        <h2>3. Profiles, reviews, and other content</h2>
        <p>
          You keep your rights in content you submit or publish. You give us
          permission to process, index, display, and distribute that content as
          needed to operate and improve the service.
        </p>
        <p>
          App profiles, host profiles, relationships, reviews, and favorites may
          be public AT Protocol or ATStore records. Public records can be
          copied, indexed, or retained by independent network participants
          outside our control. Removing a copy from this site may not remove
          copies held elsewhere on the network.
        </p>
      </section>

      <section>
        <h2>4. Login with Atmosphere and third-party services</h2>
        <p>
          Login with Atmosphere helps you select an account and sends the
          requesting app a short-lived account-selection result. It does not
          give that app access to your repository. The app must begin its own AT
          Protocol OAuth flow, and your account host decides whether to issue
          that separate grant.
        </p>
        <p>
          Apps, account hosts, links, and other services shown here are operated
          by third parties. Their own terms and privacy policies apply when you
          use them. A listing, connection, or trust indicator is not a guarantee
          that a third-party service will always be available, secure, or right
          for you.
        </p>
      </section>

      <section>
        <h2>5. Prohibited conduct</h2>
        <p>You may not use Atmosphere Account to:</p>
        <ul>
          <li>
            impersonate another person or falsely claim control of a domain;
          </li>
          <li>
            publish unlawful, infringing, deceptive, abusive, or malicious
            content;
          </li>
          <li>
            bypass access controls, rate limits, moderation, or security
            protections;
          </li>
          <li>
            probe for or access accounts, credentials, records, or systems you
            are not authorized to use; or
          </li>
          <li>
            disrupt the service, distribute malware, or use automated traffic
            that places an unreasonable load on the service.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Moderation and access</h2>
        <p>
          We may hide content, limit features, suspend access, or preserve
          evidence when reasonably necessary to protect people, enforce these
          terms, comply with law, or secure the service. We may also reject or
          remove profiles and developer configurations that cannot be verified
          or that create safety risks.
        </p>
      </section>

      <section>
        <h2>7. Availability and changes</h2>
        <p>
          The service is provided on an “as is” and “as available” basis. We may
          change, suspend, or discontinue features, and open protocols or
          third-party services may change independently. To the fullest extent
          permitted by law, we disclaim implied warranties and are not liable
          for indirect, incidental, special, consequential, or punitive damages
          arising from your use of the service.
        </p>
        <p>
          Nothing in these terms limits rights or remedies that cannot legally
          be limited. If you do not agree to a material update, stop using the
          service. We will post the current terms here and update the effective
          date when they change.
        </p>
      </section>

      <section>
        <h2>8. Contact</h2>
        <p>
          Questions about these terms can be sent to{` `}
          <a href="mailto:contact@atmosphereaccount.com">
            contact@atmosphereaccount.com
          </a>. Security vulnerabilities should be reported through the{` `}
          <a href="https://github.com/jobiwanken0bi/atmosphere-account/security/advisories/new">
            private security advisory form
          </a>, not a public issue.
        </p>
        <p>
          See the <a href="/privacy">Privacy Policy</a>{" "}
          for details about how the service handles information.
        </p>
        <p>
          The repository’s MIT license governs use of the open-source code
          separately from these terms.
        </p>
      </section>
    </LegalPage>
  );
}
