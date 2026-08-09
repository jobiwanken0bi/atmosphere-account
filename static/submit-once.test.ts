Deno.test("submit-once enhancer locks synchronously and preserves submitter values", async () => {
  const source = await Deno.readTextFile(
    new URL("./submit-once.js", import.meta.url),
  );

  for (
    const expected of [
      'form.getAttribute(PENDING_ATTRIBUTE) === "true"',
      "event.preventDefault()",
      "event.stopImmediatePropagation()",
      "beginSubmitOnce(form, event.submitter)",
      "hidden.name = submitter.name",
      "hidden.value = submitter.value",
      "button.disabled = true",
      'form.setAttribute("aria-busy", "true")',
    ]
  ) {
    if (!source.includes(expected)) {
      throw new Error(`Missing submit-once behavior: ${expected}`);
    }
  }
});

Deno.test("submit-once enhancer restores forms after failure or page return", async () => {
  const source = await Deno.readTextFile(
    new URL("./submit-once.js", import.meta.url),
  );

  for (
    const expected of [
      'document.addEventListener("atmo:reset-submit-once"',
      'globalThis.addEventListener("pageshow"',
      "resetSubmitOnce(target)",
      'button.disabled = wasDisabled === "true"',
      'button.removeAttribute("aria-busy")',
    ]
  ) {
    if (!source.includes(expected)) {
      throw new Error(`Missing submit-once recovery behavior: ${expected}`);
    }
  }
});

Deno.test("high-latency host and relationship forms opt into submit-once", async () => {
  const files = [
    "../routes/hosts/[host]/claim.tsx",
    "../routes/hosts/[host]/manage.tsx",
    "../routes/hosts/[host]/manage/apps.tsx",
    "../routes/apps/manage/host.tsx",
    "../routes/relationships/confirm.tsx",
  ];
  for (const path of files) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    if (!source.includes('data-submit-once="true"')) {
      throw new Error(`Expected submit-once form in ${path}`);
    }
    if (!source.includes("data-pending-label=")) {
      throw new Error(`Expected action-specific pending copy in ${path}`);
    }
  }
});
