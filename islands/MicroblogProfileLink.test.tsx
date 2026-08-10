import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import MicroblogProfileLink from "./MicroblogProfileLink.tsx";

Deno.test("microblog profile link follows the selected viewer", () => {
  const html = renderToString(
    h(MicroblogProfileLink, {
      selectedClientId: "mu",
      handle: "joebasser.com",
    }),
  );

  assertStringIncludes(
    html,
    'href="https://mu.social/profile/joebasser.com"',
  );
  assertStringIncludes(html, 'src="/atmosphere-apps/mu-social.webp"');
  assertStringIncludes(html, "Manage profile");
  assertStringIncludes(html, "in Mu");
  assertEquals(html.includes("bsky.app/profile"), false);
});

Deno.test("microblog profile link falls back to Bluesky", () => {
  const html = renderToString(
    h(MicroblogProfileLink, {
      selectedClientId: "unknown",
      handle: "joebasser.com",
    }),
  );

  assertStringIncludes(
    html,
    'href="https://bsky.app/profile/joebasser.com"',
  );
  assertStringIncludes(html, "in Bluesky");
});
