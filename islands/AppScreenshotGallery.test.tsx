import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import AppScreenshotGallery from "./AppScreenshotGallery.tsx";

function screenshots(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    src: `https://cdn.example/screenshot-${index + 1}.png`,
    alt: `Example screenshot ${index + 1}`,
  }));
}

Deno.test("AppScreenshotGallery keeps the ATStore maximum in one four-column gallery", () => {
  const html = renderToString(h(AppScreenshotGallery, {
    appName: "Example",
    screenshots: screenshots(5),
  }));

  assertStringIncludes(html, ">Screenshots</h2>");
  assertEquals(html.includes(">Media</h2>"), false);
  assertStringIncludes(html, "profile-screenshot-grid--4");
  assertEquals(html.match(/aria-haspopup="dialog"/g)?.length, 4);
  assertEquals(html.includes("screenshot-5.png"), false);
});

Deno.test("AppScreenshotGallery exposes mobile carousel controls and viewer triggers", () => {
  const html = renderToString(h(AppScreenshotGallery, {
    appName: "Example",
    screenshots: screenshots(3),
  }));

  assertStringIncludes(html, 'aria-label="Previous screenshot"');
  assertStringIncludes(html, 'aria-label="Next screenshot"');
  assertStringIncludes(
    html,
    'aria-label="Open Example screenshot 1 of 3"',
  );
  assertStringIncludes(html, "1 / 3");
});
