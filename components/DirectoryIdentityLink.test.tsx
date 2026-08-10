import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import DirectoryIdentityLink from "./DirectoryIdentityLink.tsx";

Deno.test("app-to-host relationship links keep the visible label generic", () => {
  const html = renderToString(
    <DirectoryIdentityLink
      href="/hosts/eurosky.social"
      destination="host"
      accessibleLabel="View the Eurosky host profile"
    />,
  );

  assertStringIncludes(html, "<span>Host</span>");
  assertStringIncludes(html, 'aria-label="View the Eurosky host profile"');
  assertEquals(html.includes("Eurosky host</span>"), false);
});
