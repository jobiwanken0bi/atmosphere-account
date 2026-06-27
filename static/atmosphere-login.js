(function () {
  const script = document.currentScript;
  const defaultOrigin = script && script.src
    ? new URL(script.src, location.href).origin
    : "https://atmosphereaccount.com";
  const STATE_PREFIX = "atmosphere_login_state:";
  const BUTTON_ENHANCED_ATTR = "data-atmosphere-login-enhanced";

  function randomState() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
      /=+$/,
      "",
    );
  }

  function storageKey(clientId) {
    return `${STATE_PREFIX}${clientId}`;
  }

  function buildUrl(options) {
    if (!options || !options.clientId) {
      throw new Error("Atmosphere Login requires clientId");
    }
    if (!options.returnUri) {
      throw new Error("Atmosphere Login requires returnUri");
    }
    const state = options.state || randomState();
    const origin = options.atmosphereOrigin || defaultOrigin;
    const url = new URL("/login/select", origin);
    url.searchParams.set("client_id", options.clientId);
    url.searchParams.set("return_uri", options.returnUri);
    url.searchParams.set("state", state);
    if (options.scope) url.searchParams.set("scope", options.scope);
    return { url: url.toString(), state };
  }

  function continueWithAtmosphere(options) {
    const built = buildUrl(options);
    try {
      sessionStorage.setItem(
        storageKey(options.clientId),
        JSON.stringify({ state: built.state, createdAt: Date.now() }),
      );
    } catch {
      // State is still sent to the app; storage is just a convenience check.
    }
    if (options.popup) {
      const popup = globalThis.open(
        built.url,
        "atmosphere-login",
        "popup,width=520,height=680",
      );
      if (popup) return { popup, state: built.state, url: built.url };
    }
    location.href = built.url;
    return { state: built.state, url: built.url };
  }

  function readButtonOptions(button) {
    const mode = button.getAttribute("data-mode") ||
      (button.getAttribute("data-popup") === "true" ? "popup" : "redirect");
    return {
      clientId: button.getAttribute("data-client-id"),
      returnUri: button.getAttribute("data-return-uri"),
      scope: button.getAttribute("data-scope") || undefined,
      state: button.getAttribute("data-state") || undefined,
      appName: button.getAttribute("data-app-name") || "Atmosphere app",
      appLogo: button.getAttribute("data-app-logo") || undefined,
      appHomepage: button.getAttribute("data-app-homepage") || undefined,
      atmosphereOrigin: button.getAttribute("data-atmosphere-origin") ||
        defaultOrigin,
      popup: mode === "popup",
      mode,
    };
  }

  function consumeSelection(options) {
    const params = new URL(location.href).searchParams;
    const token = params.get("selection_token");
    const state = params.get("state");
    const clientId = params.get("client_id") || options && options.clientId;
    if (!token || !state || !clientId) return null;
    let stored = null;
    try {
      stored = JSON.parse(
        sessionStorage.getItem(storageKey(clientId)) || "null",
      );
    } catch {
      stored = null;
    }
    if (stored && stored.state && stored.state !== state) {
      throw new Error("Atmosphere Login state mismatch");
    }
    try {
      sessionStorage.removeItem(storageKey(clientId));
    } catch {
      // Ignore storage failures.
    }
    return {
      token,
      state,
      clientId,
      did: params.get("did"),
      handle: params.get("handle"),
      issuer: params.get("iss"),
    };
  }

  function assetUrl(path, atmosphereOrigin) {
    try {
      return new URL(path, atmosphereOrigin).toString();
    } catch {
      return new URL(path, defaultOrigin).toString();
    }
  }

  function enhanceButton(button) {
    if (button.getAttribute(BUTTON_ENHANCED_ATTR) === "true") return;
    button.setAttribute(BUTTON_ENHANCED_ATTR, "true");
    if (button instanceof HTMLButtonElement && !button.getAttribute("type")) {
      button.type = "button";
    }
    const options = readButtonOptions(button);
    if (!button.textContent.trim()) {
      const mark = document.createElement("span");
      mark.className = "atmosphere-login-button-mark";
      mark.setAttribute("aria-hidden", "true");
      const icon = document.createElement("img");
      icon.src = assetUrl("/union.svg", options.atmosphereOrigin);
      icon.alt = "";
      icon.loading = "lazy";
      icon.decoding = "async";
      mark.append(icon);
      const label = document.createElement("span");
      label.className = "atmosphere-login-button-label";
      label.textContent = "Continue with Atmosphere";
      button.replaceChildren(mark, label);
    }
    button.classList.add("atmosphere-login-button");
    button.setAttribute(
      "aria-label",
      button.getAttribute("aria-label") ||
        `Continue to ${options.appName} with Atmosphere`,
    );
    if (options.appHomepage) button.title = options.appHomepage;
    button.addEventListener("click", function (event) {
      event.preventDefault();
      if (button.disabled || button.getAttribute("data-loading") === "true") {
        return;
      }
      const nextOptions = readButtonOptions(button);
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.setAttribute("data-loading", "true");
      button.setAttribute("data-atmosphere-state", "loading");
      try {
        const result = continueWithAtmosphere(nextOptions);
        button.dispatchEvent(
          new CustomEvent("atmosphere-login:start", {
            bubbles: true,
            detail: {
              url: result.url,
              state: result.state,
              mode: nextOptions.mode,
              app: {
                name: nextOptions.appName,
                logo: nextOptions.appLogo,
                homepage: nextOptions.appHomepage,
              },
            },
          }),
        );
        if (nextOptions.popup) {
          button.disabled = false;
          button.removeAttribute("aria-busy");
          button.removeAttribute("data-loading");
          button.setAttribute("data-atmosphere-state", "ready");
        }
      } catch (error) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.removeAttribute("data-loading");
        button.setAttribute("data-atmosphere-state", "error");
        button.dispatchEvent(
          new CustomEvent("atmosphere-login:error", {
            bubbles: true,
            detail: {
              error: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      }
    });
  }

  function injectStyles() {
    if (document.getElementById("atmosphere-login-button-styles")) return;
    const style = document.createElement("style");
    style.id = "atmosphere-login-button-styles";
    style.textContent = `
      .atmosphere-login-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.58rem;
        min-height: 2.75rem;
        padding: 0.72rem 1.05rem;
        border: 1px solid rgba(31, 87, 196, 0.2);
        border-radius: 999px;
        background: #1677ff;
        color: #fff;
        font: 700 0.95rem/1.1 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        box-shadow: 0 12px 30px rgba(22, 119, 255, 0.18);
        transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
      }
      .atmosphere-login-button:hover {
        background: #0f6ee9;
        box-shadow: 0 16px 34px rgba(22, 119, 255, 0.24);
        transform: translateY(-1px);
      }
      .atmosphere-login-button:disabled {
        cursor: progress;
        opacity: 0.78;
        transform: none;
      }
      .atmosphere-login-button-mark {
        display: inline-flex;
        width: 1.25rem;
        height: 1.25rem;
        align-items: center;
        justify-content: center;
      }
      .atmosphere-login-button img {
        width: 1.2rem;
        height: 1.2rem;
        filter: brightness(0) invert(1);
      }
      .atmosphere-login-button[data-atmosphere-state="loading"] .atmosphere-login-button-label::after {
        content: "...";
      }
    `;
    document.head.append(style);
  }

  function boot() {
    const buttons = Array.from(
      document.querySelectorAll("[data-atmosphere-login]"),
    );
    if (buttons.length === 0) return;
    injectStyles();
    buttons.forEach(enhanceButton);
  }

  globalThis.AtmosphereLogin = {
    buildUrl,
    continue: continueWithAtmosphere,
    continueWithAtmosphere,
    consumeSelection,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
