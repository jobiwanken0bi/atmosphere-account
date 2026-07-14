interface Options {
  pickerOrigin: string;
  assetOrigins: string[];
  clientId: string;
  returnUri: string;
  state: string;
  requireProxyHeaders: boolean;
}

const DEFAULT_PICKER_ORIGIN = "https://login.atmosphereaccount.com";
const DEFAULT_PRIMARY_ORIGIN = "https://atmosphereaccount.com";
const DEFAULT_CLIENT_ID =
  `${DEFAULT_PRIMARY_ORIGIN}/examples/atmosphere-login/client-metadata.json`;
const DEFAULT_RETURN_URI =
  `${DEFAULT_PRIMARY_ORIGIN}/examples/atmosphere-login/callback`;

function usage(exitCode = 2): never {
  const write = exitCode === 0 ? console.log : console.error;
  write(
    [
      "Usage: deno task smoke:picker-assets [options]",
      "",
      "Checks that the hosted picker HTML, CSS, static JS, and generated Fresh",
      "assets load from the login and main Atmosphere domains.",
      "",
      "Options:",
      "  --picker-origin=https://login.atmosphereaccount.com",
      "  --asset-origin=https://login.atmosphereaccount.com  Repeatable.",
      "  --client-id=https://atmosphereaccount.com/examples/atmosphere-login/client-metadata.json",
      "  --return-uri=https://atmosphereaccount.com/examples/atmosphere-login/callback",
      "  --state=smoke",
      "  --no-proxy-header  Do not require appview proxy headers on /assets.",
    ].join("\n"),
  );
  Deno.exit(exitCode);
}

function readFlag(args: string[], flag: string): string | null {
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function readFlags(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag && args[i + 1]) {
      values.push(args[i + 1]);
      i++;
      continue;
    }
    if (arg.startsWith(`${flag}=`)) values.push(arg.slice(flag.length + 1));
  }
  return values;
}

function normalizeOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute origin URL`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be an origin without a path`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} must use http or https`);
  }
  return url.origin;
}

function parseOptions(): Options {
  const args = Deno.args.filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) usage(0);

  const pickerOrigin = normalizeOrigin(
    readFlag(args, "--picker-origin") ??
      Deno.env.get("SMOKE_PICKER_ORIGIN") ??
      DEFAULT_PICKER_ORIGIN,
    "--picker-origin",
  );
  const envAssetOrigins = (Deno.env.get("SMOKE_PICKER_ASSET_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const assetOrigins = [
    ...readFlags(args, "--asset-origin"),
    ...envAssetOrigins,
  ].map((origin) => normalizeOrigin(origin, "--asset-origin"));
  const uniqueAssetOrigins = assetOrigins.length > 0
    ? [...new Set(assetOrigins)]
    : [DEFAULT_PICKER_ORIGIN, DEFAULT_PRIMARY_ORIGIN];

  return {
    pickerOrigin,
    assetOrigins: uniqueAssetOrigins,
    clientId: readFlag(args, "--client-id") ??
      Deno.env.get("SMOKE_PICKER_CLIENT_ID") ??
      DEFAULT_CLIENT_ID,
    returnUri: readFlag(args, "--return-uri") ??
      Deno.env.get("SMOKE_PICKER_RETURN_URI") ??
      DEFAULT_RETURN_URI,
    state: readFlag(args, "--state") ??
      Deno.env.get("SMOKE_PICKER_STATE") ??
      `smoke-${Date.now()}`,
    requireProxyHeaders: !args.includes("--no-proxy-header"),
  };
}

function pickerUrl(options: Options): URL {
  const url = new URL("/login/select", options.pickerOrigin);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("return_uri", options.returnUri);
  url.searchParams.set("state", options.state);
  return url;
}

async function fetchText(
  url: URL,
): Promise<{ response: Response; text: string }> {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/javascript,text/css,*/*",
      "user-agent": "atmosphere-picker-smoke/1.0",
    },
  });
  const text = await response.text();
  return { response, text };
}

function assertStatus(response: Response, url: URL): void {
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
}

function assertContentType(
  response: Response,
  url: URL,
  expected: string,
): void {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes(expected)) {
    throw new Error(
      `${url} returned unexpected content-type ${contentType || "(missing)"}`,
    );
  }
}

function assertContains(text: string, value: string, label: string): void {
  if (!text.includes(value)) throw new Error(`${label} missing ${value}`);
}

function assertNotContains(text: string, value: string, label: string): void {
  if (text.includes(value)) {
    throw new Error(`${label} unexpectedly included ${value}`);
  }
}

function extractPaths(text: string, pattern: RegExp): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(pattern)) values.add(match[1]);
  return [...values];
}

export function isGeneratedPickerAssetPath(path: string): boolean {
  return path.startsWith("/assets/") ||
    path.startsWith("/_appview/assets/");
}

export function extractHtmlAssetPaths(html: string): {
  stylesheets: string[];
  staticScripts: string[];
  generatedAssets: string[];
} {
  return {
    stylesheets: extractPaths(html, /<link[^>]+href="([^"]+\.css[^"]*)"/g),
    staticScripts: extractPaths(
      html,
      /<script[^>]+src="([^"]+\.js[^"]*)"/g,
    ).filter((path) => !isGeneratedPickerAssetPath(path)),
    generatedAssets: extractPaths(
      html,
      /["'](\/(?:_appview\/)?assets\/[^"']+\.js)["']/g,
    ),
  };
}

export function extractJsImports(js: string, assetUrl: URL): string[] {
  const paths = extractPaths(js, /(?:from|import)\s*["']([^"']+\.js)["']/g);
  const dynamicPaths = extractPaths(js, /import\(["']([^"']+\.js)["']\)/g);
  return [...new Set([...paths, ...dynamicPaths])]
    .map((path) => new URL(path, assetUrl).pathname)
    .filter(isGeneratedPickerAssetPath);
}

async function smokePath(
  origin: string,
  path: string,
  expectedType: string,
): Promise<string> {
  const url = new URL(path, origin);
  const { response, text } = await fetchText(url);
  assertStatus(response, url);
  assertContentType(response, url, expectedType);
  return text;
}

async function smokeGeneratedAssets(
  origin: string,
  initialPaths: string[],
  requireProxyHeaders: boolean,
): Promise<number> {
  const queue = [...new Set(initialPaths)];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const url = new URL(path, origin);
    const { response, text } = await fetchText(url);
    assertStatus(response, url);
    assertContentType(response, url, "javascript");
    if (
      requireProxyHeaders &&
      response.headers.get("x-atmosphere-appview-asset-proxy") !== "1"
    ) {
      throw new Error(`${url} did not include appview asset proxy header`);
    }
    for (const importedPath of extractJsImports(text, url)) {
      if (!seen.has(importedPath)) queue.push(importedPath);
    }
  }

  return seen.size;
}

export async function main(): Promise<void> {
  const options = parseOptions();
  const loginUrl = pickerUrl(options);
  console.log(`[smoke:picker-assets] picker=${loginUrl}`);

  const { response: pickerResponse, text: pickerHtml } = await fetchText(
    loginUrl,
  );
  assertStatus(pickerResponse, loginUrl);
  assertContentType(pickerResponse, loginUrl, "html");
  assertContains(pickerHtml, "Continue with", "picker HTML");
  assertContains(pickerHtml, "login-picker-title-brand", "picker HTML");
  assertContains(pickerHtml, "/union.svg", "picker Atmosphere logo");
  assertContains(pickerHtml, ">Atmosphere</span>", "picker HTML");
  assertNotContains(
    pickerHtml,
    "Continue with Atmosphere...",
    "picker HTML",
  );
  assertContains(pickerHtml, "SignInForm", "picker island boot script");
  assertContains(pickerHtml, "/app-icon.svg", "picker reference app logo");

  const assets = extractHtmlAssetPaths(pickerHtml);
  if (assets.stylesheets.length === 0) {
    throw new Error("picker HTML did not include any stylesheets");
  }
  if (assets.staticScripts.length === 0) {
    throw new Error("picker HTML did not include any static scripts");
  }
  if (assets.generatedAssets.length === 0) {
    throw new Error("picker HTML did not include generated asset scripts");
  }

  console.log(
    `[smoke:picker-assets] html ok stylesheets=${assets.stylesheets.length} staticScripts=${assets.staticScripts.length} generated=${assets.generatedAssets.length}`,
  );

  for (const origin of options.assetOrigins) {
    for (const path of assets.stylesheets) {
      const css = await smokePath(origin, path, "css");
      assertContains(css, ".login-picker", `${origin}${path}`);
    }
    for (const path of assets.staticScripts) {
      await smokePath(origin, path, "javascript");
    }
    const generatedCount = await smokeGeneratedAssets(
      origin,
      assets.generatedAssets,
      options.requireProxyHeaders,
    );
    console.log(
      `[smoke:picker-assets] ok origin=${origin} generatedAssets=${generatedCount}`,
    );
  }
}

if (import.meta.main) await main();
