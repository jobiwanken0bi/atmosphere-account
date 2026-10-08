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
    await smokeDocsAccessibility(browser);
    await smokeActionHoverColors(browser);
    await smokeEarlyAvatarFailure(browser);
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
  // Exercise the real login-domain router without an upstream search request.
  // Browser response fixtures below must not conceal cross-origin redirects.
  const previewEndpoint = `${LOGIN_ORIGIN}/api/identity/preview?handle=`;
  const previewResponse = await page.request.get(previewEndpoint, {
    maxRedirects: 0,
  });
  if (
    previewResponse.status() !== 200 ||
    (await previewResponse.json()).reason !== "invalid_handle"
  ) {
    throw new Error("login-origin handle typeahead is not served in place");
  }
  await page.route("**/api/identity/preview?*", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("handle")?.startsWith(
        "delayed",
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        found: true,
        matches: [{
          did: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
          handle: "preview-picker.test",
          displayName: "Preview account",
        }],
      }),
    }).catch(() => {});
  });
  const pickerUrl = page.url();
  const disclosure = page.locator("details.signin-account-entry");
  const summary = disclosure.locator("summary");
  const input = disclosure.getByRole("textbox", {
    name: "Atmosphere handle",
    exact: true,
  });
  let escapeReachedDialog = false;
  await page.exposeFunction("reportPickerEscapeToDialog", () => {
    escapeReachedDialog = true;
  });
  await page.evaluate(() => {
    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        event.target.closest("[data-signin-disclosure-body]")
      ) globalThis.reportPickerEscapeToDialog();
    });
  });
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
  for (const width of [320, 390, 1440]) {
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
    const lastAccount = await page.locator(".login-picker-account-row").last()
      .boundingBox();
    const toggleBox = await summary.boundingBox();
    const handleBox = await input.boundingBox();
    const continueBox = await disclosure.getByRole("button", {
      name: "Continue",
      exact: true,
    }).boundingBox();
    const createBox = await disclosure.locator(".signin-create-account-link")
      .boundingBox();
    const labelBox = await disclosure.locator("label").boundingBox();
    if (
      Math.abs(toggleBox.y - (lastAccount.y + lastAccount.height)) > 2 ||
      Math.abs(handleBox.y - continueBox.y) > 1 ||
      continueBox.x < handleBox.x + handleBox.width ||
      createBox.y - (handleBox.y + handleBox.height) < 8 ||
      labelBox.width > 1 || labelBox.height > 1
    ) {
      throw new Error(
        "picker entry has a row gap, visible label or stacked/touching actions: " +
          JSON.stringify({
            width,
            lastAccount,
            toggleBox,
            handleBox,
            continueBox,
            createBox,
            labelBox,
          }),
      );
    }
    await input.fill("preview");
    const suggestion = disclosure.getByRole("button", {
      name: /Preview account/,
    });
    await suggestion.waitFor({ state: "visible" });
    const suggestionBox = await suggestion.boundingBox();
    const unobstructed = await suggestion.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return node.contains(
        document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        ),
      );
    });
    if (!unobstructed || suggestionBox.width < handleBox.width) {
      throw new Error(
        "picker typeahead is clipped or does not use the handle/action row",
      );
    }
    await input.press("ArrowDown");
    await suggestion.press("Enter");
    if (await input.inputValue() !== "preview-picker.test") {
      throw new Error("keyboard typeahead selection did not fill the handle");
    }
    await page.waitForTimeout(250);
    if (await suggestion.isVisible()) {
      throw new Error("typeahead reopened after selecting an account");
    }
    await disclosure.getByRole("button", { name: "Clear selected account" })
      .click();
    if (await input.inputValue()) {
      throw new Error("selected account did not clear");
    }
    if (width === 390) {
      for (const dismissal of ["escape", "outside"]) {
        const pendingLookup = page.waitForRequest((request) =>
          new URL(request.url()).searchParams.get("handle") ===
            `delayed-${dismissal}`
        );
        await input.fill(`delayed-${dismissal}`);
        await pendingLookup;
        if (dismissal === "escape") await input.press("Escape");
        else {await page.getByRole("heading", {
            name: "Login with Atmosphere",
            exact: true,
          }).click();}
        await page.waitForTimeout(500);
        if (await disclosure.locator(".signin-form-preview").isVisible()) {
          throw new Error("pending typeahead reopened after " + dismissal);
        }
      }
      await input.fill("preview");
      await suggestion.waitFor({ state: "visible" });
      await input.press("ArrowDown");
      await suggestion.press("Escape");
      await page.waitForTimeout(250);
      if (
        await suggestion.isVisible() ||
        !await input.evaluate((node) => node === document.activeElement)
      ) {
        throw new Error(
          "suggestion Escape reopened lookup or lost input focus",
        );
      }
      await input.fill("");
    }
    await input.dispatchEvent("keydown", { key: "Escape", isComposing: true });
    if (!await disclosure.evaluate((node) => node.open)) {
      throw new Error("IME Escape collapsed account entry");
    }
    await input.press("Escape");
    await page.waitForFunction(() =>
      !document.querySelector("details.signin-account-entry").open
    );
    if (escapeReachedDialog) {
      throw new Error(
        "disclosure Escape reached the surrounding dialog handler",
      );
    }
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
  await page.unroute("**/api/identity/preview?*");
  await page.emulateMedia({ reducedMotion: null });

  const direct = await browser.newPage();
  try {
    let composingEscapeReachedDialog = false;
    await direct.exposeFunction("reportDirectImeEscape", () => {
      composingEscapeReachedDialog = true;
    });
    await direct.goto(`${LOGIN_ORIGIN}/signin?choose=another&next=%2Faccount`);
    await direct.waitForFunction(() =>
      document.querySelector("form[data-signin-preview-enhanced=true]")
    );
    if (await direct.locator("details.signin-account-entry").count()) {
      throw new Error("direct IME fixture unexpectedly has a disclosure");
    }
    await direct.evaluate(() => {
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") globalThis.reportDirectImeEscape();
      });
    });
    await direct.locator("input[name=handle]").dispatchEvent("keydown", {
      key: "Escape",
      isComposing: true,
    });
    if (composingEscapeReachedDialog) {
      throw new Error("direct handle IME Escape reached dialog handler");
    }
  } finally {
    await direct.close();
  }

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
    for (const path of ["/apps/all", "/hosts"]) {
      await openSuccessfulPage(page, `${ORIGIN}${path}`);
      await assertFilterEscapeFocus(page, ".hosts-filter-menu");
    }
    await openSuccessfulPage(page, createUrl.href);
    await assertFilterEscapeFocus(page, ".signin-host-filter-menu");
  } finally {
    await page.close();
  }
}

async function assertFilterEscapeFocus(page, selector) {
  console.log(
    `[e2e:login] checking filter focus at ${new URL(page.url()).pathname}`,
  );
  const menu = page.locator(selector);
  await page.locator(`${selector}[data-filter-keyboard-ready="true"]`)
    .waitFor();
  const summary = menu.locator("summary");
  await summary.press("Enter");
  const field = menu.locator("select").first();
  await field.waitFor({ state: "visible" });
  await field.press("Escape");
  await page.waitForFunction((selector) => {
    const menu = document.querySelector(selector);
    return !menu.open &&
      document.activeElement === menu.querySelector("summary");
  }, selector);
  // Mouse-opened native disclosures may leave focus on the page body.
  await summary.click();
  await menu.locator(".hosts-filter-popover").click({
    position: { x: 100, y: 6 },
  });
  await page.waitForFunction(() => document.activeElement === document.body);
  await page.keyboard.press("Escape");
  await page.waitForFunction((selector) => {
    const menu = document.querySelector(selector);
    return !menu.open &&
      document.activeElement === menu.querySelector("summary");
  }, selector);
}

async function smokeDocsAccessibility(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  try {
    for (const width of [320, 640, 641, 700, 760, 761, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (
        const path of ["/docs", "/docs/atmosphere-login", "/docs/reference"]
      ) {
        console.log(`[e2e:login] checking docs ${path} at ${width}px`);
        await openSuccessfulPage(page, `${ORIGIN}${path}`);
        await assertPageShell(page, `${path} ${width}px`);
        await assertMinimumTarget(page, ".docs-toc-summary", 44);
        await assertMinimumTarget(page, ".nav-logo", 44);
        if (width <= 760) {
          const compactNavigation = await page.locator(".docs-sidebar")
            .evaluate((sidebar) => {
              const nav = sidebar.querySelector(".docs-nav");
              const links = [...nav.querySelectorAll("a")];
              const first = links[0].getBoundingClientRect();
              return getComputedStyle(nav).display === "flex" &&
                sidebar.getBoundingClientRect().height < 120 &&
                links.every((link) => {
                  const box = link.getBoundingClientRect();
                  return box.height >= 43.5 && box.height < 60 &&
                    Math.abs(box.top - first.top) < 1;
                });
            });
          if (!compactNavigation) {
            throw new Error(`docs navigation stretched at ${width}px`);
          }
        }
        const undersizedActions = await page.locator(".docs-hero-cta")
          .evaluateAll((nodes) =>
            nodes.some((node) => {
              const box = node.getBoundingClientRect();
              return box.height < 43.5 || box.width < 43.5;
            })
          );
        if (undersizedActions) throw new Error("docs hero action is too small");
        if (await page.locator(".docs-table-wrap").count()) {
          const table = page.locator(".docs-table-wrap").first();
          await table.press("ArrowRight");
          await page.waitForFunction(() => {
            const table = document.querySelector(".docs-table-wrap");
            return document.activeElement === table &&
              (table.scrollWidth <= table.clientWidth || table.scrollLeft > 0);
          });
        }
        if (await page.locator(".docs-code pre").count()) {
          const code = page.locator(".docs-code pre").first();
          const copyTargets = await page.locator(".docs-code-copy").evaluateAll(
            (buttons) =>
              buttons.every((button) => {
                const box = button.getBoundingClientRect();
                return box.width >= 44 && box.height >= 44;
              }),
          );
          if (!copyTargets) {
            throw new Error("code-copy targets are smaller than 44px");
          }
          if (!await code.getAttribute("aria-label")) {
            throw new Error("scrolling code example has no accessible name");
          }
          await code.press("ArrowRight");
          await page.waitForFunction(() => {
            const code = document.querySelector(".docs-code pre");
            return document.activeElement === code &&
              (code.scrollWidth <= code.clientWidth || code.scrollLeft > 0);
          }).catch(async (error) => {
            const metrics = await code.evaluate((node) => ({
              focused: document.activeElement === node,
              scrollWidth: node.scrollWidth,
              clientWidth: node.clientWidth,
              scrollLeft: node.scrollLeft,
              boxWidth: node.getBoundingClientRect().width,
            }));
            throw new Error(
              `code scrolling failed at ${path} ${width}px: ${
                JSON.stringify(metrics)
              }`,
              { cause: error },
            );
          });
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 700 });
    await openSuccessfulPage(page, `${ORIGIN}/docs/reference`);
    await page.waitForFunction(() => {
      const sidebar = document.querySelector(".docs-sidebar");
      const active = sidebar.querySelector("a.is-active")
        .getBoundingClientRect();
      const box = sidebar.getBoundingClientRect();
      return active.top >= box.top - 1 && active.bottom <= box.bottom + 1;
    });
    console.log(
      "[e2e:login] ok docs reflow, touch targets, active sidebar and keyboard code scrolling",
    );
  } finally {
    await page.close();
  }
}

async function smokeActionHoverColors(browser) {
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <link rel="stylesheet" href="${ORIGIN}/styles.css">
      <main style="padding:24px;background:#e8f0fe">
        <a id="docs-primary" class="docs-hero-cta docs-hero-cta--primary" href="#">Docs action</a>
        <a id="linked-primary" class="profile-form-button-primary" href="#">Linked form action</a>
        <a id="dashboard-primary" class="account-dashboard-button account-dashboard-button--primary" href="#">Account action</a>
        <div class="account-product-actions"><a id="product-primary" class="account-product-action--primary" href="#">Listing action</a></div>
        <p>Contact: <a id="inline-contact" class="text-link-button text-link-button--inline" href="#">contact@example.test</a></p>
        <a id="plain-link" href="#">Plain link</a>
        <div class="dark-phase" style="padding:24px;background:#14213f">
          <a id="dark-action" class="explore-cta-primary" href="#">Themed action</a>
          <a id="dark-owned" class="profile-form-button-primary" href="#">Themed primary</a>
          <a id="dark-menu" class="account-menu-item" href="#">Themed menu action</a>
          <a id="dark-link" href="#">Plain themed link</a>
        </div>
      </main>
    `);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const inline = await page.locator("#inline-contact").evaluate((node) => {
        const style = getComputedStyle(node);
        return style.display === "inline" && style.minHeight === "0px";
      });
      if (!inline) {
        throw new Error(`inline contact inflated prose at ${width}px`);
      }
    }
    const expectedColors = {
      "docs-primary": "rgb(255, 255, 255)",
      "linked-primary": "rgb(255, 255, 255)",
      "dashboard-primary": "rgb(255, 255, 255)",
      "product-primary": "rgb(255, 255, 255)",
      "dark-action": "rgb(240, 244, 255)",
      "dark-owned": "rgb(255, 255, 255)",
      "dark-menu": "rgb(243, 245, 251)",
      "plain-link": "rgb(15, 45, 82)",
      "dark-link": "rgb(212, 236, 252)",
    };
    for (const [id, expected] of Object.entries(expectedColors)) {
      const action = page.locator(`#${id}`);
      await action.hover();
      await action.evaluate((node) =>
        Promise.all(node.getAnimations().map((animation) => animation.finished))
      );
      const color = await action.evaluate((node) =>
        getComputedStyle(node).color
      );
      if (color !== expected) {
        throw new Error(
          `${id} hover foreground is ${color}, expected ${expected}`,
        );
      }
    }
    const primary = page.locator("#docs-primary");
    for (const state of ["normal", "hover"]) {
      if (state === "hover") await primary.hover();
      else await page.mouse.move(0, 0);
      await primary.evaluate((node) =>
        Promise.all(node.getAnimations().map((animation) => animation.finished))
      );
      const contrast = await primary.evaluate((node) => {
        const luminance = (color) => {
          const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number)
            .map((value) => value / 255)
            .map((value) =>
              value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4
            );
          return channels[0] * 0.2126 + channels[1] * 0.7152 +
            channels[2] * 0.0722;
        };
        const style = getComputedStyle(node);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05);
      });
      if (contrast < 4.5) {
        throw new Error(`docs primary ${state} contrast is ${contrast}`);
      }
    }
    console.log("[e2e:login] ok action hover colors and docs button contrast");
  } finally {
    await page.close();
  }
}

async function smokeEarlyAvatarFailure(browser) {
  const page = await browser.newPage();
  let releaseScripts;
  const scriptsReady = new Promise((resolve) => releaseScripts = resolve);
  try {
    await page.goto(`${ORIGIN}/dev/login-picker?current=local-picker.test`);
    await page.route(
      "**/api/me/avatar*",
      (route) => route.fulfill({ status: 404, body: "No avatar" }),
    );
    await page.route(/\.js(?:\?|$)/, async (route) => {
      await scriptsReady;
      await route.continue();
    });
    await page.goto(`${ORIGIN}/docs`, { waitUntil: "commit" });
    await page.waitForFunction(() => {
      const image = document.querySelector(".account-menu-avatar img");
      return image?.complete && image.naturalWidth === 0;
    });
    releaseScripts();
    await page.locator(".account-menu-avatar-initial").waitFor({
      state: "visible",
    });
    console.log("[e2e:login] ok avatar failure before hydration uses initials");
  } finally {
    releaseScripts();
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
