Deno.test("login handoff enhances only account-switch and picker forms", async () => {
  const source = await Deno.readTextFile(
    new URL("./login-handoff.js", import.meta.url),
  );
  for (const path of ["/login/select", "/oauth/switch"]) {
    if (!source.includes(`"${path}"`)) {
      throw new Error(`Expected login handoff to cover ${path}`);
    }
  }
  if (!source.includes('"x-atmosphere-login": "1"')) {
    throw new Error("Expected JSON handoff request marker");
  }
  if (!source.includes("globalThis.location.assign(body.redirectUrl)")) {
    throw new Error("Expected explicit browser navigation after handoff");
  }
});
