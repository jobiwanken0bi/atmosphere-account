Deno.test("login handoff replaces the bridge document with its target", async () => {
  const source = await Deno.readTextFile(
    new URL("./login-handoff.js", import.meta.url),
  );
  if (!source.includes("[data-login-handoff-target]")) {
    throw new Error("Expected a scoped bridge target");
  }
  if (!source.includes("globalThis.location.replace(target.href)")) {
    throw new Error("Expected history-replacing browser navigation");
  }
  for (const path of ["/login/select", "/oauth/switch"]) {
    if (!source.includes(`"${path}"`)) {
      throw new Error(`Expected enhanced handoff support for ${path}`);
    }
  }
  if (!source.includes("action.searchParams.append(name, value)")) {
    throw new Error("Expected a bodyless same-origin POST handoff");
  }
  if (!source.includes("HANDOFF_TIMEOUT_MS")) {
    throw new Error("Expected a bounded browser handoff");
  }
});
