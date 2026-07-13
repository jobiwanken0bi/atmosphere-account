(() => {
  const button = document.querySelector("[data-atmosphere-login]");
  if (!button) return;
  const origin = globalThis.location.origin;
  button.dataset.clientId =
    `${origin}/examples/atmosphere-login/client-metadata.json`;
  button.dataset.returnUri = `${origin}/examples/atmosphere-login/callback`;
  button.dataset.scope = "atproto";
  button.dataset.appName = "Plain HTML Atmosphere Login example";
  button.dataset.appHomepage = `${origin}/examples/atmosphere-login-plain.html`;
})();
