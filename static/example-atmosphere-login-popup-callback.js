(function () {
  function boot() {
    const root = document.querySelector("[data-example-popup-callback]");
    if (!root || !globalThis.AtmosphereLogin) return;
    const clientId = root.getAttribute("data-client-id");
    const status = document.querySelector(
      "[data-example-popup-callback-status]",
    );
    const selection = globalThis.AtmosphereLogin.consumeSelection({
      clientId,
      clearUrl: false,
      closePopup: true,
    });
    if (status) {
      status.textContent = selection
        ? "Account selected. You can close this window."
        : "No account selection was found.";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
