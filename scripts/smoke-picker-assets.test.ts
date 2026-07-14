import {
  extractHtmlAssetPaths,
  extractJsImports,
  isGeneratedPickerAssetPath,
} from "./smoke-picker-assets.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("picker smoke recognizes direct and appview-namespaced assets", () => {
  const html = [
    '<link rel="stylesheet" href="/styles.css">',
    '<script src="/signin-preview.js"></script>',
    '<script type="module">import { boot } from "/_appview/assets/client.js";</script>',
    '<script src="/assets/legacy-client.js"></script>',
  ].join("");
  const assets = extractHtmlAssetPaths(html);

  assertEquals(assets.stylesheets, ["/styles.css"]);
  assertEquals(assets.staticScripts, ["/signin-preview.js"]);
  assertEquals(assets.generatedAssets, [
    "/_appview/assets/client.js",
    "/assets/legacy-client.js",
  ]);
  assertEquals(isGeneratedPickerAssetPath("/static/app.js"), false);
});

Deno.test("picker smoke follows imports within the appview asset namespace", () => {
  const imports = extractJsImports(
    [
      'import value from "./shared.js";',
      'import("/assets/legacy.js");',
      'import("/static/ignored.js");',
    ].join(""),
    new URL("https://example.com/_appview/assets/client.js"),
  );

  assertEquals(imports, [
    "/_appview/assets/shared.js",
    "/assets/legacy.js",
  ]);
});
