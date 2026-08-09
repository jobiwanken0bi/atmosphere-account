const FORM_SELECTOR = "form[data-submit-once]";
const PENDING_ATTRIBUTE = "data-submit-once-pending";
const GENERATED_SUBMITTER_ATTRIBUTE = "data-submit-once-submitter";
const ORIGINAL_LABEL_ATTRIBUTE = "data-submit-once-original-label";

function submitButtons(form) {
  return form.querySelectorAll(
    'button[type="submit"], input[type="submit"], input[type="image"]',
  );
}

function pendingLabelTarget(submitter) {
  return submitter?.querySelector?.("[data-submit-once-label]") ?? submitter;
}

export function beginSubmitOnce(form, submitter) {
  if (form.getAttribute(PENDING_ATTRIBUTE) === "true") return false;
  form.setAttribute(PENDING_ATTRIBUTE, "true");
  form.setAttribute("aria-busy", "true");

  if (
    submitter instanceof HTMLElement &&
    "name" in submitter && typeof submitter.name === "string" &&
    submitter.name && "value" in submitter &&
    typeof submitter.value === "string"
  ) {
    // Disabling a submitter during the submit event normally removes its
    // name/value from the native form payload. Snapshot it first so actions
    // such as Validate versus Save remain exact while every button is locked.
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.name = submitter.name;
    hidden.value = submitter.value;
    hidden.setAttribute(GENERATED_SUBMITTER_ATTRIBUTE, "true");
    form.append(hidden);
  }

  for (const button of submitButtons(form)) {
    button.setAttribute(
      "data-submit-once-was-disabled",
      button.disabled ? "true" : "false",
    );
    button.disabled = true;
  }

  if (submitter instanceof HTMLElement) {
    submitter.setAttribute("aria-busy", "true");
    const target = pendingLabelTarget(submitter);
    const label = submitter.dataset.pendingLabel ?? form.dataset.pendingLabel;
    if (target instanceof HTMLElement && label) {
      target.setAttribute(ORIGINAL_LABEL_ATTRIBUTE, target.textContent ?? "");
      target.textContent = label;
    }
  }
  return true;
}

export function resetSubmitOnce(form) {
  form.removeAttribute(PENDING_ATTRIBUTE);
  form.removeAttribute("aria-busy");
  form.querySelectorAll(`[${GENERATED_SUBMITTER_ATTRIBUTE}]`).forEach((node) =>
    node.remove()
  );

  for (const button of submitButtons(form)) {
    const wasDisabled = button.getAttribute("data-submit-once-was-disabled");
    if (wasDisabled !== null) {
      button.disabled = wasDisabled === "true";
      button.removeAttribute("data-submit-once-was-disabled");
    }
    button.removeAttribute("aria-busy");
    const target = pendingLabelTarget(button);
    if (target instanceof HTMLElement) {
      const originalLabel = target.getAttribute(ORIGINAL_LABEL_ATTRIBUTE);
      if (originalLabel !== null) {
        target.textContent = originalLabel;
        target.removeAttribute(ORIGINAL_LABEL_ATTRIBUTE);
      }
    }
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches(FORM_SELECTOR)) {
      return;
    }
    if (event.defaultPrevented) return;
    if (form.getAttribute(PENDING_ATTRIBUTE) === "true") {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    beginSubmitOnce(form, event.submitter);
  });

  document.addEventListener("atmo:reset-submit-once", (event) => {
    const target = event.target;
    if (target instanceof HTMLFormElement && target.matches(FORM_SELECTOR)) {
      resetSubmitOnce(target);
    }
  });

  globalThis.addEventListener("pageshow", () => {
    document.querySelectorAll(FORM_SELECTOR).forEach((form) => {
      if (form instanceof HTMLFormElement) resetSubmitOnce(form);
    });
  });
}
