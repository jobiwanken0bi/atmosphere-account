Deno.test("login handoff replaces the bridge document with its target", async () => {
  const source = await Deno.readTextFile(
    new URL("./login-handoff.js", import.meta.url),
  );
  if (!source.includes("[data-login-handoff-target]")) {
    throw new Error("Expected a scoped bridge target");
  }
  if (
    !source.includes('target.dataset.loginHandoffLoopback === "true"') ||
    !source.includes("globalThis.location.replace(destination)")
  ) {
    throw new Error("Expected validated history-replacing browser navigation");
  }
  for (const path of ["/login/select", "/oauth/login", "/oauth/switch"]) {
    if (!source.includes(`"${path}"`)) {
      throw new Error(`Expected enhanced handoff support for ${path}`);
    }
  }
  if (!source.includes("action.searchParams.append(name, value)")) {
    throw new Error("Expected a bodyless same-origin POST handoff");
  }
  if (
    !source.includes('form.dataset.loginHandoffNextCurrent === "true"') ||
    !source.includes("globalThis.location.pathname") ||
    !source.includes("globalThis.location.search") ||
    !source.includes("destinationUrl.hash = currentUrl.hash")
  ) {
    throw new Error("Expected account switches to retain the current page");
  }
  if (
    !source.includes('form.getAttribute("action")') ||
    source.includes("new URL(form.action")
  ) {
    throw new Error("Expected submission to use the literal form action");
  }
  if (!source.includes('"x-atmosphere-login-bodyless": "1"')) {
    throw new Error("Expected an explicit bodyless proxy marker");
  }
  if (!source.includes("if (event.defaultPrevented) return")) {
    throw new Error(
      "Expected already-handled form submissions to stay handled",
    );
  }
  if (!source.includes("HANDOFF_TIMEOUT_MS")) {
    throw new Error("Expected a bounded browser handoff");
  }
  if (
    !source.includes("body.redirectUrl,") ||
    !source.includes("globalThis.location.assign(destination)")
  ) {
    throw new Error(
      "Expected server destinations to be validated before navigation",
    );
  }
  if (
    !source.includes('form.dataset.loginHandoffReplace === "true"') ||
    !source.includes("destination === globalThis.location.href") ||
    !source.includes("globalThis.location.reload()") ||
    !source.includes("globalThis.location.replace(destination)")
  ) {
    throw new Error(
      "Expected account switches to reload in place or replace stale history",
    );
  }
  for (const blocked of ["target.username", 'target.protocol === "https:"']) {
    if (!source.includes(blocked)) {
      throw new Error(`Expected navigation guard: ${blocked}`);
    }
  }
  for (const suffix of [".test", ".invalid", ".example", ".onion"]) {
    if (!source.includes(`host.endsWith("${suffix}")`)) {
      throw new Error(`Expected special-use navigation guard: ${suffix}`);
    }
  }
});

Deno.test("hosted browser handoff accepts local callbacks only for picker completion", async () => {
  const source = await Deno.readTextFile(
    new URL("./login-handoff.js", import.meta.url),
  );
  const navigation = new Function(
    "document",
    "HTMLAnchorElement",
    "globalThis",
    `${source}; return safeNavigationDestination;`,
  )(
    { querySelector: () => null, addEventListener: () => {} },
    class {},
    { location: { href: "https://login.atmosphereaccount.com/login/select" } },
  );
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const callback = `http://${host}:5173/selected?state=one`;
    if (
      navigation(callback) !== null || navigation(callback, true) !== callback
    ) {
      throw new Error(
        "Local picker callback did not require scoped permission",
      );
    }
  }
  for (
    const target of [
      "http://10.0.0.1/selected",
      "http://0.0.0.0/selected",
      "http://app.localhost/selected",
      "http://127.0.0.2/selected",
      "https://localhost/selected",
      "http://user:secret@localhost/selected",
      "http://example.com/selected",
      "javascript:alert(1)",
    ]
  ) {
    if (navigation(target, true) !== null) {
      throw new Error(
        "Scoped picker completion accepted an unsafe destination",
      );
    }
  }
});

Deno.test("browser bridge enables local return only with the server marker", async () => {
  const source = await Deno.readTextFile(
    new URL("./login-handoff.js", import.meta.url),
  );
  for (const allowed of [false, true]) {
    const navigations: string[] = [];
    class Anchor {
      href = "http://127.0.0.1:5173/selected";
      dataset = { loginHandoffLoopback: allowed ? "true" : undefined };
    }
    new Function("document", "HTMLAnchorElement", "globalThis", source)(
      { querySelector: () => new Anchor(), addEventListener: () => {} },
      Anchor,
      {
        location: {
          href: "https://login.atmosphereaccount.com/login/select",
          replace: (value: string) => navigations.push(value),
        },
      },
    );
    if (navigations.length !== (allowed ? 1 : 0)) {
      throw new Error("Bridge did not enforce server callback permission");
    }
  }
});
