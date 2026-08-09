Deno.test("login handoff replaces the bridge document with its target", async () => {
  const source = await Deno.readTextFile(
    new URL("./login-handoff.js", import.meta.url),
  );
  if (!source.includes("[data-login-handoff-target]")) {
    throw new Error("Expected a scoped bridge target");
  }
  if (
    !source.includes("safeNavigationDestination(target.href)") ||
    !source.includes("globalThis.location.replace(destination)")
  ) {
    throw new Error("Expected validated history-replacing browser navigation");
  }
  for (const path of ["/login/select", "/oauth/switch"]) {
    if (!source.includes(`"${path}"`)) {
      throw new Error(`Expected enhanced handoff support for ${path}`);
    }
  }
  if (!source.includes("action.searchParams.append(name, value)")) {
    throw new Error("Expected a bodyless same-origin POST handoff");
  }
  if (!source.includes('"x-atmosphere-login-bodyless": "1"')) {
    throw new Error("Expected an explicit bodyless proxy marker");
  }
  if (!source.includes("HANDOFF_TIMEOUT_MS")) {
    throw new Error("Expected a bounded browser handoff");
  }
  if (
    !source.includes("safeNavigationDestination(body.redirectUrl)") ||
    !source.includes("globalThis.location.assign(destination)")
  ) {
    throw new Error(
      "Expected server destinations to be validated before navigation",
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
