const ENHANCED_ATTR = "data-signin-preview-enhanced";
const FLOW_ENHANCED_ATTR = "data-signin-flow-enhanced";

function cleanHandle(value) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function safeAvatarUrl(value) {
  if (typeof value !== "string") return "";
  if (
    value.startsWith("/") || value.startsWith("https://") ||
    value.startsWith("http://")
  ) {
    return value;
  }
  return "";
}

function statusNode(message, loading) {
  const row = document.createElement("div");
  row.className = "signin-form-preview-status";
  if (loading) {
    const spinner = document.createElement("span");
    spinner.className = "signin-form-preview-spinner";
    spinner.setAttribute("aria-hidden", "true");
    row.append(spinner);
  }
  const text = document.createElement("span");
  text.textContent = message;
  row.append(text);
  return row;
}

function matchButton(match, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "signin-form-preview-row";

  const avatarUrl = safeAvatarUrl(match.avatarUrl);
  if (avatarUrl) {
    const avatar = document.createElement("img");
    avatar.className = "signin-form-preview-avatar";
    avatar.src = avatarUrl;
    avatar.alt = "";
    avatar.loading = "lazy";
    avatar.decoding = "async";
    button.append(avatar);
  } else {
    const avatar = document.createElement("span");
    avatar.className = "signin-form-preview-avatar";
    avatar.setAttribute("aria-hidden", "true");
    button.append(avatar);
  }

  const meta = document.createElement("span");
  meta.className = "signin-form-preview-meta";
  const name = document.createElement("span");
  name.className = "signin-form-preview-name";
  name.textContent = match.displayName || `@${match.handle}`;
  meta.append(name);
  if (match.displayName) {
    const handle = document.createElement("span");
    handle.className = "signin-form-preview-handle";
    handle.textContent = `@${match.handle}`;
    meta.append(handle);
  }
  button.append(meta);

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", () => {
    onSelect(match);
  });
  return button;
}

function renderSelected(target, match, onClear) {
  if (!target) return;
  const avatarUrl = safeAvatarUrl(match.avatarUrl);
  const avatar = avatarUrl
    ? document.createElement("img")
    : document.createElement("span");
  avatar.className = "signin-form-preview-avatar";
  if (avatarUrl) {
    avatar.src = avatarUrl;
    avatar.alt = "";
    avatar.loading = "lazy";
    avatar.decoding = "async";
  } else {
    avatar.setAttribute("aria-hidden", "true");
  }

  const meta = document.createElement("span");
  meta.className = "signin-form-preview-meta";
  const name = document.createElement("span");
  name.className = "signin-form-preview-name";
  name.textContent = match.displayName || `@${match.handle}`;
  meta.append(name);
  if (match.displayName) {
    const handle = document.createElement("span");
    handle.className = "signin-form-preview-handle";
    handle.textContent = `@${match.handle}`;
    meta.append(handle);
  }

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "signin-selected-clear";
  clear.setAttribute("aria-label", "Clear selected account");
  clear.textContent = "×";
  clear.addEventListener("click", onClear);

  target.replaceChildren(avatar, meta, clear);
  target.hidden = false;
}

function hideSelected(target) {
  if (!target) return;
  target.hidden = true;
  target.replaceChildren();
}

function renderFormError(form, message) {
  const input = form.querySelector("[data-signin-preview-input]");
  let error = form.querySelector("[data-signin-form-error]");
  if (!error) {
    error = document.createElement("p");
    error.className = "signin-form-error";
    error.setAttribute("data-signin-form-error", "true");
    error.setAttribute("role", "alert");
    error.setAttribute("aria-live", "assertive");
    form.append(error);
  }
  if (input instanceof HTMLInputElement) {
    const errorId = `${input.id || "signin-handle"}-error`;
    error.id = errorId;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-errormessage", errorId);
    const describedBy = new Set(
      (input.getAttribute("aria-describedby") || "").split(/\s+/).filter(
        Boolean,
      ),
    );
    describedBy.add(errorId);
    input.setAttribute("aria-describedby", [...describedBy].join(" "));
  }
  error.textContent = message;
}

function clearFormError(form) {
  const error = form.querySelector("[data-signin-form-error]");
  const input = form.querySelector("[data-signin-preview-input]");
  if (input instanceof HTMLInputElement && error && error.id) {
    const describedBy = (input.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((id) => id && id !== error.id);
    if (describedBy.length > 0) {
      input.setAttribute("aria-describedby", describedBy.join(" "));
    } else {
      input.removeAttribute("aria-describedby");
    }
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-errormessage");
  }
  error?.remove();
}

function enhanceForm(form, index) {
  if (form.getAttribute(ENHANCED_ATTR) === "true") return;
  const input = form.querySelector("[data-signin-preview-input]");
  if (!(input instanceof HTMLInputElement)) return;
  const previewWrap = form.querySelector(".signin-form-preview-wrap");
  if (!(previewWrap instanceof HTMLElement)) return;

  form.setAttribute(ENHANCED_ATTR, "true");
  const loadingLabel = form.dataset.previewLoading || "Searching…";
  const notFoundLabel = form.dataset.previewNotFound ||
    "No matching account found.";
  const submitLabel = form.dataset.submitLabel || "Continue";
  const submittingLabel = form.dataset.submittingLabel || "Redirecting…";
  const errorLabel = form.dataset.errorLabel ||
    "Login with Atmosphere could not be started. Check the handle or try again shortly.";
  const submitButton = form.querySelector(".signin-form-submit");
  const selectedBox = form.querySelector("[data-signin-selected]");
  const preview = document.createElement("div");
  preview.id = `signin-handle-preview-${index}`;
  preview.className = "signin-form-preview glass";
  preview.setAttribute("aria-live", "polite");
  preview.hidden = true;
  // Anchor suggestions to the complete handle/action row so results use the
  // full available width instead of being squeezed to the input column.
  previewWrap.append(preview);

  let timer = 0;
  let seq = 0;
  let selectedMatch = null;
  let activeController = null;

  function abortPreviewFetch() {
    if (!activeController) return;
    activeController.abort();
    activeController = null;
  }

  function show() {
    preview.hidden = false;
  }

  function hide() {
    preview.hidden = true;
  }

  function clearSelected() {
    selectedMatch = null;
    hideSelected(selectedBox);
  }

  function renderLoading() {
    preview.replaceChildren(statusNode(loadingLabel, true));
    show();
  }

  function renderMiss() {
    preview.replaceChildren(statusNode(notFoundLabel, false));
    show();
  }

  function renderMatches(matches) {
    if (!Array.isArray(matches) || matches.length === 0) {
      renderMiss();
      return;
    }
    const list = document.createElement("div");
    list.className = "signin-form-preview-list";
    for (const match of matches) {
      if (!match || typeof match.handle !== "string") continue;
      list.append(matchButton(match, (selected) => {
        selectedMatch = selected;
        input.value = selected.handle;
        hide();
        input.focus();
        renderSelected(selectedBox, selected, () => {
          input.value = "";
          clearSelected();
          input.focus();
        });
      }));
    }
    if (list.children.length === 0) {
      renderMiss();
      return;
    }
    preview.replaceChildren(list);
    show();
  }

  function schedule(value) {
    const query = cleanHandle(value);
    clearTimeout(timer);
    abortPreviewFetch();
    if (!selectedMatch || selectedMatch.handle !== query) clearSelected();
    if (!query) {
      hide();
      preview.replaceChildren();
      return;
    }
    if (query.length < 2) {
      hide();
      preview.replaceChildren();
      return;
    }
    const mySeq = ++seq;
    renderLoading();
    timer = setTimeout(async () => {
      const controller = new AbortController();
      activeController = controller;
      try {
        const res = await fetch(
          `/api/identity/preview?handle=${encodeURIComponent(query)}`,
          {
            headers: { accept: "application/json" },
            signal: controller.signal,
          },
        );
        const data = await res.json();
        if (mySeq !== seq) return;
        if (data && data.found) {
          renderMatches(data.matches);
        } else {
          renderMiss();
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
        if (mySeq === seq) renderMiss();
      } finally {
        if (activeController === controller) activeController = null;
      }
    }, 150);
  }

  input.addEventListener("input", () => schedule(input.value));
  input.addEventListener("focus", () => {
    if (input.value.trim()) schedule(input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !preview.hidden) {
      event.preventDefault();
      event.stopPropagation();
      hide();
      return;
    }
    if (event.key !== "ArrowDown" || preview.hidden) return;
    const first = preview.querySelector(".signin-form-preview-row");
    if (first instanceof HTMLButtonElement) {
      event.preventDefault();
      first.focus();
    }
  });
  preview.addEventListener("keydown", (event) => {
    const options = Array.from(
      preview.querySelectorAll(".signin-form-preview-row"),
    );
    const current = options.indexOf(document.activeElement);
    let next = current;
    if (event.key === "ArrowDown") {
      next = Math.min(options.length - 1, current + 1);
    } else if (event.key === "ArrowUp") next = Math.max(0, current - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hide();
      input.focus();
      return;
    } else return;
    if (next >= 0 && options[next] instanceof HTMLButtonElement) {
      event.preventDefault();
      options[next].focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!form.contains(event.target)) hide();
  });
  form.addEventListener("submit", async (event) => {
    if (!input.value.trim()) {
      event.preventDefault();
      input.focus();
      return;
    }
    event.preventDefault();
    clearFormError(form);
    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = true;
      submitButton.textContent = submittingLabel;
    }
    try {
      const res = await fetch(form.action || "/oauth/login", {
        method: (form.method || "POST").toUpperCase(),
        body: new FormData(form),
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "x-atmosphere-login": "1",
        },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || typeof body.redirectUrl !== "string") {
        throw new Error(errorLabel);
      }
      globalThis.location.assign(body.redirectUrl);
    } catch {
      renderFormError(form, errorLabel);
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = false;
        submitButton.textContent = submitLabel;
      }
      document.dispatchEvent(new CustomEvent("atmo:hide-page-skeleton"));
    }
  });
  if (submitButton instanceof HTMLButtonElement) {
    submitButton.textContent = submitLabel;
  }
}

function enhanceFlow(flow) {
  if (flow.getAttribute(FLOW_ENHANCED_ATTR) === "true") return;
  flow.setAttribute(FLOW_ENHANCED_ATTR, "true");
  const showManualButtons = Array.from(
    flow.querySelectorAll("[data-signin-show-manual]"),
  );
  const showSavedButtons = Array.from(
    flow.querySelectorAll("[data-signin-show-saved]"),
  );
  const savedView = flow.querySelector("[data-signin-saved-view]");
  const manualView = flow.querySelector("[data-signin-manual-view]");
  const manualForm = flow.querySelector(
    'form.signin-form[data-signin-preview="true"]',
  );

  function setSigninView(view) {
    if (savedView) savedView.hidden = view !== "saved";
    if (manualView) manualView.hidden = view !== "manual";
  }

  if (manualForm) {
    for (const showManual of showManualButtons) {
      showManual.addEventListener("click", (event) => {
        if (!isPlainLinkActivation(event)) return;
        event.preventDefault();
        setSigninView("manual");
        const input = manualForm.querySelector("[data-signin-preview-input]");
        if (input instanceof HTMLInputElement) input.focus();
      });
    }
    for (const showSaved of showSavedButtons) {
      showSaved.addEventListener("click", (event) => {
        if (!isPlainLinkActivation(event)) return;
        event.preventDefault();
        setSigninView("saved");
        const initialSavedAccount = savedView?.querySelector(
          '[data-dialog-initial-focus="true"]',
        );
        if (initialSavedAccount instanceof HTMLElement) {
          initialSavedAccount.focus();
        }
      });
    }
  }

  setSigninView(flow.getAttribute("data-initial-signin-view") || "manual");
}

function isPlainLinkActivation(event) {
  return !event.defaultPrevented && event.button === 0 && !event.altKey &&
    !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

function hasSigninPreviewTargets() {
  return Boolean(
    document.querySelector('[data-signin-flow="true"]') ||
      document.querySelector('form.signin-form[data-signin-preview="true"]'),
  );
}

function bootSigninPreviews() {
  document
    .querySelectorAll('[data-signin-flow="true"]')
    .forEach((flow) => enhanceFlow(flow));
  document
    .querySelectorAll('form.signin-form[data-signin-preview="true"]')
    .forEach((form, index) => enhanceForm(form, index));
}

if (hasSigninPreviewTargets()) bootSigninPreviews();
setTimeout(bootSigninPreviews, 0);
document.addEventListener("DOMContentLoaded", bootSigninPreviews);

// Portal-based contextual modals are mounted after this module evaluates, so
// observe unconditionally rather than only when a form exists at page load.
let observerTimer = 0;
const observer = new MutationObserver(() => {
  clearTimeout(observerTimer);
  observerTimer = setTimeout(bootSigninPreviews, 25);
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});
