export type AtmosphereLoginButtonMode = "redirect" | "popup";

export interface AtmosphereLoginButtonSnippetApp {
  clientId: string;
  appName: string;
  appUri?: string | null;
  logoUri?: string | null;
}

export function loginButtonSnippet(
  app: AtmosphereLoginButtonSnippetApp,
  options: {
    returnUri: string;
    mode: AtmosphereLoginButtonMode;
    scope?: string | null;
  },
): string {
  const attributes = [
    "data-atmosphere-login",
    attr("data-client-id", app.clientId),
    attr("data-return-uri", options.returnUri),
    attr("data-scope", options.scope || "atproto"),
    attr("data-mode", options.mode),
    attr("data-app-name", app.appName),
  ];
  if (app.logoUri) attributes.push(attr("data-app-logo", app.logoUri));
  if (app.appUri) attributes.push(attr("data-app-homepage", app.appUri));
  return `<button\n  ${attributes.join("\n  ")}\n></button>`;
}

export function atmosphereLoginScriptSnippet(atmosphereOrigin: string): string {
  const origin = normalizeOrigin(atmosphereOrigin);
  return `<script src="${
    htmlAttr(origin)
  }/atmosphere-login.js" defer></script>`;
}

function attr(name: string, value: string): string {
  return `${name}="${htmlAttr(value)}"`;
}

function htmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}
