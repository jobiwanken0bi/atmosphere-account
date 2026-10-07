import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const requestedPort = Number.parseInt(process.env.E2E_PORT ?? "5173", 10);
if (
  !Number.isSafeInteger(requestedPort) || requestedPort < 1 ||
  requestedPort > 65_535
) {
  throw new Error("E2E_PORT must be a valid TCP port");
}
const ORIGIN = `http://127.0.0.1:${requestedPort}`;
const LOGIN_ORIGIN = `http://localhost:${requestedPort}`;
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
  const server = spawn(
    "deno",
    process.env.E2E_COMPILED === "1"
      ? [
        "serve",
        "-A",
        "--host",
        "127.0.0.1",
        "--port",
        String(requestedPort),
        "_fresh/server.js",
      ]
      : ["task", "dev", "--host", "127.0.0.1", "--port", String(requestedPort)],
    {
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
    },
  );

  let browser = null;
  try {
    await waitForServer(server);
    console.log("[e2e:login] server ready; launching Chromium");
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      timeout: 15_000,
    });
    await smokePublicExperience(browser);
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
    await smokeInlineAccountEntry(browser, page);
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

async function smokeInlineAccountEntry(browser, page) {
  const pickerUrl = page.url();
  const disclosure = page.locator("details.signin-account-entry");
  const summary = disclosure.locator("summary");
  const input = disclosure.locator("input[name=handle]");
  await disclosure.waitFor();
  await page.waitForFunction(() =>
    document.querySelector("[data-signin-disclosure]")?.dataset
      .signinDisclosureEnhanced === "true"
  );
  if (
    (await page.locator(".login-picker-account-action").allTextContents()).some(
      (text) => text !== "Continue",
    )
  ) throw new Error("saved picker actions must say Continue");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await summary.click();
    await input.waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute("name") === "handle"
    );
    if (
      new URL(page.url()).pathname !== "/login/select" ||
      !await page.locator(".login-picker-account-row").first().isVisible()
    ) {
      throw new Error(
        "inline entry replaced the saved accounts or navigated away",
      );
    }
    if (
      await page.getByText("Enter your account handle", { exact: true })
        .count() ||
      await page.getByText("Already use Bluesky?", { exact: true }).count()
    ) throw new Error("redundant sign-in copy returned");
    await page.waitForFunction(() =>
      document.querySelector("[data-signin-disclosure-body]").getAnimations()
        .length === 0
    );
    await assertPageShell(page, "expanded picker");
    await assertMinimumTarget(page, "details.signin-account-entry summary", 44);
    await input.press("Escape");
    await page.waitForFunction(() =>
      !document.querySelector("details.signin-account-entry").open
    );
    await summary.press("Enter");
    await input.waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      document.querySelector("[data-signin-disclosure-body]").getAnimations()
        .length === 0
    );
    await summary.click();
    await page.waitForFunction(() =>
      !document.querySelector("details.signin-account-entry").open
    );
  }
  await summary.click();
  await summary.click();
  await summary.click();
  await page.waitForFunction(() =>
    document.querySelector("details.signin-account-entry").open &&
    document.querySelector("[data-signin-disclosure-body]").getAnimations()
        .length === 0
  );
  await input.fill("interrupted.example");
  await summary.click();
  await page.waitForFunction(() =>
    !document.querySelector("details.signin-account-entry").open
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await summary.click();
  if (
    await page.locator("[data-signin-disclosure-body]").evaluate((node) =>
      node.getAnimations().length
    ) !== 0
  ) throw new Error("reduced motion animated disclosure");
  await input.fill("new-account.example");
  await summary.click();
  await summary.click();
  if (await input.inputValue() !== "new-account.example") {
    throw new Error("disclosure cleared handle input");
  }
  const oauthRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/oauth/login"
  );
  await page.route(
    "**/oauth/login?*",
    (route) => route.fulfill({ status: 204 }),
  );
  await disclosure.getByRole("button", { name: "Continue", exact: true })
    .click();
  const started = new URL((await oauthRequest).url());
  const original = new URL(pickerUrl);
  const next = new URL(started.searchParams.get("next"), original.origin);
  for (const key of ["client_id", "return_uri", "state", "scope"]) {
    if (next.searchParams.get(key) !== original.searchParams.get(key)) {
      throw new Error("inline handle entry changed picker binding");
    }
  }
  if (
    started.searchParams.get("continuation") !== "login_selection" ||
    started.searchParams.getAll("capability").join() !== "identity" ||
    started.searchParams.get("choose") !== "another" ||
    started.searchParams.get("handle") !== "new-account.example"
  ) throw new Error("inline entry lost identity-only another-account context");
  await page.unroute("**/oauth/login?*");
  const legacy = new URL("/signin", original.origin);
  legacy.search = new URLSearchParams({
    next: original.pathname + original.search,
    continuation: "login_selection",
    action: "account",
    capability: "identity",
    choose: "another",
  });
  await page.goto(legacy.href, { waitUntil: "domcontentloaded" });
  if (
    new URL(page.url()).pathname !== "/login/select" || !await input.isVisible()
  ) {
    throw new Error(
      "legacy picker sign-in did not consolidate into expanded account entry",
    );
  }
  await page.goto(pickerUrl, { waitUntil: "domcontentloaded" });
  await page.emulateMedia({ reducedMotion: null });

  const delayed = await browser.newContext();
  try {
    const early = await delayed.newPage();
    let releaseEnhancer;
    const gate = new Promise((resolve) => {
      releaseEnhancer = resolve;
    });
    await early.route("**/signin-preview.js*", async (route) => {
      await gate;
      await route.continue();
    });
    await early.goto(`${ORIGIN}/dev/login-picker?current=local-picker.test`, {
      waitUntil: "commit",
    });
    await early.locator("details.signin-account-entry summary").click();
    releaseEnhancer();
    await early.waitForFunction(() =>
      document.querySelector("[data-signin-disclosure]")?.dataset
        .signinDisclosureEnhanced === "true"
    );
    if (
      !await early.locator("input[name=handle]").isVisible() ||
      await early.locator("[data-signin-disclosure-body]").evaluate((node) =>
        node.inert
      )
    ) throw new Error("enhancement lost a native disclosure open");
    await early.locator("details.signin-account-entry summary").click();
    await early.waitForFunction(() =>
      !document.querySelector("details.signin-account-entry").open
    );
  } finally {
    await delayed.close();
  }

  const noJs = await browser.newContext({ javaScriptEnabled: false });
  try {
    const native = await noJs.newPage();
    await native.goto(`${ORIGIN}/dev/login-picker?current=local-picker.test`);
    await native.locator("details.signin-account-entry summary").click();
    if (!await native.locator("input[name=handle]").isVisible()) {
      throw new Error("native disclosure failed without JavaScript");
    }
    // The local fixture uses separate public/login hostnames. Seed its
    // fictional cookies on the login host to exercise the generic saved list.
    const fixtureCookies = await noJs.cookies(ORIGIN);
    await noJs.addCookies(
      fixtureCookies.map((cookie) => ({ ...cookie, domain: "localhost" })),
    );
    await native.goto(`${LOGIN_ORIGIN}/signin?choose=another&next=%2Faccount`);
    await native.locator("details.signin-account-entry summary").click();
    if (!await native.locator("input[name=handle]").isVisible()) {
      throw new Error("generic sign-in disclosure failed without JavaScript");
    }
  } finally {
    await noJs.close();
  }
  console.log(
    "[e2e:login] ok inline account entry, keyboard, phone/desktop, reduced motion, OAuth bindings, legacy consolidation and no-JS fallback",
  );
}

async function smokePublicExperience(browser) {
  console.log(
    "[e2e:login] checking public journeys at phone and desktop widths",
  );
  const page = await browser.newPage({
    viewport: { width: 333, height: 844 },
  });
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(15_000);

  try {
    for (const path of ["/", "/apps", "/apps/all", "/hosts"]) {
      await openSuccessfulPage(page, `${ORIGIN}${path}`);
      await assertPageShell(page, path);
    }

    await page.setViewportSize({ width: 1_440, height: 900 });
    for (const path of ["/", "/apps", "/hosts"]) {
      await openSuccessfulPage(page, `${ORIGIN}${path}`);
      await assertPageShell(page, `${path} desktop`);
    }

    const createUrl = new URL("/signin", LOGIN_ORIGIN);
    createUrl.searchParams.set("next", "/apps?from=e2e");
    createUrl.searchParams.set("action", "app");
    createUrl.searchParams.append("capability", "app");
    createUrl.searchParams.append("capability", "media");
    createUrl.searchParams.set("mode", "create");
    await page.setViewportSize({ width: 333, height: 844 });
    await openSuccessfulPage(page, createUrl.href);
    await assertPageShell(page, "create account");
    if (
      !await page.getByRole("heading", {
        name: "Create an Atmosphere account",
      }).isVisible()
    ) {
      throw new Error("create-account mode did not render its canonical page");
    }
    if (await page.locator(".signin-create-explainer-card").count() !== 2) {
      throw new Error("create-account ownership and portability cards missing");
    }
    if (
      !await page.locator('.signin-create-explainer a[href="/apps"]')
        .isVisible()
    ) {
      throw new Error(
        "create-account explainer did not link to the app directory",
      );
    }
    if (await page.getByText("New account", { exact: true }).count() !== 0) {
      throw new Error("retired New account eyebrow returned");
    }

    const signInUrl = new URL(createUrl);
    signInUrl.searchParams.delete("mode");
    await openSuccessfulPage(page, signInUrl.href);
    await assertPageShell(page, "login page");
    if (
      !await page.getByRole("heading", {
        name: "Login with Atmosphere",
      }).isVisible()
    ) {
      throw new Error("universal login heading is not canonical");
    }
    await assertMinimumTarget(page, ".signin-form-submit", 44);
  } finally {
    await page.close();
  }
}

async function openSuccessfulPage(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  if (!response || response.status() >= 400) {
    throw new Error(`${url} returned HTTP ${response?.status() ?? "unknown"}`);
  }
  await page.waitForTimeout(75);
}

async function assertPageShell(page, label) {
  const shell = await page.evaluate(() => {
    const main = document.querySelector("#main-content");
    return {
      mainCount: document.querySelectorAll("#main-content").length,
      mainTag: main?.tagName ?? null,
      overflow: document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
  if (shell.mainCount !== 1 || shell.mainTag !== "MAIN") {
    throw new Error(
      `${label} must expose exactly one #main-content MAIN landmark`,
    );
  }
  if (shell.overflow > 1) {
    throw new Error(`${label} overflows horizontally by ${shell.overflow}px`);
  }
}

async function assertMinimumTarget(page, selector, minimumPixels) {
  const box = await page.locator(selector).boundingBox();
  if (!box || box.height < minimumPixels || box.width < minimumPixels) {
    throw new Error(
      `${selector} must be at least ${minimumPixels}px in both dimensions`,
    );
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
