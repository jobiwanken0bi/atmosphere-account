import {
  canonicalBrowserRedirect,
  isBrowserDocumentRequest,
} from "./canonical-origin.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

const SITE = "https://atmosphereaccount.com";
const LOGIN = "https://login.atmosphereaccount.com";
const DENO = "https://atmosphere-account.atmospheremoney.deno.net";
const RAILWAY = "https://web-production-001c9.up.railway.app";

function request(
  url: string,
  method = "GET",
  headers: HeadersInit = { accept: "text/html" },
): Request {
  return new Request(url, { method, headers });
}

function redirect(
  req: Request,
  options: Parameters<typeof canonicalBrowserRedirect>[2] = {},
): Response | null {
  return canonicalBrowserRedirect(req, new URL(req.url), {
    dev: false,
    site: SITE,
    login: LOGIN,
    ...options,
  });
}

Deno.test("canonical origin redirects raw production HTML documents and preserves context", () => {
  for (const origin of [DENO, RAILWAY]) {
    const response = redirect(
      request(`${origin}/hosts/app.leafplaza.eu/claim?publish=1&from=detected`),
    );
    assertEquals(response?.status, 308);
    assertEquals(
      response?.headers.get("location"),
      `${SITE}/hosts/app.leafplaza.eu/claim?publish=1&from=detected`,
    );
    assertEquals(response?.headers.get("cache-control"), "no-store");
  }
});

Deno.test("canonical origin sends the standalone picker to its login host", () => {
  for (const method of ["GET", "POST"]) {
    const response = redirect(
      request(
        `${DENO}/login/select?request_uri=https%3A%2F%2Fapp.example`,
        method,
      ),
    );
    assertEquals(response?.status, method === "GET" ? 308 : 303);
    assertEquals(
      response?.headers.get("location"),
      `${LOGIN}/login/select?request_uri=https%3A%2F%2Fapp.example`,
    );
  }
});

Deno.test("canonical origin cannot be escaped by a protocol-relative path", () => {
  const response = redirect(
    request(`${DENO}//evil.example/collect?token=opaque`),
  );
  assertEquals(response?.status, 308);
  assertEquals(
    response?.headers.get("location"),
    `${SITE}//evil.example/collect?token=opaque`,
  );
});

Deno.test("canonical origin never replays an unsafe alias request body", () => {
  const response = redirect(
    request(`${DENO}/hosts/app.leafplaza.eu/claim?dns_token=opaque`, "POST", {
      accept: "text/html",
      origin: DENO,
      "sec-fetch-dest": "document",
    }),
  );
  assertEquals(response?.status, 303);
  assertEquals(
    response?.headers.get("location"),
    `${SITE}/hosts/app.leafplaza.eu/claim?dns_token=opaque`,
  );
});

Deno.test("canonical origin leaves trusted and non-document traffic alone", () => {
  assertEquals(redirect(request(`${SITE}/hosts`)), null);
  assertEquals(redirect(request(`${LOGIN}/signin`)), null);
  assertEquals(
    redirect(request(`${RAILWAY}/api/health/ready`, "GET", {
      accept: "application/json",
    })),
    null,
  );
  assertEquals(
    redirect(request(`${RAILWAY}/api/health/ready`, "GET", {
      accept: "*/*",
    })),
    null,
  );
  assertEquals(
    redirect(request(`${RAILWAY}/api/appview/hosts`, "POST", {
      accept: "application/json",
      "content-type": "application/json",
    })),
    null,
  );
});

Deno.test("canonical origin admits only a verified trusted AppView page hop", () => {
  const proxied = request(`${RAILWAY}/hosts/app.leafplaza.eu`, "GET", {
    accept: "text/html",
    "x-atmosphere-public-origin": SITE,
  });
  // A browser-supplied forwarding header alone is not authoritative.
  assertEquals(redirect(proxied)?.status, 308);
  assertEquals(
    redirect(proxied, { verifiedProxyOrigin: SITE }),
    null,
  );
  // Even a verified transport identity cannot bless an arbitrary origin.
  assertEquals(
    redirect(proxied, { verifiedProxyOrigin: "https://evil.example" })?.status,
    308,
  );
});

Deno.test("browser document detection covers navigation metadata without catching JSON", () => {
  assertEquals(isBrowserDocumentRequest(request(`${DENO}/hosts`)), true);
  assertEquals(
    isBrowserDocumentRequest(
      request(`${DENO}/hosts`, "POST", { "sec-fetch-dest": "document" }),
    ),
    true,
  );
  assertEquals(
    isBrowserDocumentRequest(
      request(`${DENO}/api/health/ready`, "GET", {
        accept: "application/json",
      }),
    ),
    false,
  );
});

Deno.test("development keeps direct local origins available", () => {
  const req = request("http://127.0.0.1:5173/hosts");
  assertEquals(
    canonicalBrowserRedirect(req, new URL(req.url), {
      dev: true,
      site: SITE,
      login: LOGIN,
    }),
    null,
  );
});

Deno.test("canonical browser routing runs before CSRF", async () => {
  const source = await Deno.readTextFile(
    new URL("../main.ts", import.meta.url),
  );
  const canonical = source.indexOf("app.use(canonicalOriginMiddleware)");
  const csrf = source.indexOf("app.use(csrfMiddleware)");
  assertEquals(canonical >= 0 && csrf >= 0 && canonical < csrf, true);
});
