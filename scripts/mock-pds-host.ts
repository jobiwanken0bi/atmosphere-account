#!/usr/bin/env -S deno run -A

const port = readPort(Deno.args.filter((arg) => arg !== "--"));
const hostname = "127.0.0.1";
const host = "mock-pds.test";
const origin = `http://${hostname}:${port}`;
const abort = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  try {
    Deno.addSignalListener(signal, () => abort.abort());
  } catch {
    // Signal listeners are not available in every runtime.
  }
}

const server = Deno.serve(
  { hostname, port, signal: abort.signal },
  (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/xrpc/_health") {
      return json({ status: "ok", version: "atmosphere-mock-pds-v0.1" });
    }
    if (url.pathname === "/xrpc/com.atproto.server.describeServer") {
      return json({
        did: "did:web:mock-pds.test",
        availableUserDomains: [`.${host}`],
        inviteCodeRequired: false,
        links: {
          privacyPolicy: `${origin}/privacy`,
          termsOfService: `${origin}/terms`,
        },
        contact: { email: "operator@mock-pds.test" },
      });
    }
    if (url.pathname === "/.well-known/atmosphere-host-dashboard.json") {
      return json({
        version: "atmosphere.hostDashboard.v0.1",
        host,
        displayName: "Atmosphere Mock PDS",
        dashboardUrl: `${origin}/account`,
        supportUrl: `${origin}/support`,
        capabilities: {
          accountOverview: { state: "supported", href: `${origin}/account` },
          connectedApps: {
            state: "supported",
            href: `${origin}/account/apps`,
          },
          support: { state: "supported", href: `${origin}/support` },
        },
      });
    }
    if (url.pathname === "/account" || url.pathname === "/account/apps") {
      return html(
        `<!doctype html><html><head><title>Mock PDS account</title></head>
      <body><h1>Mock PDS account management</h1><p>${url.pathname}</p></body></html>`,
      );
    }
    if (["/support", "/privacy", "/terms"].includes(url.pathname)) {
      return html(
        `<!doctype html><html><body><h1>${
          url.pathname.slice(1)
        }</h1></body></html>`,
      );
    }
    return new Response("not found", { status: 404 });
  },
);

console.log(`[host:mock] listening ${origin} as ${host}`);
await server.finished;

function readPort(args: string[]): number {
  const raw = args.find((arg) => arg.startsWith("--port="))?.slice(7) ?? "8787";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error("--port must be an integer from 1 to 65535");
  }
  return value;
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function html(value: string): Response {
  return new Response(value, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
