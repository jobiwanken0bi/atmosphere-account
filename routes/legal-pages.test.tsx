import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import { PrivacyPage } from "./privacy.tsx";
import { TermsPage } from "./terms.tsx";

const ANONYMOUS_ACCOUNT = {
  user: null,
  hasManagedAppProfile: false,
  hasManagedHostProfiles: false,
  hasManagedProfiles: false,
  accountType: null,
  avatarUrl: null,
  publicProfileHandle: null,
  accountHost: null,
  rememberedAccounts: [],
};

Deno.test("legal pages are public, navigable, and cross-linked", () => {
  const terms = renderToString(<TermsPage account={ANONYMOUS_ACCOUNT} />);
  const privacy = renderToString(<PrivacyPage account={ANONYMOUS_ACCOUNT} />);

  for (const [name, html] of [["terms", terms], ["privacy", privacy]]) {
    assertStringIncludes(html, '<main id="main-content"');
    assertStringIncludes(html, '<time datetime="2026-08-12"');
    assertStringIncludes(
      html,
      'href="mailto:contact@atmosphereaccount.com"',
    );
    assertStringIncludes(html, 'href="/terms"');
    assertStringIncludes(html, 'href="/privacy"');
    assertStringIncludes(html, 'href="/docs"');
    assertEquals(html.includes('href="/signin"'), false, name);
  }

  assertStringIncludes(terms, "Terms of Service");
  assertStringIncludes(terms, "Login with Atmosphere");
  assertStringIncludes(privacy, "Privacy Policy");
  assertStringIncludes(privacy, "Cookies and browser storage");
  assertStringIncludes(privacy, "contact-email verification");
  assertStringIncludes(privacy, "transactional-email");
  assertStringIncludes(terms, "published contact mailbox");
});
