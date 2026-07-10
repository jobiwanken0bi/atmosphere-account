const target = document.querySelector("[data-login-handoff-target]");

if (target instanceof HTMLAnchorElement) {
  globalThis.location.replace(target.href);
}
