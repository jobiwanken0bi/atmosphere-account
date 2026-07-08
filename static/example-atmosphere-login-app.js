(function () {
  function qs(name) {
    return document.querySelector(name);
  }

  function setStatus(message) {
    const status = qs("[data-example-popup-status]");
    if (status) status.textContent = message;
  }

  function continueWithSelection(button, selection) {
    const returnUri = button.getAttribute("data-return-uri");
    if (!returnUri || !selection || !selection.token) {
      setStatus("The picker returned without an account selection.");
      return;
    }
    const url = new URL(returnUri, globalThis.location.href);
    url.searchParams.set("handoff", "1");
    url.searchParams.set("selection_token", selection.token);
    url.searchParams.set("client_id", selection.clientId || "");
    url.searchParams.set("state", selection.state || "");
    if (selection.did) url.searchParams.set("did", selection.did);
    if (selection.handle) url.searchParams.set("handle", selection.handle);
    if (selection.issuer) url.searchParams.set("iss", selection.issuer);
    setStatus("Account selected. Finishing the example app sign-in...");
    globalThis.location.href = url.toString();
  }

  function boot() {
    const button = qs("[data-example-popup-button]");
    if (!button) return;
    button.addEventListener("atmosphere-login:start", () => {
      setStatus("Picker opened. Choose an account to continue.");
    });
    button.addEventListener("atmosphere-login:complete", (event) => {
      continueWithSelection(button, event.detail && event.detail.selection);
    });
    button.addEventListener("atmosphere-login:cancel", () => {
      setStatus("Picker closed before an account was selected.");
    });
    button.addEventListener("atmosphere-login:error", (event) => {
      const message = event.detail && event.detail.error
        ? event.detail.error
        : "The popup could not be opened.";
      setStatus(message);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
