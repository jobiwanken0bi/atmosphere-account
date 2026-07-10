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
});
