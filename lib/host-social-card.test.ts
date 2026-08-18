import {
  buildHostSocialCardSvg,
  buildHostSocialPageMeta,
  loadHostSocialFont,
} from "./host-social-card.ts";

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

Deno.test("host page metadata uses the generated card and agreed preview text", () => {
  const meta = buildHostSocialPageMeta({
    host: "pds.example.social",
    name: "Example Host",
    publicOrigin: "https://atmosphereaccount.com",
  });

  if (meta.title !== "Example Host") throw new Error("Unexpected title");
  if (meta.description !== "Atmosphere Account Host") {
    throw new Error("Unexpected description");
  }
  if (
    meta.canonicalUrl !==
      "https://atmosphereaccount.com/hosts/pds.example.social/"
  ) {
    throw new Error(`Unexpected canonical URL: ${meta.canonicalUrl}`);
  }
  if (
    meta.imageUrl !==
      "https://atmosphereaccount.com/api/og/host/pds.example.social?v=2"
  ) {
    throw new Error(`Unexpected image URL: ${meta.imageUrl}`);
  }
  if (meta.imageType !== "image/png") throw new Error("Unexpected image type");
});

Deno.test("production host cards render text as portable vector paths", async () => {
  const font = await loadHostSocialFont();
  const svg = buildHostSocialCardSvg({
    name: "Example Host",
    handle: "example.social",
    domain: "pds.example.social",
  }, font);

  assertIncludes(svg, 'data-card-text="true"');
  if (svg.includes("<text")) {
    throw new Error("Production host card still depends on runtime fonts");
  }
});
