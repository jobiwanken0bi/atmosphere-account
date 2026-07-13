import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const ORIGIN = "http://127.0.0.1:5173";
const LOGIN_ORIGIN = "http://localhost:5173";
const SERVER_READY_TIMEOUT_MS = 45_000;

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "atmosphere-login-e2e-"));
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const kid = "login-e2e";
  const privateJwk = JSON.stringify({
    ...privateKey.export({ format: "jwk" }),
    alg: "ES256",
    use: "sig",
    kid,
  });
  const publicJwk = JSON.stringify({
    ...publicKey.export({ format: "jwk" }),
    alg: "ES256",
    use: "sig",
    kid,
  });
  const server = spawn("deno", ["task", "dev", "--host", "127.0.0.1"], {
    env: {
      ...process.env,
      ATMOSPHERE_DB_BACKEND: "turso",
      TURSO_DATABASE_URL: `file:${tempDir}/e2e.db`,
      FRESH_PUBLIC_SITE_URL: ORIGIN,
      // Keep the login hostname distinct so login-domain routing is exercised
      // without classifying every app route as a login-host route.
      FRESH_PUBLIC_LOGIN_URL: LOGIN_ORIGIN,
      OAUTH_PRIVATE_JWK: privateJwk,
      OAUTH_PUBLIC_JWK: publicJwk,
      OAUTH_KID: kid,
      SESSION_SECRET: "atmosphere-login-browser-e2e-only",
      DENO_ENV: "development",
    },
    stdio: "inherit",
  });

  let browser = null;
  try {
    await waitForServer(server);
    console.log("[e2e:login] server ready; launching Chromium");
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      timeout: 15_000,
    });
    console.log("[e2e:login] Chromium launched; opening picker");
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(15_000);
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));

    const pickerResponse = await page.goto(
      `${ORIGIN}/dev/login-picker?current=local-picker.test`,
    );
    if (pickerResponse?.headers()["content-language"] !== "en") {
      throw new Error(
        "picker response did not declare its negotiated language",
      );
    }
    const documentLocale = await page.locator("html").evaluate((element) => ({
      lang: element.lang,
      dir: element.dir,
    }));
    if (documentLocale.lang !== "en" || documentLocale.dir !== "ltr") {
      throw new Error(
        `picker document locale metadata is invalid: ${
          JSON.stringify(documentLocale)
        }`,
      );
    }
    console.log("[e2e:login] picker loaded; selecting local account");
    const selectedAccount = page.locator("a.login-picker-account-row").filter({
      hasText: "local-picker.test",
    });
    if (await selectedAccount.count() !== 1) {
      throw new Error("local picker account was not rendered exactly once");
    }

    await Promise.all([
      page.waitForURL(
        `${ORIGIN}/examples/atmosphere-login/app?signed_in=1&oauth=dev_simulated`,
      ),
      selectedAccount.click(),
    ]);
    console.log("[e2e:login] OAuth handoff completed; verifying requests");

    const callbackRequest = requests.find((url) => {
      const parsed = new URL(url);
      return parsed.pathname === "/examples/atmosphere-login/callback" &&
        parsed.searchParams.has("selection_token");
    });
    const oauthStartRequest = requests.find((url) =>
      new URL(url).pathname === "/examples/atmosphere-login/oauth/start"
    );
    if (!callbackRequest) {
      throw new Error("browser did not receive a signed selection callback");
    }
    if (!oauthStartRequest) {
      throw new Error("verified callback did not redirect into OAuth start");
    }
    const resultPanel = page.locator(".login-example-result");
    const finalState = resultPanel.getByText("Local dev account selected", {
      exact: false,
    });
    if (!await finalState.isVisible()) {
      throw new Error("example app did not reach its post-OAuth session state");
    }
    if (!await resultPanel.getByText("local-picker.test").isVisible()) {
      throw new Error("final app session did not retain the selected account");
    }

    console.log(
      "[e2e:login] ok picker selection -> signed callback verification -> OAuth start -> app session",
    );
  } finally {
    await browser?.close().catch(() => {});
    if (server.exitCode === null) server.kill("SIGTERM");
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]).catch(() => {});
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function waitForServer(server) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_READY_TIMEOUT_MS) {
    if (server.exitCode !== null) {
      throw new Error(
        `dev server exited before E2E (code ${server.exitCode})`,
      );
    }
    try {
      const response = await fetch(`${ORIGIN}/api/health`, {
        signal: AbortSignal.timeout(1_000),
        redirect: "manual",
      });
      // The E2E intentionally serves the picker and example app on one origin.
      // Login-domain middleware therefore redirects ordinary health routes;
      // any non-error HTTP response still proves the Fresh server is ready.
      if (response.status < 500) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("timed out waiting for the local Atmosphere server");
}

await main();
