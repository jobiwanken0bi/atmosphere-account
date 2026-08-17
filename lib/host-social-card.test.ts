import { buildHostSocialCardSvg } from "./host-social-card.ts";

function assertIncludes(value: string, expected: string): void {
  if (!value.includes(expected)) {
    throw new Error(`Expected social card SVG to include ${expected}`);
  }
}

Deno.test("host social card renders host identity in the Atmosphere design", () => {
  const svg = buildHostSocialCardSvg({
    name: "Example & Friends",
    handle: "example.social",
    domain: "pds.example.social",
    avatarDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    handleIconDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
  });

  assertIncludes(svg, "Example &amp; Friends");
  assertIncludes(svg, "ATMOSPHERE ACCOUNT HOST");
  assertIncludes(svg, ">example.social</text>");
  assertIncludes(svg, "data:image/svg+xml;base64,PHN2Zy8+");
  assertIncludes(svg, "pds.example.social");
  assertIncludes(svg, "data:image/png;base64,iVBORw0KGgo=");
  assertIncludes(svg, 'width="1200" height="630"');
});

Deno.test("host social card falls back to a monogram", () => {
  const svg = buildHostSocialCardSvg({
    name: "Long Example Hosting Service",
    domain: "host.example",
  });
  assertIncludes(svg, ">L</text>");
  assertIncludes(svg, "Long Example Hosting");
});
